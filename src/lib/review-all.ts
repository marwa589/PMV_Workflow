import "server-only";

import { DocumentStatus } from "@prisma/client";
import { canApproveErr, getErrAccess } from "@/lib/err/permissions";
import { prisma } from "@/lib/prisma";
import { canUseReviewAll } from "@/lib/review-all-access";

export type ReviewAllCounts = {
  mr: number;
  comparison: number;
  err: number;
};

const PENDING_DOCUMENT_STATUSES = [
  DocumentStatus.PENDING_APPROVER_1,
  DocumentStatus.PENDING_APPROVER_2,
  DocumentStatus.PENDING_APPROVER_3,
];

export async function getReviewAllCounts(userId: string, email: string): Promise<ReviewAllCounts> {
  if (!canUseReviewAll(email)) return { mr: 0, comparison: 0, err: 0 };

  const [mr, comparison, errAccess] = await Promise.all([
    prisma.document.count({
      where: {
        currentApproverId: userId,
        status: { in: PENDING_DOCUMENT_STATUSES },
        documentType: "MATERIAL_REQUISITION",
        relatedComparisonId: null,
      },
    }),
    prisma.document.count({
      where: {
        currentApproverId: userId,
        status: { in: PENDING_DOCUMENT_STATUSES },
        documentType: "COMPARISON",
        linkedMRs: { none: {} },
      },
    }),
    getErrAccess(),
  ]);

  let err = 0;
  if (errAccess?.userId === userId && errAccess.canAccessErrModule) {
    const pendingErrs = await prisma.err.findMany({
      where: { currentApproverId: userId, status: "PENDING" },
      select: { id: true },
    });
    for (const pendingErr of pendingErrs) {
      if (await canApproveErr(errAccess, pendingErr.id)) err += 1;
    }
  }

  return { mr, comparison, err };
}