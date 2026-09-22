import { UserRole } from "@prisma/client";
import DashboardShell from "@/components/dashboard-shell";
import ApproverPendingTable from "@/components/approver-pending-table";
import DocumentStatusFilter from "@/components/document-status-filter";
import PageSummaryCards from "@/components/page-summary-cards";
import { requireRole } from "@/lib/auth/guards";
import { parseDocumentStatusFilter, parseDocumentTypeFilter } from "@/lib/document-status";
import { getDocumentsForApprover } from "@/lib/document-queries";
import { roleLabel } from "@/lib/auth/roles";
import { getModuleVisibility } from "@/lib/auth/module-visibility";

export const dynamic = "force-dynamic";

export default async function ApproverPendingApprovalsPage({ searchParams }: any) {
  const session = await requireRole([UserRole.APPROVER_1, UserRole.APPROVER_2, UserRole.APPROVER_3]);
  const resolvedSearchParams = await Promise.resolve(searchParams);
  const statusFilter = parseDocumentStatusFilter(resolvedSearchParams?.status);
  const documentTypeFilter = parseDocumentTypeFilter(resolvedSearchParams?.documentType);
  const data = await getDocumentsForApprover(session.userId, session.role, session.name);

  const pendingDocuments = [
    ...data.pendingDocuments
      .filter((doc) => !statusFilter || doc.status === statusFilter)
      .filter((doc) => !documentTypeFilter || doc.documentType === documentTypeFilter)
      .map((doc) => ({
        id: doc.id,
        documentNumber: doc.documentNumber,
        title: doc.title,
        documentType: doc.documentType,
        mrType: doc.mrType,
        currentVersion: doc.currentVersion,
        latestComment: doc.approvals[0]?.comments ?? null,
        uploadedAt: new Intl.DateTimeFormat("en-US", { dateStyle: "medium" }).format(doc.createdAt),
      })),
    ...data.errPendingDocuments
      .filter((doc) => !statusFilter || doc.status === statusFilter)
      .map((doc) => ({
        id: doc.id,
        documentNumber: doc.documentNumber,
        title: doc.title,
        documentType: "ERR" as const,
        mrType: null,
        currentVersion: 1,
        latestComment: null,
        uploadedAt: new Intl.DateTimeFormat("en-US", { dateStyle: "medium" }).format(doc.createdAt),
      })),
  ];

  const cards = [
    { label: "Assigned/Handled", value: String(pendingDocuments.length), tone: "bg-slate-900 text-white" },
    { label: "MRs", value: String(pendingDocuments.filter((doc) => doc.documentType === "MATERIAL_REQUISITION").length), tone: "bg-slate-50 text-slate-900 ring-1 ring-slate-200" },
    { label: "Comparison Sheets", value: String(pendingDocuments.filter((doc) => doc.documentType === "COMPARISON").length), tone: "bg-sky-50 text-sky-900 ring-1 ring-sky-200" },
    ...(getModuleVisibility(session.name, session.role) === "ALL" ? [{ label: "ERRs", value: String((pendingDocuments as Array<{ documentType: string }>).filter((doc) => doc.documentType === "ERR").length), tone: "bg-violet-50 text-violet-900 ring-1 ring-violet-200" }] : []),
  ];

  return (
    <DashboardShell
      role={session.role}
      userName={session.name}
      title="Pending Approvals"
      subtitle={`${roleLabel(session.role)} documents awaiting your action`}
    >
      <PageSummaryCards cards={cards} />
      <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 px-5 py-4">
          <h3 className="text-base font-semibold text-slate-900">Pending Approvals</h3>
        </div>
        <div className="border-b border-slate-200 px-5 py-4">
          <DocumentStatusFilter value={statusFilter} documentType={documentTypeFilter} showDocumentTypeFilter={true} showErrDocumentType={getModuleVisibility(session.name, session.role) === "ALL"} showStatusFilter={false} />
        </div>
        <div className="px-1 py-4">
          <ApproverPendingTable documents={pendingDocuments} />
        </div>
      </section>
    </DashboardShell>
  );
}
