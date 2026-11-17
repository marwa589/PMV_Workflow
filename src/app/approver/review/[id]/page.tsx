// src/app/approver/review/[id]/page.tsx
import { DocumentStatus } from "@prisma/client";
import { notFound, redirect } from "next/navigation";
import DocumentReviewEditor from "@/components/document-review-editor";
import { requireAuth } from "@/lib/auth/guards";
import { getVisibleReferenceDocuments, userHasPermissionForDocument } from "@/lib/auth/access";
import { USER_TYPE } from "@/lib/auth/roles";
import { prisma } from "@/lib/prisma";
import { getRelatedDocumentsForReview } from "@/lib/related-documents";
import { createEligibilityChecker } from "@/lib/workflow/eligibility";
import { SEND_FOR_APPROVAL_PERMISSION, UNIQUE_TRACK_PERMISSION, previousLevel } from "@/lib/workflow/tracks";

export const dynamic = "force-dynamic";

export default async function ApproverDocumentReviewPage({ params }: { params: Promise<{ id: string }> }) {
  // Anyone the flow names (by name, or by user type with a matching assignment) may open this screen.
  const session = await requireAuth();
  const { id } = await params;

  const document = await prisma.document.findUnique({
    where: { id },
    select: {
      id: true,
      documentNumber: true,
      title: true,
      currentVersion: true,
      status: true,
      createdById: true,
      currentWorkflowStep: true,
      projectId: true,
      documentTypeId: true,
      documentSubtypeId: true,
      project: { select: { locationId: true, companyId: true } },
      approvalSteps: {
        orderBy: { levelNumber: "asc" },
        select: { levelNumber: true, name: true, signatureRequired: true, status: true, actedAt: true, isTrackStep: true, isSideApproval: true, originLevel: true, returnLevel: true, sentBy: { select: { name: true } }, approvers: { select: { approverType: true, userId: true, userTypeId: true } } },
      },
    },
  });

  if (!document) notFound();

  const [latestHistory, latestRevisionRequest] = await Promise.all([
    prisma.approvalHistory.findFirst({
      where: { documentId: document.id },
      orderBy: { performedAt: "desc" },
      select: { action: true },
    }),
    prisma.approvalHistory.findFirst({
      where: { documentId: document.id, action: "REQUESTED_REVISION" },
      orderBy: { performedAt: "desc" },
      select: { comments: true, performedById: true },
    }),
  ]);
  const isRevision = document.status === DocumentStatus.REVISION_REQUIRED;
  const returnedForReview = document.status === DocumentStatus.PENDING && latestHistory?.action === "RESUBMITTED";
  if (!isRevision && document.status !== DocumentStatus.PENDING && document.status !== DocumentStatus.ON_HOLD) {
    redirect(`/documents/${document.id}`);
  }

  const level = document.currentWorkflowStep;
  const step = level === null ? undefined : document.approvalSteps.find((candidate) => candidate.levelNumber === level);
  if (!step) redirect("/unauthorized");

  const canAct = await createEligibilityChecker(prisma, session.userId);
  const allowed =
    session.userType === USER_TYPE.ADMIN ||
    (returnedForReview
      ? latestRevisionRequest?.performedById === session.userId
      : isRevision && level === 0
        // Sent back to the uploader: only the person who uploaded it.
        ? document.createdById === session.userId
        : canAct(step.approvers, {
            projectId: document.projectId,
            locationId: document.project?.locationId ?? null,
            companyId: document.project?.companyId ?? null,
            documentTypeId: document.documentTypeId,
            documentSubtypeId: document.documentSubtypeId,
          }));
  if (!allowed) redirect("/unauthorized");

  const returnUrl = "/tasks";

  // Reference documents the reviewer may see (the "View reference documents" permission, or an Admin user).
  const referenceDocuments = (await getVisibleReferenceDocuments(session, document.id)).map((reference) => ({
    id: reference.id,
    documentNumber: reference.documentNumber,
    title: reference.title,
    typeName: reference.documentType.name,
  }));

  // The documents this one follows in its process (and their reference documents), for the "Related documents" tab.
  const relatedDocuments = await getRelatedDocumentsForReview(session, document.id);

  const user = await prisma.user.findUnique({ where: { id: session.userId }, select: { signaturePath: true } });

  // Whether a signature is needed is a setting of the flow level this document is waiting at ("Signature required").
  const allowNoSignature = !step.signatureRequired;

  // The document can go back to any earlier step, named from its own flow (level 0 is the uploader).
  // With unique tracks the document goes back to whoever really sent it here, so that person is the only target.
  // A revision always goes back to the previous level (a document sent to this person for approval goes back to its sender).
  const sentFrom = isRevision || level === null ? null : previousLevel(document.approvalSteps, level);
  const revisionTargets = sentFrom
    ? [{ levelNumber: sentFrom.levelNumber, label: step.isSideApproval ? step.sentBy?.name ?? "Sender" : sentFrom.levelNumber === 0 ? "Uploader" : sentFrom.name?.trim() || `Level ${sentFrom.levelNumber}` }]
    : [];

  // "Send for approval": Admin users, and anyone holding the permission for this document, can pick another user to
  // approve first. Only while the document is waiting for a decision (not on hold, not in revision).
  const canSendForApproval =
    document.status === DocumentStatus.PENDING &&
    !isRevision &&
    (await userHasPermissionForDocument(session, SEND_FOR_APPROVAL_PERMISSION, {
      projectId: document.projectId,
      documentTypeId: document.documentTypeId,
      documentSubtypeId: document.documentSubtypeId,
      project: document.project,
    }));
  const sendRecipients = canSendForApproval
    ? (
        await prisma.user.findMany({
          where: { isActive: true, id: { not: session.userId } },
          select: { id: true, name: true, email: true, userType: { select: { name: true } } },
          orderBy: [{ name: "asc" }, { email: "asc" }],
        })
      ).map((candidate) => ({ id: candidate.id, name: candidate.name, email: candidate.email, userTypeName: candidate.userType.name }))
    : [];

  // Unique tracks the person can tick at this level (not offered on a track step itself), for people with the
  // "Use unique tracks" permission for this document (Admin users always have it).
  const mayUseTracks =
    !isRevision && !step.isTrackStep && !step.isSideApproval && document.status === DocumentStatus.PENDING &&
    (await userHasPermissionForDocument(session, UNIQUE_TRACK_PERMISSION, {
      projectId: document.projectId,
      documentTypeId: document.documentTypeId,
      documentSubtypeId: document.documentSubtypeId,
    }));
  const trackRows =
    !mayUseTracks
      ? []
      : await prisma.documentApprovalTrack.findMany({
          where: { step: { documentId: document.id, levelNumber: step.levelNumber } },
          orderBy: { sortOrder: "asc" },
          select: { id: true, name: true, returnLevel: true, receiver: { select: { name: true } } },
        });
  const labelOf = (levelNumber: number) => {
    const found = document.approvalSteps.find((candidate) => candidate.levelNumber === levelNumber);
    return found?.name?.trim() || `level ${levelNumber}`;
  };
  const tracks = trackRows.map((track) => ({
    id: track.id,
    name: track.name,
    receiverName: track.receiver.name,
    returnLabel: track.returnLevel === null ? "full approval" : labelOf(track.returnLevel),
  }));

  return (
    <DocumentReviewEditor
      documentId={document.id}
      documentNumber={document.documentNumber}
      title={document.title}
      hasSignature={Boolean(user?.signaturePath)}
      allowNoSignature={allowNoSignature}
      documentStatus={document.status}
      revisionTargets={revisionTargets}
      tracks={tracks}
      sendRecipients={sendRecipients}
      sentForApprovalBy={step.isSideApproval && !isRevision ? step.sentBy?.name ?? "the sender" : null}
      revisionMode={isRevision}
      revisionComment={isRevision ? latestRevisionRequest?.comments ?? null : null}
      downloadUrl={`/api/documents/${document.id}/download?version=${document.currentVersion}`}
      referenceDocuments={referenceDocuments}
      relatedDocuments={relatedDocuments}
      allowHold
      returnUrl={returnUrl}
    />
  );
}
