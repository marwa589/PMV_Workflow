import { DocumentStatus, UserRole } from "@prisma/client";
import DashboardShell from "@/components/dashboard-shell";
import DocumentListTable from "@/components/document-list-table";
import DocumentStatusFilter from "@/components/document-status-filter";
import PageSummaryCards from "@/components/page-summary-cards";
import { requireRole } from "@/lib/auth/guards";
import { parseDocumentStatusFilter, parseDocumentTypeFilter, parseMrTypeFilter } from "@/lib/document-status";
import { parseSearchQuery, matchesDocumentSearch } from "@/lib/document-search";
import { getDocumentsForApprover } from "@/lib/document-queries";
import { roleLabel } from "@/lib/auth/roles";
import { getModuleVisibility } from "@/lib/auth/module-visibility";
import { getSession } from "@/lib/auth/session";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function ApproverMyDocumentsPage({ searchParams }: any) {
  const currentSession = await getSession();
  if (currentSession?.role === UserRole.ERR_USER) {
    redirect("/errs?view=all&section=my-documents");
  }
  const session = await requireRole([UserRole.APPROVER_1, UserRole.APPROVER_2, UserRole.APPROVER_3]);
  const data = await getDocumentsForApprover(session.userId, session.role, session.name);
  const resolvedSearchParams = await Promise.resolve(searchParams);
  const statusFilter = parseDocumentStatusFilter(resolvedSearchParams?.status);
  const documentTypeFilter = parseDocumentTypeFilter(resolvedSearchParams?.documentType);
  const mrTypeFilter = parseMrTypeFilter(resolvedSearchParams?.mrType);
  const searchQuery = parseSearchQuery(resolvedSearchParams?.search);

  const isStatusSpecificPage = statusFilter === "REVISION_REQUIRED";

  const pageTitle = statusFilter === "REVISION_REQUIRED"
      ? "Revision Required"
      : documentTypeFilter === "MATERIAL_REQUISITION"
        ? "MRs"
        : documentTypeFilter === "COMPARISON"
          ? "Comparison Sheets"
          : "My Documents";

  const pageSubtitle = statusFilter === "REVISION_REQUIRED"
      ? `${roleLabel(session.role)} revision required documents`
      : documentTypeFilter === "MATERIAL_REQUISITION"
        ? `${roleLabel(session.role)} material requisition documents`
        : documentTypeFilter === "COMPARISON"
          ? `${roleLabel(session.role)} comparison sheet documents`
          : `${roleLabel(session.role)} assigned or handled documents`;

  const documents = [
    ...data.myDocuments
      .filter((doc) => !statusFilter || doc.status === statusFilter)
      .filter((doc) => !documentTypeFilter || doc.documentType === documentTypeFilter)
      .filter((doc) => !mrTypeFilter || (doc.documentType === "MATERIAL_REQUISITION" && doc.mrType === mrTypeFilter))
      .map((doc) => ({
    id: doc.id,
    documentNumber: doc.documentNumber,
    title: doc.title,
    status: doc.status,
    documentType: doc.documentType,
    mrType: doc.mrType,
    rejectionComments: doc.approvals[0]?.comments || null,
    currentVersion: doc.currentVersion,
    currentApproverName: doc.currentApprover?.name || null,
    canReview: doc.currentApproverId === session.userId && doc.status !== DocumentStatus.APPROVED && doc.status !== DocumentStatus.REJECTED,
    relatedComparisonId: doc.relatedComparison?.id || null,
    relatedComparisonDocumentNumber: doc.relatedComparison?.documentNumber || null,
    mrNumber: doc.mrNumber || null,
    relatedComparisonTitle: doc.relatedComparison?.title || null,
    dateLabel: new Intl.DateTimeFormat("en-US", { dateStyle: "medium" }).format(doc.updatedAt),
      })),
    ...data.errMyDocuments
      .filter((doc) => !statusFilter || doc.status === statusFilter)
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
        canReview: doc.currentApproverId === session.userId && doc.status === "PENDING",
        relatedComparisonId: null,
        relatedComparisonDocumentNumber: null,
        dateLabel: new Intl.DateTimeFormat("en-US", { dateStyle: "medium" }).format(doc.createdAt),
      })),
  ];

  const filteredDocuments = documents.filter((doc) => matchesDocumentSearch(doc, searchQuery));

  if (session.role === UserRole.APPROVER_3) {
    filteredDocuments.sort((left, right) => Number(right.documentType === "ERR") - Number(left.documentType === "ERR"));
  }

  const summaryCounts = {
    total: documents.length,
    pending: documents.filter((doc) => doc.status === DocumentStatus.PENDING_APPROVER_1 || doc.status === DocumentStatus.PENDING_APPROVER_2 || doc.status === DocumentStatus.PENDING_APPROVER_3).length,
    approved: documents.filter((doc) => doc.status === DocumentStatus.APPROVED).length,
    rejected: documents.filter((doc) => doc.status === DocumentStatus.REJECTED).length,
  };

  const cards = isStatusSpecificPage
    ? [
        { label: "Assigned/Handled", value: String(summaryCounts.total), tone: "bg-slate-900 text-white" },
        { label: "MRs", value: String(documents.filter((doc) => doc.documentType === "MATERIAL_REQUISITION").length), tone: "bg-slate-50 text-slate-900 ring-1 ring-slate-200" },
        { label: "Comparison Sheets", value: String(documents.filter((doc) => doc.documentType === "COMPARISON").length), tone: "bg-sky-50 text-sky-900 ring-1 ring-sky-200" },
        ...(getModuleVisibility(session.name, session.role) === "ALL" ? [{ label: "ERRs", value: String((documents as Array<{ documentType: string }>).filter((doc) => doc.documentType === "ERR").length), tone: "bg-violet-50 text-violet-900 ring-1 ring-violet-200" }] : []),
      ]
    : [
        { label: "Assigned/Handled", value: String(summaryCounts.total), tone: "bg-slate-900 text-white" },
        { label: "Pending", value: String(summaryCounts.pending), tone: "bg-amber-50 text-amber-900 ring-1 ring-amber-200" },
        { label: "Approved", value: String(summaryCounts.approved), tone: "bg-emerald-50 text-emerald-900 ring-1 ring-emerald-200" },
        { label: "Rejected", value: String(summaryCounts.rejected), tone: "bg-rose-50 text-rose-900 ring-1 ring-rose-200" },
      ];

  return (
    <DashboardShell
      role={session.role}
      userName={session.name}
      title={pageTitle}
      subtitle={pageSubtitle}
    >
      <PageSummaryCards cards={cards} />
      <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 px-5 py-4">
          <h3 className="text-base font-semibold text-slate-900">{pageTitle}</h3>
        </div>
        <div className="border-b border-slate-200 px-5 py-4">
          <DocumentStatusFilter
            value={statusFilter}
            documentType={documentTypeFilter}
            mrType={mrTypeFilter}
            showMrTypeFilter
            showDocumentTypeFilter={isStatusSpecificPage || !documentTypeFilter}
            showErrDocumentType={getModuleVisibility(session.name, session.role) === "ALL"}
            showStatusFilter={!isStatusSpecificPage}
          />
        </div>
        <DocumentListTable documents={filteredDocuments} emptyMessage="No documents assigned or previously handled by you." showBulkActions allowReview />
      </section>
    </DashboardShell>
  );
}
