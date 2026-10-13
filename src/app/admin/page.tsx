// src/app/admin/page.tsx
import { DocumentStatus, ProcessStatus } from "@prisma/client";
import DashboardShell from "@/components/dashboard-shell";
import DeletionRequestsList from "@/components/deletion-requests-list";
import PageSummaryCards from "@/components/page-summary-cards";
import WorkflowPipelineChart, { type PipelineDocument, type PipelineStage } from "@/components/workflow-pipeline-chart";
import { requireUserType } from "@/lib/auth/guards";
import { USER_TYPE } from "@/lib/auth/roles";
import { formatWaitingTime, getAgeBucket, getWaitingHours } from "@/lib/document-metrics";
import { getDocumentRows } from "@/lib/document-queries";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

const DAY_MS = 1000 * 60 * 60 * 24;

export default async function AdminDashboardPage() {
  const session = await requireUserType([USER_TYPE.ADMIN]);

  const [statusGroups, pendingRows, recentActivity, deletionRequests, runGroups, typeGroups] = await Promise.all([
    prisma.document.groupBy({ by: ["status"], _count: { _all: true } }),
    // Every document waiting at a level (this set is small compared with all documents).
    getDocumentRows({ status: DocumentStatus.PENDING }),
    prisma.approvalHistory.findMany({
      include: {
        document: { select: { documentNumber: true, title: true } },
        performedBy: { select: { name: true, email: true } },
      },
      orderBy: { performedAt: "desc" },
      take: 8,
    }),
    prisma.deletionRequest.findMany({
      where: { status: "PENDING" },
      include: {
        document: { select: { id: true, documentNumber: true, title: true } },
        requestedBy: { select: { name: true, email: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 20,
    }),
    prisma.processInstance.groupBy({ by: ["status"], _count: { _all: true } }),
    prisma.document.groupBy({ by: ["documentTypeId", "status"], _count: { _all: true } }),
  ]);

  const countOf = (status: DocumentStatus) => statusGroups.find((group) => group.status === status)?._count._all ?? 0;
  const totalDocuments = statusGroups.reduce((sum, group) => sum + group._count._all, 0);
  const pendingApprovals = countOf(DocumentStatus.PENDING);
  const approvedDocuments = countOf(DocumentStatus.APPROVED);
  const rejectedDocuments = countOf(DocumentStatus.CANCELLED);

  // ---- Aging of documents waiting at a level ----
  const agingSummary = pendingRows.reduce(
    (acc, row) => {
      const hours = getWaitingHours(row.waitingSince);
      const bucket = getAgeBucket(hours);
      if (bucket === "UNDER_3_HOURS") acc.under3 += 1;
      if (bucket === "BETWEEN_3_AND_24_HOURS") acc.between3And24 += 1;
      if (bucket === "OVER_24_HOURS") acc.over24 += 1;
      if (hours > 3) acc.overdue += 1;
      return acc;
    },
    { under3: 0, between3And24: 0, over24: 0, overdue: 0 },
  );

  // ---- Pipeline: one stage per level that documents are waiting at (levels are data, not fixed names) ----
  const stageItems: PipelineDocument[] = pendingRows.map((row) => ({
    id: row.id,
    documentNumber: row.documentNumber,
    title: row.title,
    currentApproverName: row.currentApprover?.name ?? null,
    status: row.status,
    statusLabel: row.statusLabel,
    stageKey: `LEVEL_${row.currentWorkflowStep ?? 0}`,
    daysPending: row.waitingSince ? Math.max(0, Math.floor((Date.now() - row.waitingSince.getTime()) / DAY_MS)) : 0,
    createdAtLabel: new Intl.DateTimeFormat("en-US", { dateStyle: "medium" }).format(row.createdAt),
  }));

  const levels = [...new Set(pendingRows.map((row) => row.currentWorkflowStep ?? 0))].sort((a, b) => a - b);
  const buildStage = (key: string, label: string): PipelineStage => {
    const matching = stageItems.filter((item) => item.stageKey === key);
    const assignees = new Map<string, { name: string; email: string; count: number }>();
    for (const item of matching) {
      if (!item.currentApproverName) continue;
      const entry = assignees.get(item.currentApproverName) ?? { name: item.currentApproverName, email: "", count: 0 };
      entry.count += 1;
      assignees.set(item.currentApproverName, entry);
    }
    const oldest = matching.slice().sort((a, b) => b.daysPending - a.daysPending)[0] ?? null;
    return {
      key,
      label,
      count: matching.length,
      averageDaysPending: matching.length ? Math.round(matching.reduce((sum, item) => sum + item.daysPending, 0) / matching.length) : 0,
      assignees: [...assignees.values()].sort((a, b) => b.count - a.count),
      oldestPendingDocument: oldest ? { documentNumber: oldest.documentNumber, title: oldest.title } : null,
    };
  };

  const levelStages = levels.map((level) => {
    // Name the stage after the level's own name when the flows agree on one, otherwise "Level n".
    const names = [...new Set(pendingRows.filter((row) => (row.currentWorkflowStep ?? 0) === level).map((row) => row.currentLevelName).filter(Boolean))] as string[];
    return buildStage(`LEVEL_${level}`, names.length > 0 && names.length <= 2 ? names.join(" / ") : `Level ${level}`);
  });
  const workflowStageMetrics: PipelineStage[] = [
    ...levelStages,
    { key: "REVISION_REQUIRED", label: "Revision Required", count: countOf(DocumentStatus.REVISION_REQUIRED), averageDaysPending: 0, assignees: [], oldestPendingDocument: null },
    { key: "APPROVED", label: "Approved", count: approvedDocuments, averageDaysPending: 0, assignees: [], oldestPendingDocument: null },
  ];

  // ---- Process runs ----
  const runCount = (status: ProcessStatus) => runGroups.find((group) => group.status === status)?._count._all ?? 0;
  const types = await prisma.documentType.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } });
  const typeMetrics = types
    .map((type) => {
      const rows = typeGroups.filter((group) => group.documentTypeId === type.id);
      return {
        label: type.name,
        total: rows.reduce((sum, group) => sum + group._count._all, 0),
        approved: rows.filter((group) => group.status === DocumentStatus.APPROVED).reduce((sum, group) => sum + group._count._all, 0),
      };
    })
    .filter((metric) => metric.total > 0);

  return (
    <DashboardShell role={session.userType} userName={session.name} title="Admin Dashboard" subtitle="System-wide document workflow control center">
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Administration</p>
        <h2 className="mt-2 text-2xl font-semibold text-slate-900">Welcome, {session.name}</h2>
        <p className="mt-1 text-sm text-slate-600">Monitor platform health, activity trends, and user operations.</p>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 px-5 py-4">
            <h3 className="text-base font-semibold text-slate-900">Workflow Status</h3>
            <p className="mt-1 text-sm text-slate-500">Current document distribution</p>
          </div>
          <div className="p-5">
            <PageSummaryCards
              cards={[
                { label: "Total Documents", value: String(totalDocuments), tone: "bg-slate-100 text-slate-900 ring-1 ring-slate-300" },
                { label: "Pending", value: String(pendingApprovals), tone: "bg-yellow-50 text-yellow-900 ring-1 ring-yellow-200" },
                { label: "Approved", value: String(approvedDocuments), tone: "bg-emerald-50 text-emerald-900 ring-1 ring-emerald-200" },
                { label: "Rejected", value: String(rejectedDocuments), tone: "bg-rose-50 text-rose-900 ring-1 ring-rose-200" },
              ]}
            />
          </div>
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 px-5 py-4">
            <h3 className="text-base font-semibold text-slate-900">Pending Aging</h3>
            <p className="mt-1 text-sm text-slate-500">How long documents are waiting</p>
          </div>
          <div className="p-5">
            <PageSummaryCards
              cards={[
                { label: "Under 3h", value: String(agingSummary.under3), tone: "bg-emerald-50 text-emerald-900 ring-1 ring-emerald-200" },
                { label: "3-24h", value: String(agingSummary.between3And24), tone: "bg-amber-50 text-amber-900 ring-1 ring-amber-200" },
                { label: "24h+", value: String(agingSummary.over24), tone: "bg-rose-50 text-rose-900 ring-1 ring-rose-200" },
                { label: "Overdue", value: String(agingSummary.overdue), tone: "bg-violet-50 text-violet-900 ring-1 ring-violet-200" },
              ]}
            />
          </div>
        </section>
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1.3fr,0.9fr]">
        <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 px-5 py-4">
            <h3 className="text-base font-semibold text-slate-900">Workflow Pipeline</h3>
          </div>
          <div className="p-5">
            <WorkflowPipelineChart stages={workflowStageMetrics} documents={stageItems} />
          </div>
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 px-5 py-4">
            <h3 className="text-base font-semibold text-slate-900">Pending Aging Snapshot</h3>
          </div>
          <div className="space-y-3 p-5">
            {pendingRows.length === 0 ? (
              <div className="rounded-xl bg-slate-50 px-4 py-3 text-sm text-slate-600 ring-1 ring-slate-200">No pending documents to age.</div>
            ) : (
              pendingRows.slice(0, 12).map((row) => (
                <div key={row.id} className="rounded-xl bg-slate-50 px-4 py-3 ring-1 ring-slate-200">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm font-semibold text-slate-900">{row.documentNumber}</p>
                    <span className="text-xs font-medium text-slate-600">{formatWaitingTime(getWaitingHours(row.waitingSince))}</span>
                  </div>
                  <p className="mt-1 text-sm text-slate-700">Waiting for: {row.currentApprover?.name || "Unassigned"}</p>
                </div>
              ))
            )}
          </div>
        </section>
      </div>

      <div className="space-y-6">
        <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 px-5 py-4">
            <h3 className="text-base font-semibold text-slate-900">Deletion Requests</h3>
            <p className="mt-1 text-sm text-slate-500">Requests awaiting review.</p>
          </div>
          <DeletionRequestsList requests={deletionRequests} />
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 px-5 py-4">
            <h3 className="text-base font-semibold text-slate-900">Recent Activity</h3>
          </div>
          <div className="divide-y divide-slate-100">
            {recentActivity.length === 0 ? (
              <div className="px-5 py-6 text-sm text-slate-500">No workflow activity found.</div>
            ) : (
              recentActivity.map((item) => (
                <div key={item.id} className="px-5 py-4">
                  <p className="text-sm font-semibold text-slate-900">{item.document.documentNumber} - {item.document.title}</p>
                  <p className="mt-1 text-sm text-slate-700">Action: {String(item.action).replaceAll("_", " ")}</p>
                  <p className="mt-1 text-xs text-slate-500">By {item.performedBy.name} ({item.performedBy.email})</p>
                  <p className="mt-1 text-xs text-slate-500">
                    {new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" }).format(item.performedAt)}
                  </p>
                </div>
              ))
            )}
          </div>
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 px-5 py-4">
            <h3 className="text-base font-semibold text-slate-900">Document and Process Metrics</h3>
          </div>
          <div className="space-y-3 p-5">
            {typeMetrics.map((metric) => (
              <div key={metric.label} className="flex items-center justify-between rounded-xl bg-slate-50 px-4 py-3 ring-1 ring-slate-200">
                <p className="text-sm font-medium text-slate-700">{metric.label}</p>
                <p className="text-sm font-semibold text-slate-900">{metric.approved} approved of {metric.total}</p>
              </div>
            ))}
            {[
              { label: "Process runs in progress", value: runCount(ProcessStatus.IN_PROGRESS) },
              { label: "Process runs completed", value: runCount(ProcessStatus.COMPLETED) },
              { label: "Process runs cancelled", value: runCount(ProcessStatus.CANCELLED) },
            ].map((item) => (
              <div key={item.label} className="flex items-center justify-between rounded-xl bg-slate-100 px-4 py-3 ring-1 ring-slate-300">
                <p className="text-sm font-medium text-slate-700">{item.label}</p>
                <p className="text-sm font-semibold text-slate-900">{item.value}</p>
              </div>
            ))}
          </div>
        </section>
      </div>
    </DashboardShell>
  );
}
