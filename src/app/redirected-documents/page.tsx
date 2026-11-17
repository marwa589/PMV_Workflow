import { DocumentStatus } from "@prisma/client";
import DashboardShell from "@/components/dashboard-shell";
import ApproverPendingTable from "@/components/approver-pending-table";
import { requireAuth } from "@/lib/auth/guards";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/** Documents and ERRs Marc redirected to the signed-in user (any role) that are waiting for their review. */
export default async function RedirectedDocumentsPage() {
  const session = await requireAuth();

  const documents = await prisma.document.findMany({
    where: {
      currentApproverId: session.userId,
      redirectedById: { not: null },
      status: { in: [DocumentStatus.PENDING_APPROVER_1, DocumentStatus.PENDING_APPROVER_2, DocumentStatus.PENDING_APPROVER_3] },
    },
    select: {
      id: true,
      documentNumber: true,
      title: true,
      documentType: true,
      mrType: true,
      currentVersion: true,
      createdAt: true,
      updatedAt: true,
      relatedComparison: { select: { id: true, documentNumber: true } },
    },
    orderBy: { updatedAt: "desc" },
  });

  const errs = await prisma.err.findMany({
    where: {
      currentApproverId: session.userId,
      redirectedById: { not: null },
      status: "PENDING",
    },
    select: {
      id: true,
      documentNumber: true,
      title: true,
      createdAt: true,
      updatedAt: true,
      files: {
        where: { kind: "ERR_PDF" },
        orderBy: [{ versionNumber: "desc" }, { createdAt: "desc" }],
        take: 1,
        select: { versionNumber: true },
      },
    },
    orderBy: { updatedAt: "desc" },
  });

  const rows = [
    ...documents.map((doc) => ({
      id: doc.id,
      documentNumber: doc.documentNumber,
      title: doc.title,
      documentType: doc.documentType,
      mrType: doc.mrType,
      currentVersion: doc.currentVersion,
      uploadedAt: new Intl.DateTimeFormat("en-US", { dateStyle: "medium" }).format(doc.createdAt),
      lastUpdatedAt: doc.updatedAt,
      relatedComparisonId: doc.relatedComparison?.id ?? null,
      relatedComparisonDocumentNumber: doc.relatedComparison?.documentNumber ?? null,
    })),
    ...errs.map((err) => ({
      id: err.id,
      documentNumber: err.documentNumber,
      title: err.title,
      documentType: "ERR" as const,
      mrType: null,
      currentVersion: err.files[0]?.versionNumber ?? 1,
      uploadedAt: new Intl.DateTimeFormat("en-US", { dateStyle: "medium" }).format(err.createdAt),
      lastUpdatedAt: err.updatedAt,
      relatedComparisonId: null,
      relatedComparisonDocumentNumber: null,
    })),
  ];

  return (
    <DashboardShell
      role={session.role}
      userName={session.name}
      userEmail={session.email}
      title="Redirected to Me"
      subtitle="Documents and ERRs redirected to you for review"
    >
      <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 px-5 py-4">
          <h3 className="text-base font-semibold text-slate-900">Redirected to Me</h3>
        </div>
        <div className="px-1 py-4">
          <ApproverPendingTable
            showQuotation={false}
            documents={rows}
          />
        </div>
      </section>
    </DashboardShell>
  );
}
