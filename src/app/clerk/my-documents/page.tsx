import { DocumentStatus, UserRole } from "@prisma/client";
import DashboardShell from "@/components/dashboard-shell";
import DocumentListTable from "@/components/document-list-table";
import DocumentStatusFilter from "@/components/document-status-filter";
import PageSummaryCards from "@/components/page-summary-cards";
import { requireRole } from "@/lib/auth/guards";
import { getPoStatus, parseDocumentStatusFilter, parseDocumentTypeFilter, parseDownloadStatusFilter, parseMrLocationFilter, parseMrTypeFilter, parsePoStatusFilter } from "@/lib/document-status";
import { parseSearchQuery, matchesDocumentSearch } from "@/lib/document-search";
import { getDocumentsForClerk, getPurchaseOrderStatuses } from "@/lib/document-queries";

export const dynamic = "force-dynamic";

export default async function ClerkMyDocumentsPage({ searchParams }: any) {
  const session = await requireRole([UserRole.CLERK]);
  const data = await getDocumentsForClerk(session.userId);
  const resolvedSearchParams = await Promise.resolve(searchParams);
  const statusFilter = parseDocumentStatusFilter(resolvedSearchParams?.status);
  const documentTypeFilter = parseDocumentTypeFilter(resolvedSearchParams?.documentType);
  const downloadStatusFilter = parseDownloadStatusFilter(resolvedSearchParams?.downloadStatus);
  const mrTypeFilter = parseMrTypeFilter(resolvedSearchParams?.mrType);
  const locationFilter = parseMrLocationFilter(resolvedSearchParams?.location);
  const poStatusFilter = parsePoStatusFilter(resolvedSearchParams?.poStatus);
  const poStatuses = await getPurchaseOrderStatuses(data.documents.map((doc) => doc.id));
  const approvalFrom = typeof resolvedSearchParams?.approvalFrom === "string" ? resolvedSearchParams.approvalFrom : "";
  const approvalTo = typeof resolvedSearchParams?.approvalTo === "string" ? resolvedSearchParams.approvalTo : "";
  const searchQuery = parseSearchQuery(resolvedSearchParams?.search);

  const isStatusSpecificPage = statusFilter === "REVISION_REQUIRED" || statusFilter === "REJECTED";
  const isRevisionOrRejectedPage = statusFilter === "REVISION_REQUIRED" || statusFilter === "REJECTED";

  const pageTitle = statusFilter === "REVISION_REQUIRED"
      ? "Revision Required"
      : statusFilter === "REJECTED"
        ? "Rejected Documents"
      : documentTypeFilter === "MATERIAL_REQUISITION"
        ? "MRs"
        : documentTypeFilter === "COMPARISON"
          ? "Comparison Sheets"
          : "Documents";

  const pageSubtitle = statusFilter === "REVISION_REQUIRED"
      ? "Clerk revision required documents"
      : documentTypeFilter === "MATERIAL_REQUISITION"
        ? "Clerk material requisition submissions"
        : documentTypeFilter === "COMPARISON"
          ? "Clerk comparison sheet submissions"
          : "All workflow documents";

  const documents = data.documents
    .filter((doc) => !statusFilter || doc.status === statusFilter)
    .filter((doc) => !documentTypeFilter || doc.documentType === documentTypeFilter)
    .filter((doc) => !locationFilter || (doc.documentType === "MATERIAL_REQUISITION" && (doc.uploaderLocation ?? doc.createdBy.location) === locationFilter))
    .filter((doc) => !mrTypeFilter || (doc.documentType === "MATERIAL_REQUISITION" && doc.mrType === mrTypeFilter))
    .filter((doc) => !poStatusFilter || getPoStatus(doc.documentType, doc.mrType, poStatuses.has(doc.id)) === poStatusFilter)
    .filter((doc) => !downloadStatusFilter || (downloadStatusFilter === "DOWNLOADED" ? doc.downloadedAt : !doc.downloadedAt))
    .filter((doc) => {
      const approvalTime = doc.approvals.find((approval) => approval.action === "APPROVED")?.performedAt?.getTime();
      const from = approvalFrom ? new Date(approvalFrom).getTime() : null;
      const to = approvalTo ? new Date(approvalTo).getTime() : null;
      return (!from || (approvalTime !== undefined && approvalTime >= from)) && (!to || (approvalTime !== undefined && approvalTime <= to));
    })
    .map((doc) => ({
    id: doc.id,
    documentNumber: doc.documentNumber,
    title: doc.title,
    status: doc.status,
    documentType: doc.documentType,
    mrType: doc.mrType,
    poStatus: getPoStatus(doc.documentType, doc.mrType, poStatuses.has(doc.id)),
    rejectionComments: doc.approvals[0]?.comments || null,
    currentVersion: doc.currentVersion,
    currentApproverName: doc.currentApprover?.name || null,
    relatedComparisonId: doc.relatedComparison?.id || null,
    relatedComparisonDocumentNumber: doc.relatedComparison?.documentNumber || null,
    mrNumber: doc.mrNumber || null,
    relatedComparisonTitle: doc.relatedComparison?.title || null,
    downloadedAt: doc.downloadedAt,
    approvalDate: doc.approvals.find((approval) => approval.action === "APPROVED")?.performedAt || null,
    dateLabel: new Intl.DateTimeFormat("en-US", { dateStyle: "medium" }).format(doc.updatedAt),
  }));

  const filteredDocuments = documents.filter((doc) => matchesDocumentSearch(doc, searchQuery));

  const summaryCounts = {
    total: documents.length,
    pending: documents.filter((doc) => doc.status === DocumentStatus.PENDING_APPROVER_1 || doc.status === DocumentStatus.PENDING_APPROVER_2 || doc.status === DocumentStatus.PENDING_APPROVER_3).length,
    approved: documents.filter((doc) => doc.status === DocumentStatus.APPROVED).length,
    rejected: documents.filter((doc) => doc.status === DocumentStatus.REJECTED).length,
  };

  const cards = isStatusSpecificPage
    ? isRevisionOrRejectedPage
      ? [
        { label: "Assigned/Handled", value: String(summaryCounts.total), tone: "bg-slate-900 text-white" },
        { label: "MR Credits", value: String(documents.filter((doc) => doc.documentType === "MATERIAL_REQUISITION" && doc.mrType === "CREDIT").length), tone: "bg-violet-50 text-violet-900 ring-1 ring-violet-200" },
        { label: "MR Cash", value: String(documents.filter((doc) => doc.documentType === "MATERIAL_REQUISITION" && doc.mrType === "CASH").length), tone: "bg-amber-50 text-amber-900 ring-1 ring-amber-200" },
        { label: "Comparisons", value: String(documents.filter((doc) => doc.documentType === "COMPARISON").length), tone: "bg-sky-50 text-sky-900 ring-1 ring-sky-200" },
      ]
      : [
        { label: "Assigned/Handled", value: String(summaryCounts.total), tone: "bg-slate-900 text-white" },
        { label: "MRs", value: String(documents.filter((doc) => doc.documentType === "MATERIAL_REQUISITION").length), tone: "bg-slate-50 text-slate-900 ring-1 ring-slate-200" },
        { label: "Comparison Sheets", value: String(documents.filter((doc) => doc.documentType === "COMPARISON").length), tone: "bg-sky-50 text-sky-900 ring-1 ring-sky-200" },
      ]
    : [
        { label: "Assigned/Handled", value: String(summaryCounts.total), tone: "bg-slate-900 text-white" },
        { label: "Pending", value: String(summaryCounts.pending), tone: "bg-yellow-50 text-yellow-900 ring-1 ring-yellow-200" },
        { label: "Approved", value: String(summaryCounts.approved), tone: "bg-emerald-50 text-emerald-900 ring-1 ring-emerald-200" },
        { label: "Rejected", value: String(summaryCounts.rejected), tone: "bg-rose-50 text-rose-900 ring-1 ring-rose-200" },
      ];

  return (
    <DashboardShell role={session.role} userName={session.name} title={pageTitle} subtitle={pageSubtitle}>
      <PageSummaryCards cards={cards} />

      <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 px-5 py-4">
          <h3 className="text-base font-semibold text-slate-900">{pageTitle}</h3>
        </div>
        <div className="border-b border-slate-200 px-5 py-4">
          <DocumentStatusFilter
            value={statusFilter}
            documentType={documentTypeFilter}
            location={locationFilter}
            mrType={mrTypeFilter}
            showMrTypeFilter
            showPoStatusFilter
            poStatus={poStatusFilter}
            downloadStatus={downloadStatusFilter}
            approvalFrom={approvalFrom}
            approvalTo={approvalTo}
            showDownloadFilters
            showDocumentTypeFilter={isStatusSpecificPage || !documentTypeFilter}
            showErrDocumentType={false}
            showStatusFilter={!isStatusSpecificPage}
          />
        </div>
        <DocumentListTable documents={filteredDocuments} emptyMessage="No clerk documents found." showBulkActions allowBulkDelete showDownloadTracking />
      </section>
    </DashboardShell>
  );
}
