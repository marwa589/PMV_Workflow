import { notFound, redirect } from "next/navigation";
import DocumentReviewEditor from "@/components/document-review-editor";
import {
  canApproveErr,
  getErrVisibilityWhere,
  requireErrAccess,
} from "@/lib/err/permissions";
import { prisma } from "@/lib/prisma";

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
    },
  });

  if (!err || (err.status !== "PENDING" && err.status !== "ON_HOLD")) {
    notFound();
  }

  const user = await prisma.user.findUnique({
    where: { id: access.userId },
    select: { signaturePath: true },
  });

  return (
    <DocumentReviewEditor
      documentId={err.id}
      documentNumber={err.documentNumber}
      title={err.title}
      errStage={err.currentStage}
      hasSignature={Boolean(user?.signaturePath)}
      allowQuotationUpload={err.currentStage === "PMV_MANAGER"}
      downloadUrl={`/api/errs/${id}/download?kind=ERR_PDF`}
      actionUrl={`/api/errs/${id}/actions`}
      returnUrl={`/errs/${id}`}
      allowHold
    />
  );
}
