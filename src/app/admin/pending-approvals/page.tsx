import { UserRole } from "@prisma/client";
import DashboardShell from "@/components/dashboard-shell";
import DocumentListTable from "@/components/document-list-table";
import PageSummaryCards from "@/components/page-summary-cards";
import { requireRole } from "@/lib/auth/guards";
import { getDocumentsForAdmin } from "@/lib/document-queries";

export const dynamic = "force-dynamic";

export default async function AdminPendingApprovalsPage() {
  const session = await requireRole([UserRole.ADMIN]);
  const data = await getDocumentsForAdmin();

  const documents = data.pendingDocuments.map((doc) => ({
    id: doc.id,
    documentNumber: doc.documentNumber,
    title: doc.title,
    status: doc.status,
    documentType: doc.documentType,
    mrType: doc.mrType,
    currentVersion: doc.currentVersion,
    currentApproverName: doc.currentApprover?.name || null,
    dateLabel: new Intl.DateTimeFormat("en-US", { dateStyle: "medium" }).format(doc.createdAt),
  }));

  return (
    <DashboardShell role={session.role} userName={session.name} title="Pending Approvals" subtitle="Administrative pending queue">
      <PageSummaryCards
        cards={[
          { label: "Pending", value: String(documents.length), tone: "bg-amber-50 text-amber-900 ring-1 ring-amber-200" },
          { label: "All Documents", value: String(data.documents.length), tone: "bg-slate-900 text-white" },
          { label: "Approved", value: String(data.approvedDocuments.length), tone: "bg-emerald-50 text-emerald-900 ring-1 ring-emerald-200" },
        ]}
      />
      <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 px-5 py-4">
          <h3 className="text-base font-semibold text-slate-900">Pending Approvals</h3>
        </div>
        <DocumentListTable documents={documents} emptyMessage="No pending approvals." showDeleteAction />
      </section>
    </DashboardShell>
  );
}
