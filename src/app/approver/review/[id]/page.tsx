// src/app/approver/review/[id]/page.tsx
import { DocumentStatus } from "@prisma/client";
import { notFound, redirect } from "next/navigation";
import DocumentReviewEditor from "@/components/document-review-editor";
import { requireAuth } from "@/lib/auth/guards";
import { userHasPermissionForDocument } from "@/lib/auth/access";
import { USER_TYPE } from "@/lib/auth/roles";
import { prisma } from "@/lib/prisma";
import { createEligibilityChecker } from "@/lib/workflow/eligibility";

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
      project: { select: { locationId: true } },
      approvalSteps: {
        orderBy: { levelNumber: "asc" },
        select: { levelNumber: true, name: true, approvers: { select: { approverType: true, userId: true, userTypeId: true } } },
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
      : (isRevision && level === 0 && document.createdById === session.userId) ||
        canAct(step.approvers, {
          projectId: document.projectId,
          locationId: document.project?.locationId ?? null,
          documentTypeId: document.documentTypeId,
          documentSubtypeId: document.documentSubtypeId,
        }));
  if (!allowed) redirect("/unauthorized");

  const returnUrl = isRevision
    ? session.userType === USER_TYPE.CLERK
      ? "/clerk/my-documents?status=REVISION_REQUIRED"
      : session.userType === USER_TYPE.ADMIN
        ? "/admin/all-documents?status=REVISION_REQUIRED"
        : "/approver/my-documents?status=REVISION_REQUIRED"
    : session.userType === USER_TYPE.CLERK
      ? "/clerk/my-documents"
      : session.userType === USER_TYPE.ADMIN
        ? "/admin/pending-approvals"
        : "/approver/pending-approvals";

  const user = await prisma.user.findUnique({ where: { id: session.userId }, select: { signaturePath: true } });

  // Approving without a signature is a permission (documents.approve_without_signature), scoped like any other,
  // so it can be limited to a document type or location instead of being tied to named people.
  const allowNoSignature = await userHasPermissionForDocument(session, "documents.approve_without_signature", document);

  // The document can go back to any earlier step, named from its own flow (level 0 is the uploader).
  const revisionTargets = document.approvalSteps
    .filter((candidate) => !isRevision && document.currentWorkflowStep !== null && candidate.levelNumber < document.currentWorkflowStep)
    .map((candidate) => ({ levelNumber: candidate.levelNumber, label: candidate.levelNumber === 0 ? "Uploader" : candidate.name?.trim() || `Level ${candidate.levelNumber}` }));

  return (
    <DocumentReviewEditor
      documentId={document.id}
      documentNumber={document.documentNumber}
      title={document.title}
      hasSignature={Boolean(user?.signaturePath)}
      allowNoSignature={allowNoSignature}
      documentStatus={document.status}
      revisionTargets={revisionTargets}
      revisionMode={isRevision}
      revisionComment={isRevision ? latestRevisionRequest?.comments ?? null : null}
      downloadUrl={`/api/documents/${document.id}/download?version=${document.currentVersion}`}
      allowHold
      returnUrl={returnUrl}
    />
  );
}
