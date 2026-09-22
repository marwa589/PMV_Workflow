import { UserRole } from "@prisma/client";
import DashboardShell from "@/components/dashboard-shell";
import DocumentListTable from "@/components/document-list-table";
import DocumentStatusFilter from "@/components/document-status-filter";
import PageSummaryCards from "@/components/page-summary-cards";
import { requireRole } from "@/lib/auth/guards";
import { parseDocumentTypeFilter } from "@/lib/document-status";
import { getDocumentsForAdmin } from "@/lib/document-queries";

export const dynamic = "force-dynamic";

export default async function AdminPendingApprovalsPage({ searchParams }: any) {
  const session = await requireRole([UserRole.ADMIN]);
  const resolvedSearchParams = await Promise.resolve(searchParams);
  const documentTypeFilter = parseDocumentTypeFilter(resolvedSearchParams?.documentType);
  const data = await getDocumentsForAdmin();

  const documents = [
    ...data.pendingDocuments
      .filter((doc) => !documentTypeFilter || doc.documentType === documentTypeFilter)
      .map((doc) => ({
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
      })),
    ...data.errPendingDocuments
      .filter((doc) => !documentTypeFilter || documentTypeFilter === "ERR")
      .map((doc) => ({
        id: doc.id,
        documentNumber: doc.documentNumber,
        title: doc.title,
        status: doc.status,
        documentType: "ERR" as const,
        mrType: null,
        currentVersion: 1,
        currentApproverName: doc.currentApprover?.name || null,
        relatedComparisonId: null,
        relatedComparisonDocumentNumber: null,
        dateLabel: new Intl.DateTimeFormat("en-US", { dateStyle: "medium" }).format(doc.createdAt),
      })),
  ];

  const cards = [
    { label: "Assigned/Handled", value: String(documents.length), tone: "bg-slate-900 text-white" },
    { label: "MRs", value: String(documents.filter((doc) => doc.documentType === "MATERIAL_REQUISITION").length), tone: "bg-slate-50 text-slate-900 ring-1 ring-slate-200" },
    { label: "Comparison Sheets", value: String(documents.filter((doc) => doc.documentType === "COMPARISON").length), tone: "bg-sky-50 text-sky-900 ring-1 ring-sky-200" },
    { label: "ERRs", value: String((documents as Array<{ documentType: string }>).filter((doc) => doc.documentType === "ERR").length), tone: "bg-violet-50 text-violet-900 ring-1 ring-violet-200" },
  ];

  return (
    <DashboardShell role={session.role} userName={session.name} title="Pending Approvals" subtitle="Administrative pending queue">
      <PageSummaryCards cards={cards} />
      <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 px-5 py-4">
          <h3 className="text-base font-semibold text-slate-900">Pending Approvals</h3>
        </div>
        <div className="border-b border-slate-200 px-5 py-4">
          <DocumentStatusFilter documentType={documentTypeFilter} showDocumentTypeFilter showStatusFilter={false} />
        </div>
        <DocumentListTable documents={documents} emptyMessage="No pending approvals." showBulkActions allowAdminDelete />
      </section>
    </DashboardShell>
  );
}
