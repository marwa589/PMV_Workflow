import DashboardShell from "@/components/dashboard-shell";
import DocumentListTable from "@/components/document-list-table";
import PageSummaryCards from "@/components/page-summary-cards";
import { requireRole } from "@/lib/auth/guards";
import { getDocumentsForClerk } from "@/lib/document-queries";
import { UserRole } from "@prisma/client";

export const dynamic = "force-dynamic";

export default async function ClerkRejectedDocumentsPage() {
  await requireRole([UserRole.CLERK]);
  const data = await getDocumentsForClerk("");

  const documents = data.rejectedDocuments.map((doc) => ({
    id: doc.id,
    documentNumber: doc.documentNumber,
    title: doc.title,
    status: doc.status,
    documentType: doc.documentType,
    mrType: doc.mrType,
    currentVersion: doc.currentVersion,
    currentApproverName: doc.currentApprover?.name || null,
    relatedComparisonId: doc.relatedComparison?.id || null,
    relatedComparisonDocumentNumber: doc.relatedComparison?.documentNumber || null,
    dateLabel: new Intl.DateTimeFormat("en-US", { dateStyle: "medium" }).format(doc.createdAt),
  }));

  return (
    <DashboardShell role={UserRole.CLERK} userName="Workshop Manager" title="Rejected Documents" subtitle="Documents rejected during the approval workflow">
      <PageSummaryCards
        cards={[
          { label: "Total Rejected", value: String(data.rejected), tone: "bg-rose-50 text-rose-900 ring-1 ring-rose-200" },
          { label: "Pending Review", value: String(data.pending), tone: "bg-amber-50 text-amber-900 ring-1 ring-amber-200" },
          { label: "Approved", value: String(data.approved), tone: "bg-emerald-50 text-emerald-900 ring-1 ring-emerald-200" },
        ]}
      />
      <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 px-5 py-4">
          <h3 className="text-base font-semibold text-slate-900">Rejected Documents</h3>
        </div>
        <DocumentListTable documents={documents} emptyMessage="No rejected documents." />
      </section>
    </DashboardShell>
  );
}
