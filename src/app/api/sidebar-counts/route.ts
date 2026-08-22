import { DocumentStatus, UserRole } from "@prisma/client";
import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ materialRequisitions: 0, comparisons: 0 }, { status: 401 });

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
      DocumentStatus.REVISION_REQUIRED,
    ],
  };

  const [materialRequisitions, comparisons] = await Promise.all([
    prisma.document.count({ where: { ...baseWhere, documentType: "MATERIAL_REQUISITION", status: pendingStatuses } }),
    prisma.document.count({ where: { ...baseWhere, documentType: "COMPARISON", status: pendingStatuses } }),
  ]);

  return NextResponse.json({ materialRequisitions, comparisons });
}
