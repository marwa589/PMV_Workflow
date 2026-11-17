import { UserRole } from "@prisma/client";
import { notFound, redirect } from "next/navigation";
import DocumentReviewEditor from "@/components/document-review-editor";
import {
  canApproveErr,
  getErrVisibilityWhere,
  requireErrAccess,
} from "@/lib/err/permissions";
import { prisma } from "@/lib/prisma";
import { canRedirectDocuments } from "@/lib/document-redirect";

export const dynamic = "force-dynamic";

type Props = {
  params: Promise<{ id: string }>;
};

export default async function ErrReviewPage({ params }: Props) {
  const access = await requireErrAccess();
  const { id } = await params;

  if (!(await canApproveErr(access, id))) {
    redirect("/unauthorized");
  }

  const err = await prisma.err.findFirst({
    where: {
      AND: [
        { id },
        getErrVisibilityWhere(access),
      ],
    },
    select: {
      id: true,
      documentNumber: true,
      title: true,
      status: true,
      currentStage: true,
      currentApproverId: true,
      redirectedById: true,
      redirectedBy: { select: { name: true } },
    },
  });

  if (!err || (err.status !== "PENDING" && err.status !== "ON_HOLD")) {
    notFound();
  }

  const user = await prisma.user.findUnique({
    where: { id: access.userId },
    select: { signaturePath: true },
  });

  // The person Marc redirected the ERR to: approve / reject / revision only; approving sends it back to Marc.
  const isRedirectTarget = Boolean(err.redirectedById) && err.currentApproverId === access.userId;
  // Marc can redirect an ERR at his stage to any user except KSA viewers.
  const canRedirect = !isRedirectTarget
    && canRedirectDocuments(access.email)
    && err.currentStage === "PMV_MANAGER"
    && err.status === "PENDING";
  const redirectUsers = canRedirect
    ? await prisma.user.findMany({
        where: { id: { not: access.userId }, role: { not: UserRole.KSA_VIEWER } },
        select: { id: true, name: true, email: true },
        orderBy: [{ name: "asc" }, { email: "asc" }],
      })
    : [];

  return (
    <DocumentReviewEditor
      documentId={err.id}
      documentNumber={err.documentNumber}
      title={err.title}
      errStage={err.currentStage}
      hasSignature={Boolean(user?.signaturePath)}
      allowQuotationUpload={err.currentStage === "PMV_MANAGER" && !isRedirectTarget}
      downloadUrl={`/api/errs/${id}/download?kind=ERR_PDF`}
      actionUrl={`/api/errs/${id}/actions`}
      returnUrl={isRedirectTarget ? "/redirected-documents" : `/errs/${id}`}
      allowHold={!isRedirectTarget}
      redirectUsers={canRedirect ? redirectUsers : undefined}
      redirectBackToRedirectorOnly
      redirectedByName={isRedirectTarget ? err.redirectedBy?.name ?? "" : null}
      redirectFallback={isRedirectTarget ? "BACK_TO_REDIRECTOR" : null}
      hideApprovalRoute={isRedirectTarget}
    />
  );
}
