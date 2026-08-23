import { DocumentStatus, UserRole } from "@prisma/client";
import DashboardShell from "@/components/dashboard-shell";
import DocumentListTable from "@/components/document-list-table";
import DocumentStatusFilter from "@/components/document-status-filter";
import PageSummaryCards from "@/components/page-summary-cards";
import { requireRole } from "@/lib/auth/guards";
import { parseDocumentStatusFilter, parseDocumentTypeFilter } from "@/lib/document-status";
import { parseSearchQuery, matchesDocumentSearch } from "@/lib/document-search";
import { getDocumentsForAdmin } from "@/lib/document-queries";

export const dynamic = "force-dynamic";

export default async function AdminAllDocumentsPage({ searchParams }: any) {
  const session = await requireRole([UserRole.ADMIN]);
  const data = await getDocumentsForAdmin();
  const resolvedSearchParams = await Promise.resolve(searchParams);
  const statusFilter = parseDocumentStatusFilter(resolvedSearchParams?.status);
  const documentTypeFilter = parseDocumentTypeFilter(resolvedSearchParams?.documentType);
  const searchQuery = parseSearchQuery(resolvedSearchParams?.search);

  const pageTitle = documentTypeFilter === "MATERIAL_REQUISITION" ? "MRs" : documentTypeFilter === "COMPARISON" ? "Comparison Sheets" : "All Documents";
  const pageSubtitle = documentTypeFilter === "MATERIAL_REQUISITION"
    ? "Administrative MR document list"
    : documentTypeFilter === "COMPARISON"
      ? "Administrative comparison document list"
      : "Administrative global document list";

  const documents = data.documents
    .filter((doc) => !statusFilter || doc.status === statusFilter)
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
    mrNumber: doc.mrNumber || null,
    relatedComparisonDocumentNumber: doc.relatedComparison?.documentNumber || null,
    relatedComparisonTitle: doc.relatedComparison?.title || null,
    dateLabel: new Intl.DateTimeFormat("en-US", { dateStyle: "medium" }).format(doc.createdAt),
  }));

  const filteredDocuments = documents.filter((doc) => matchesDocumentSearch(doc, searchQuery));

  const summaryCounts = {
    total: documents.length,
    pending: documents.filter((doc) => doc.status === DocumentStatus.PENDING_APPROVER_1 || doc.status === DocumentStatus.PENDING_APPROVER_2 || doc.status === DocumentStatus.PENDING_APPROVER_3).length,
    approved: documents.filter((doc) => doc.status === DocumentStatus.APPROVED).length,
    rejected: documents.filter((doc) => doc.status === DocumentStatus.REJECTED).length,
  };

  return (
    <DashboardShell role={session.role} userName={session.name} title={pageTitle} subtitle={pageSubtitle}>
      <PageSummaryCards
        cards={[
          { label: "All Documents", value: String(summaryCounts.total), tone: "bg-slate-900 text-white" },
          { label: "Pending", value: String(summaryCounts.pending), tone: "bg-amber-50 text-amber-900 ring-1 ring-amber-200" },
          { label: "Approved", value: String(summaryCounts.approved), tone: "bg-emerald-50 text-emerald-900 ring-1 ring-emerald-200" },
          { label: "Rejected", value: String(summaryCounts.rejected), tone: "bg-rose-50 text-rose-900 ring-1 ring-rose-200" },
        ]}
      />
      <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 px-5 py-4">
          <h3 className="text-base font-semibold text-slate-900">All Documents</h3>
        </div>
        <div className="border-b border-slate-200 px-5 py-4">
          <DocumentStatusFilter value={statusFilter} documentType={documentTypeFilter} />
        </div>
        <DocumentListTable documents={filteredDocuments} emptyMessage="No documents available." showBulkActions allowAdminDelete />
      </section>
    </DashboardShell>
  );
}
