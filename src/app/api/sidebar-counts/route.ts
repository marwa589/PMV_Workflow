import { DocumentStatus, UserRole } from "@prisma/client";
import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { canAccessMrModule } from "@/lib/auth/resource-access";
import { getModuleVisibility } from "@/lib/auth/module-visibility";
import { getErrAccess } from "@/lib/err/permissions";
import { getErrCounts } from "@/lib/err/queries";

export const runtime = "nodejs";

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ materialRequisitions: 0, comparisons: 0, pendingApprovals: 0, errs: 0 }, { status: 401 });

  const visibility = getModuleVisibility(session.name, session.role);
  const canQueryDocuments = canAccessMrModule(session.role) && visibility !== "ERR_ONLY";
  const canQueryErrs = visibility !== "DOCUMENTS_ONLY";

  let materialRequisitions = 0;
  let comparisons = 0;
  let documentPendingApprovals = 0;
  let errPendingApprovals = 0;

  if (canQueryDocuments) {
  const baseWhere = session.role === UserRole.CLERK
    ? { createdById: session.userId }
    : session.role === UserRole.ADMIN
      ? {}
      : { currentApproverId: session.userId };

  const pendingStatuses = {
    in: [
      DocumentStatus.PENDING_APPROVER_1,
      DocumentStatus.PENDING_APPROVER_2,
      DocumentStatus.PENDING_APPROVER_3,
    ],
  };

    [materialRequisitions, comparisons, documentPendingApprovals] = await Promise.all([
      prisma.document.count({ where: { ...baseWhere, documentType: "MATERIAL_REQUISITION", status: pendingStatuses } }),
      prisma.document.count({ where: { ...baseWhere, documentType: "COMPARISON", status: pendingStatuses } }),
      prisma.document.count({ where: { ...baseWhere, status: pendingStatuses } }),
    ]);
  }

  if (canQueryErrs) {
    const access = await getErrAccess();
    if (access?.canAccessErrModule) {
      errPendingApprovals = (await getErrCounts(access)).pending;
    }
  }

  return NextResponse.json({
    materialRequisitions,
    comparisons,
    pendingApprovals: documentPendingApprovals + errPendingApprovals,
    errs: errPendingApprovals,
  });
}
