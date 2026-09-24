import { ApprovalActionType, DocumentStatus } from "@prisma/client";
import Link from "next/link";
import DashboardShell from "@/components/dashboard-shell";
import ProcurementPackageTables from "@/components/procurement-package-tables";
import { requireAuth } from "@/lib/auth/guards";
import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import { canAccessMrModuleForSession, isRestrictedClerk } from "@/lib/auth/resource-access";
export const dynamic = "force-dynamic";

export default async function ProcurementPackagesPage() {
  const session = await requireAuth();
    if (!canAccessMrModuleForSession(session)) {
    redirect("/unauthorized");
  }

  const isRestricted = isRestrictedClerk(session);

  const packages = await prisma.document.findMany({
    where: {
      documentType: "MATERIAL_REQUISITION",
      relatedComparison: { status: DocumentStatus.APPROVED },
      ...(isRestricted
        ? { createdById: session.userId }
        : {}),
    },
    select: {
      id: true,
      documentNumber: true,
      title: true,
      mrType: true,
      mrNumber: true,
      status: true,
      createdAt: true,
      updatedAt: true,
      relatedComparison: {
        select: {
          id: true,
          documentNumber: true,
          title: true,
          approvals: {
            where: { action: ApprovalActionType.APPROVED },
            orderBy: { performedAt: "desc" },
            take: 1,
            select: { performedAt: true },
          },
        },
      },
    },
    orderBy: { updatedAt: "desc" },
  });

  // Approved comparisons with no linked MR submitted yet
  const orphanComparisons = await prisma.document.findMany({
    where: {
      documentType: "COMPARISON",
      status: DocumentStatus.APPROVED,
      linkedMRs: { none: {} },
      ...(isRestricted ? { createdById: session.userId } : {}),
    },
    select: {
      id: true,
      documentNumber: true,
      title: true,
      approvals: {
        where: { action: ApprovalActionType.APPROVED },
        orderBy: { performedAt: "desc" },
        take: 1,
        select: { performedAt: true },
      },
    },
    orderBy: { updatedAt: "desc" },
  });

  const now = Date.now();

  return (
    <DashboardShell role={session.role} userName={session.name} title="MRs + Comparisons" subtitle="MRs with approved related comparison sheets">
      <ProcurementPackageTables
        packages={packages.map((item) => ({
          id: item.id,
          documentNumber: item.documentNumber,
          mrType: item.mrType,
          status: item.status,
          updatedAt: item.updatedAt.toISOString(),
          createdAt: item.createdAt.toISOString(),
          relatedComparison: item.relatedComparison ? {
            id: item.relatedComparison.id,
            documentNumber: item.relatedComparison.documentNumber,
            title: item.relatedComparison.title,
            approvedAt: item.relatedComparison.approvals[0]?.performedAt.toISOString() ?? null,
          } : null,
        }))}
        orphanComparisons={orphanComparisons.map((comp) => ({
          id: comp.id,
          documentNumber: comp.documentNumber,
          title: comp.title,
          approvedAt: comp.approvals[0]?.performedAt.toISOString() ?? null,
        }))}
        now={now}
      />
    </DashboardShell>
  );
}
