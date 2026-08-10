import { UserRole } from "@prisma/client";
import DashboardShell from "@/components/dashboard-shell";
import ApproverPendingTable from "@/components/approver-pending-table";
import PageSummaryCards from "@/components/page-summary-cards";
import { requireRole } from "@/lib/auth/guards";
import { getDocumentsForApprover } from "@/lib/document-queries";
import { roleLabel } from "@/lib/auth/roles";

export const dynamic = "force-dynamic";

export default async function ApproverPendingApprovalsPage() {
  const session = await requireRole([UserRole.APPROVER_1, UserRole.APPROVER_2, UserRole.APPROVER_3]);
  const data = await getDocumentsForApprover(session.userId, session.role);

  return (
    <DashboardShell
      role={session.role}
      userName={session.name}
      title="Pending Approvals"
      subtitle={`${roleLabel(session.role)} documents awaiting your action`}
    >
      <PageSummaryCards
        cards={[
          { label: "Pending", value: String(data.pendingDocuments.length), tone: "bg-amber-50 text-amber-900 ring-1 ring-amber-200" },
          { label: "Approved", value: String(data.approvedDocuments.length), tone: "bg-emerald-50 text-emerald-900 ring-1 ring-emerald-200" },
          { label: "Rejected", value: String(data.rejectedDocuments.length), tone: "bg-rose-50 text-rose-900 ring-1 ring-rose-200" },
        ]}
      />
      <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 px-5 py-4">
          <h3 className="text-base font-semibold text-slate-900">Pending Approvals</h3>
        </div>
        <div className="px-1 py-4">
          <ApproverPendingTable documents={data.pendingDocuments.map((doc) => ({
            id: doc.id,
            documentNumber: doc.documentNumber,
            title: doc.title,
            documentType: doc.documentType,
            mrType: doc.mrType,
            currentVersion: doc.currentVersion,
            uploadedAt: new Intl.DateTimeFormat("en-US", { dateStyle: "medium" }).format(doc.createdAt),
          }))} />
        </div>
      </section>
    </DashboardShell>
  );
}
