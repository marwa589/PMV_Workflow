import { UserRole } from "@prisma/client";
import { notFound, redirect } from "next/navigation";
import DocumentReviewEditor from "@/components/document-review-editor";
import { requireAuth } from "@/lib/auth/guards";
import { hasRequiredRole } from "@/lib/auth/permissions";
import { prisma } from "@/lib/prisma";
import { isAvkUploaderWorkflowDocument, isRamziDocumentApprover } from "@/lib/mohamed-document-workflow";
import { canRedirectDocuments, isRedirectedToUser } from "@/lib/document-redirect";
import { isKsaProjectDirectorForDocument } from "@/lib/ksa-projects";

export const dynamic = "force-dynamic";

export default async function ApproverDocumentReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireAuth();
  const { id } = await params;
  const document = await prisma.document.findUnique({
    where: { id },
    select: {
      id: true,
      documentNumber: true,
      title: true,
      currentApproverId: true,
      currentVersion: true,
      documentType: true,
      projectName: true,
      status: true,
      uploaderLocation: true,
      createdBy: { select: { email: true, location: true } },
      versions: { where: { versionNumber: { equals: 0 } }, select: { id: true } },
      createdById: true,
      redirectedById: true,
      redirectFallback: true,
      redirectedBy: { select: { name: true } },
    },
  });

  if (!document) notFound();
  if (document.currentApproverId !== session.userId) redirect("/unauthorized");
  // Someone Marc redirected the document to can review it whatever their role.
  const isRedirectTarget = isRedirectedToUser(document, session.userId);
  // KSA project director stage (Ready Mix Khobar: Elie Azzam; WP03 MRs: Elias Nassar).
  const isReadyMixProjectDirector = isKsaProjectDirectorForDocument(session.email, document)
    && document.status === "PENDING_APPROVER_1";
  const isMohamedWorkflowApproval = isRamziDocumentApprover(session.email)
    && document.documentType === "MATERIAL_REQUISITION"
    && isAvkUploaderWorkflowDocument(document.createdBy.email, document.documentType, document.uploaderLocation)
    && document.status === "PENDING_APPROVER_1";
  if (!hasRequiredRole(session, [UserRole.APPROVER_1, UserRole.APPROVER_2, UserRole.APPROVER_3]) && !isReadyMixProjectDirector && !isMohamedWorkflowApproval && !isRedirectTarget) {
    redirect("/unauthorized");
  }

  const canRedirect = !isRedirectTarget
    && canRedirectDocuments(session.email)
    && (document.status === "PENDING_APPROVER_1" || document.status === "PENDING_APPROVER_2" || document.status === "PENDING_APPROVER_3");
  const redirectUsers = canRedirect
    ? await prisma.user.findMany({
        where: { id: { not: session.userId }, role: { not: UserRole.KSA_VIEWER } },
        select: { id: true, name: true, email: true },
        orderBy: [{ name: "asc" }, { email: "asc" }],
      })
    : [];

  const user = await prisma.user.findUnique({
    where: { id: session.userId },
    select: { email: true, signaturePath: true },
  });

  const allowNoSignature = [
    "mohammad.mehieddine@ahmadiah.com",
    "joemar.paraiso@ahmadiah.com",
  ].includes(user?.email?.trim().toLowerCase() || "");
  const isGeorgeAvrOrAvkMr = user?.email?.trim().toLowerCase() === "george.azzi@ahmadiah.com"
    && document.documentType === "MATERIAL_REQUISITION"
    && (document.createdBy.location === "AVR" || document.createdBy.location === "AVK");

  return (
    <DocumentReviewEditor
      documentId={document.id}
      documentNumber={document.documentNumber}
      title={document.title}
      hasSignature={Boolean(user?.signaturePath)}
      allowNoSignature={allowNoSignature || isGeorgeAvrOrAvkMr}
      allowApprovalRouteSelection={session.role === UserRole.APPROVER_3 && !isRedirectTarget}
      redirectUsers={canRedirect ? redirectUsers : undefined}
      redirectedByName={isRedirectTarget ? document.redirectedBy?.name ?? "" : null}
      redirectFallback={isRedirectTarget ? document.redirectFallback : null}
      returnUrl={isRedirectTarget ? "/redirected-documents" : isReadyMixProjectDirector ? "/errs?section=dashboard" : isMohamedWorkflowApproval ? "/approver/my-documents" : undefined}
    />
  );
}
