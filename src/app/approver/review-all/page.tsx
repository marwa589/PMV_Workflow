import { DocumentStatus } from "@prisma/client";
import { redirect } from "next/navigation";
import BatchDocumentReview from "@/components/batch-document-review";
import { requireAuth } from "@/lib/auth/guards";
import { canApproveErr, getErrAccess } from "@/lib/err/permissions";
import { prisma } from "@/lib/prisma";
import { canUseReviewAll } from "@/lib/review-all-access";

export const dynamic = "force-dynamic";

const PENDING_STATUSES = [
  DocumentStatus.PENDING_APPROVER_1,
  DocumentStatus.PENDING_APPROVER_2,
  DocumentStatus.PENDING_APPROVER_3,
];

export default async function ReviewAllPage({ searchParams }: { searchParams: Promise<{ type?: string }> }) {
  const session = await requireAuth();
  const { type } = await searchParams;
  if (type !== "MR" && type !== "COMPARISON" && type !== "ERR") redirect("/approver/pending-approvals");

  const user = await prisma.user.findUnique({ where: { id: session.userId }, select: { signaturePath: true } });
  if (!user || !canUseReviewAll(session.email)) redirect("/unauthorized");

  const documents = type === "ERR" ? [] : await prisma.document.findMany({
      where: {
        currentApproverId: session.userId,
        status: { in: PENDING_STATUSES },
        ...(type === "MR"
          ? { documentType: "MATERIAL_REQUISITION" as const, relatedComparisonId: null }
          : { documentType: "COMPARISON" as const, linkedMRs: { none: {} } }),
      },
      select: {
        id: true,
        documentNumber: true,
        title: true,
        documentType: true,
        currentVersion: true,
      },
      orderBy: { createdAt: "asc" },
    });

  const errAccess = type === "ERR" ? await getErrAccess() : null;
  const errDocuments = type === "ERR" && errAccess?.userId === session.userId && errAccess.canAccessErrModule
    ? await prisma.err.findMany({
        where: { currentApproverId: session.userId, status: "PENDING" },
        select: { id: true, documentNumber: true, title: true, currentStage: true },
        orderBy: { createdAt: "asc" },
      })
    : [];
  const approvableErrs = [];
  for (const err of errDocuments) {
    if (errAccess && await canApproveErr(errAccess, err.id)) approvableErrs.push(err);
  }

  const reviewItems = [
    ...documents.map((document) => ({
      id: document.id,
      documentNumber: document.documentNumber,
      title: document.title,
      documentType: document.documentType,
      downloadUrl: `/api/documents/${document.id}/download`,
      actionUrl: `/api/documents/${document.id}/actions`,
    })),
    ...approvableErrs.map((err) => ({
      id: err.id,
      documentNumber: err.documentNumber,
      title: err.title,
      documentType: "ERR" as const,
      errStage: err.currentStage,
      downloadUrl: `/api/errs/${err.id}/download?kind=ERR_PDF`,
      actionUrl: `/api/errs/${err.id}/actions`,
    })),
  ];

  return (
    <BatchDocumentReview
      items={reviewItems}
      hasSignature={Boolean(user.signaturePath)}
      returnUrl="/approver/pending-approvals"
    />
  );
}