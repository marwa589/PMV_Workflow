import { DocumentStatus, UserRole } from "@prisma/client";
import DashboardShell from "@/components/dashboard-shell";
import DocumentListTable from "@/components/document-list-table";
import PageSummaryCards from "@/components/page-summary-cards";
import { requireRole } from "@/lib/auth/guards";
import { getDocumentsForAdmin } from "@/lib/document-queries";

export const dynamic = "force-dynamic";

export default async function AdminArchivePage() {
  const session = await requireRole([UserRole.ADMIN]);
  const data = await getDocumentsForAdmin();

  const documents = data.documents
    .filter((doc) => doc.status === DocumentStatus.ARCHIVED)
    .map((doc) => ({
      id: doc.id,
      documentNumber: doc.documentNumber,
      title: doc.title,
      status: doc.status,
      currentVersion: doc.currentVersion,
      currentApproverName: doc.currentApprover?.name || null,
      relatedComparisonId: doc.relatedComparison?.id || null,
      relatedComparisonDocumentNumber: doc.relatedComparison?.documentNumber || null,
      dateLabel: new Intl.DateTimeFormat("en-US", { dateStyle: "medium" }).format(doc.createdAt),
    }));

  return (
    <DashboardShell role={session.role} userName={session.name} title="Archive" subtitle="Administrative archive">
      <PageSummaryCards
        cards={[
          { label: "Archived", value: String(documents.length), tone: "bg-slate-200 text-slate-800 ring-1 ring-slate-300" },
          { label: "All Documents", value: String(data.documents.length), tone: "bg-slate-900 text-white" },
          { label: "Pending", value: String(data.pendingDocuments.length), tone: "bg-amber-50 text-amber-900 ring-1 ring-amber-200" },
        ]}
      />
      <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 px-5 py-4">
          <h3 className="text-base font-semibold text-slate-900">Archive</h3>
        </div>
        <DocumentListTable documents={documents} emptyMessage="No archived documents." />
      </section>
    </DashboardShell>
  );
}
