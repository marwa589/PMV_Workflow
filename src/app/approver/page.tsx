// src/app/approver/page.tsx
import ApproverPendingTable from "@/components/approver-pending-table";
import DashboardShell from "@/components/dashboard-shell";
import PageSummaryCards from "@/components/page-summary-cards";
import { requireUserType } from "@/lib/auth/guards";
import { APPROVER_USER_TYPES, roleLabel, USER_TYPE } from "@/lib/auth/roles";
import { getDocumentsForApprover } from "@/lib/document-queries";

export const dynamic = "force-dynamic";

const dateFormat = new Intl.DateTimeFormat("en-US", { dateStyle: "medium" });

export default async function ApproverDashboardPage() {
  const session = await requireUserType(APPROVER_USER_TYPES);
  const data = await getDocumentsForApprover(session.userId, session.userType);

  return (
    <DashboardShell
      role={session.userType}
      userName={session.name}
      title="Approver Dashboard"
      subtitle={`${roleLabel(session.userType)} workflow queue`}
    >
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Approval Workbench</p>
        <h2 className="mt-2 text-2xl font-semibold text-slate-900">Welcome, {session.name}</h2>
        <p className="mt-1 text-sm text-slate-600">Review pending submissions and track your decision activity.</p>
      </div>

      <PageSummaryCards
        cards={[
          { label: "Pending Approval", value: String(data.pendingDocuments.length), tone: "bg-yellow-50 text-yellow-900 ring-1 ring-yellow-200" },
          { label: "On Hold", value: String(data.onHoldDocuments.length), tone: "bg-sky-50 text-sky-900 ring-1 ring-sky-200" },
          { label: "Revision Required", value: String(data.revisionRequiredDocuments.length), tone: "bg-slate-50 text-slate-900 ring-1 ring-slate-200" },
          { label: "Approved", value: String(data.approvedDocuments.length), tone: "bg-emerald-50 text-emerald-900 ring-1 ring-emerald-200" },
          { label: "Rejected", value: String(data.rejectedDocuments.length), tone: "bg-rose-50 text-rose-900 ring-1 ring-rose-200" },
        ]}
      />

      <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 px-5 py-4">
          <h3 className="text-base font-semibold text-slate-900">Pending Approvals</h3>
        </div>
        <div className="px-1 py-4">
          <ApproverPendingTable
            showVersion={session.userType === USER_TYPE.ADMIN}
            documents={data.pendingDocuments.map((row) => ({
              id: row.id,
              documentNumber: row.documentNumber,
              title: row.title,
              projectLabel: row.project ? `${row.project.code} - ${row.project.name}` : null,
              statusLabel: row.statusLabel,
              currentVersion: row.currentVersion,
              latestComment: row.latestComment,
              uploadedAt: dateFormat.format(row.createdAt),
            }))}
          />
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 px-5 py-4">
          <h3 className="text-base font-semibold text-slate-900">Recent Workflow Activity</h3>
        </div>
        <div className="divide-y divide-slate-100">
          {data.recentActivity.length === 0 ? (
            <div className="px-5 py-6 text-sm text-slate-500">No activity available yet.</div>
          ) : (
            data.recentActivity.map((item) => (
              <div key={item.id} className="px-5 py-4">
                <p className="text-sm font-semibold text-slate-900">
                  {item.document.documentNumber} - {item.document.title}
                </p>
                <p className="mt-1 text-sm text-slate-700">Action: {String(item.action).replaceAll("_", " ")}</p>
                {item.comments ? <p className="mt-1 text-sm text-slate-600">Comment: {item.comments}</p> : null}
                <p className="mt-1 text-xs text-slate-500">
                  {new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" }).format(item.performedAt)}
                </p>
              </div>
            ))
          )}
        </div>
      </section>
    </DashboardShell>
  );
}
