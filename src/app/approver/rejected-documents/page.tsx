import { ApprovalActionType, UserRole } from "@prisma/client";
import DashboardShell from "@/components/dashboard-shell";
import DocumentListTable from "@/components/document-list-table";
import PageSummaryCards from "@/components/page-summary-cards";
import { requireRole } from "@/lib/auth/guards";
import { getDocumentsForApprover } from "@/lib/document-queries";
import { roleLabel } from "@/lib/auth/roles";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export default async function ApproverRejectedDocumentsPage() {
  const session = await requireRole([UserRole.APPROVER_1, UserRole.APPROVER_2, UserRole.APPROVER_3]);
  const data = await getDocumentsForApprover(session.userId, session.role);

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

  const rejectedCount = await prisma.approvalHistory.count({
    where: { performedById: session.userId, action: ApprovalActionType.REJECTED },
  });

  return (
    <DashboardShell role={session.role} userName={session.name} title="Rejected Documents" subtitle={`${roleLabel(session.role)} rejections completed by you`}>
      <PageSummaryCards
        cards={[
          { label: "Rejected By You", value: String(rejectedCount), tone: "bg-rose-50 text-rose-900 ring-1 ring-rose-200" },
          { label: "Assigned / Handled", value: String(data.myDocuments.length), tone: "bg-slate-900 text-white" },
          { label: "Pending", value: String(data.pendingDocuments.length), tone: "bg-amber-50 text-amber-900 ring-1 ring-amber-200" },
        ]}
      />
      <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 px-5 py-4">
          <h3 className="text-base font-semibold text-slate-900">Rejected Documents</h3>
        </div>
        <DocumentListTable documents={documents} emptyMessage="No documents rejected by you yet." />
      </section>
    </DashboardShell>
  );
}
