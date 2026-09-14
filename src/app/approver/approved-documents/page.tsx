import { ApprovalActionType, UserRole } from "@prisma/client";
import DashboardShell from "@/components/dashboard-shell";
import DocumentListTable from "@/components/document-list-table";
import DocumentStatusFilter from "@/components/document-status-filter";
import PageSummaryCards from "@/components/page-summary-cards";
import { requireRole } from "@/lib/auth/guards";
import { parseDocumentStatusFilter, parseDocumentTypeFilter } from "@/lib/document-status";
import { getDocumentsForApprover } from "@/lib/document-queries";
import { roleLabel } from "@/lib/auth/roles";
import { prisma } from "@/lib/prisma";
import { getModuleVisibility } from "@/lib/auth/module-visibility";

export const dynamic = "force-dynamic";

export default async function ApproverApprovedDocumentsPage({ searchParams }: any) {
  const session = await requireRole([UserRole.APPROVER_1, UserRole.APPROVER_2, UserRole.APPROVER_3]);
  const resolvedSearchParams = await Promise.resolve(searchParams);
  const statusFilter = parseDocumentStatusFilter(resolvedSearchParams?.status);
  const documentTypeFilter = parseDocumentTypeFilter(resolvedSearchParams?.documentType);
  const data = await getDocumentsForApprover(session.userId, session.role, session.name);

  const documents = [
    ...data.approvedDocuments
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
        relatedComparisonId: doc.relatedComparison?.id || null,
        relatedComparisonDocumentNumber: doc.relatedComparison?.documentNumber || null,
        dateLabel: new Intl.DateTimeFormat("en-US", { dateStyle: "medium" }).format(doc.createdAt),
      })),
    ...data.errApprovedDocuments
      .filter((doc) => !statusFilter || doc.status === statusFilter)
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

  const approvedCount = await prisma.approvalHistory.count({
    where: { performedById: session.userId, action: ApprovalActionType.APPROVED },
  });

  const cards = [
    { label: "Assigned/Handled", value: String(documents.length), tone: "bg-slate-900 text-white" },
    { label: "MRs", value: String(documents.filter((doc) => doc.documentType === "MATERIAL_REQUISITION").length), tone: "bg-slate-50 text-slate-900 ring-1 ring-slate-200" },
    { label: "Comparison Sheets", value: String(documents.filter((doc) => doc.documentType === "COMPARISON").length), tone: "bg-sky-50 text-sky-900 ring-1 ring-sky-200" },
    ...(getModuleVisibility(session.name, session.role) === "ALL" ? [{ label: "ERRs", value: String((documents as Array<{ documentType: string }>).filter((doc) => doc.documentType === "ERR").length), tone: "bg-violet-50 text-violet-900 ring-1 ring-violet-200" }] : []),
  ];

  return (
    <DashboardShell role={session.role} userName={session.name} title="Approved Documents" subtitle={`${roleLabel(session.role)} approvals completed by you`}>
      <PageSummaryCards cards={cards} />
      <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 px-5 py-4">
          <h3 className="text-base font-semibold text-slate-900">Approved Documents</h3>
        </div>
        <div className="border-b border-slate-200 px-5 py-4">
          <DocumentStatusFilter value={statusFilter} documentType={documentTypeFilter} showDocumentTypeFilter showErrDocumentType={getModuleVisibility(session.name, session.role) === "ALL"} showStatusFilter={false} />
        </div>
        <DocumentListTable documents={documents} emptyMessage="No documents approved by you yet." showBulkActions />
      </section>
    </DashboardShell>
  );
}
