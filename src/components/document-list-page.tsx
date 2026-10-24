import DashboardShell from "@/components/dashboard-shell";
import DocumentListTable from "@/components/document-list-table";
import DocumentStatusFilter from "@/components/document-status-filter";
import PageSummaryCards from "@/components/page-summary-cards";
import ApproverPendingTable from "@/components/approver-pending-table";
import type { UserTypeCode } from "@/lib/auth/roles";
import { prisma } from "@/lib/prisma";
import { withDownloadTracking } from "@/lib/download-tracking";
import { userCanBulkApprove } from "@/lib/bulk-approve";
import type { DocumentRow } from "@/lib/document-queries";
import { applyListFilters, buildSummaryCards, describeFilters, parseListFilters, toListItem, type ListSearchParams } from "@/lib/document-list";
import type { DocumentStatusFilterValue } from "@/lib/document-status";

type TableOptions = {
  showBulkActions?: boolean;
  allowBulkDelete?: boolean;
  allowAdminDelete?: boolean;
  allowReview?: boolean;
  showDownloadTracking?: boolean;
};

type Props = {
  session: { userId: string; userType: UserTypeCode; name: string };
  rows: DocumentRow[];
  searchParams: ListSearchParams;
  title: string;
  subtitle: string;
  emptyMessage: string;
  // The page always shows this status (approved, rejected, archived pages); the status filter is then hidden.
  lockedStatus?: DocumentStatusFilterValue;
  summaryMode?: "overview" | "byType";
  showDownloadFilters?: boolean;
  // "pending" renders the compact approver task table instead of the full list table.
  variant?: "list" | "pending";
  table?: TableOptions;
};

/** Document types (with sub types) and projects for the filter bar: always read from the database. */
export async function loadFilterOptions() {
  const [documentTypes, projects] = await Promise.all([
    prisma.documentType.findMany({
      where: { isActive: true },
      select: { code: true, name: true, subtypes: { where: { isActive: true }, select: { code: true, name: true }, orderBy: { name: "asc" } } },
      orderBy: { name: "asc" },
    }),
    prisma.project.findMany({ where: { isActive: true }, select: { id: true, code: true, name: true }, orderBy: { code: "asc" } }),
  ]);
  return { documentTypes, projects };
}

/**
 * One page for every document list (clerk, approver and admin; all, approved, rejected, archived, pending).
 * Filters, titles, summary cards and the type / sub type / project options all come from data.
 */
export default async function DocumentListPage({
  session,
  rows,
  searchParams,
  title,
  subtitle,
  emptyMessage,
  lockedStatus = "",
  summaryMode = "overview",
  showDownloadFilters = false,
  variant = "list",
  table = {},
}: Props) {
  const filters = parseListFilters(searchParams);
  const { documentTypes, projects } = await loadFilterOptions();

  // Download state is per user, so it is only looked up for screens that show or filter on it.
  const needsDownloadState = showDownloadFilters || Boolean(table.showDownloadTracking);
  const trackedRows = needsDownloadState ? await withDownloadTracking(rows, session.userId) : rows;

  const scoped = lockedStatus ? trackedRows.filter((row) => row.status === lockedStatus) : trackedRows;
  const filtered = applyListFilters(scoped, filters, { ignoreStatus: Boolean(lockedStatus) });

  // Tick boxes on the pending table are only for users an admin allowed to approve several documents at once.
  const allowBatch = variant === "pending" && (table.allowReview ?? true) ? await userCanBulkApprove(session.userId) : false;

  const filterTitle = describeFilters(filters, documentTypes);
  const pageTitle = filters.status === "REVISION_REQUIRED" && !lockedStatus ? "Revision Required" : filters.status === "CANCELLED" && !lockedStatus ? "Rejected Documents" : filterTitle || title;
  const cards = buildSummaryCards(filtered, summaryMode);

  return (
    <DashboardShell role={session.userType} userName={session.name} title={pageTitle} subtitle={subtitle}>
      <PageSummaryCards cards={cards} />
      <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 px-5 py-4">
          <h3 className="text-base font-semibold text-slate-900">{pageTitle}</h3>
        </div>
        <div className="border-b border-slate-200 px-5 py-4">
          <DocumentStatusFilter
            value={filters.status}
            documentType={filters.documentType}
            documentSubtype={filters.documentSubtype}
            project={filters.project}
            downloadStatus={filters.downloadStatus}
            approvalFrom={filters.approvalFrom}
            approvalTo={filters.approvalTo}
            showDownloadFilters={showDownloadFilters}
            showStatusFilter={!lockedStatus && variant !== "pending"}
            documentTypes={documentTypes}
            projects={projects}
          />
        </div>
        {variant === "pending" ? (
          <div className="px-1 py-4">
            <ApproverPendingTable
              allowReview={table.allowReview ?? true}
              allowBatch={allowBatch}
              emptyMessage={emptyMessage}
              documents={filtered.map((row) => ({
                id: row.id,
                documentNumber: row.documentNumber,
                title: row.title,
                projectLabel: row.project ? `${row.project.code} - ${row.project.name}` : null,
                statusLabel: row.statusLabel,
                currentVersion: row.currentVersion,
                latestComment: row.latestComment,
                uploadedAt: new Intl.DateTimeFormat("en-US", { dateStyle: "medium" }).format(row.createdAt),
              }))}
            />
          </div>
        ) : (
          <DocumentListTable documents={filtered.map(toListItem)} emptyMessage={emptyMessage} {...table} />
        )}
      </section>
    </DashboardShell>
  );
}
