import { ApprovalActionType, DocumentStatus, UserRole } from "@prisma/client";
import DashboardShell from "@/components/dashboard-shell";
import DeletionRequestsList from "@/components/deletion-requests-list";
import WorkflowPipelineChart from "@/components/workflow-pipeline-chart";
import { requireRole } from "@/lib/auth/guards";
import { formatWaitingTime, getAgeBucket, getWaitingHours } from "@/lib/document-metrics";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export default async function AdminDashboardPage() {
  const session = await requireRole([UserRole.ADMIN]);

  let totalDocuments = 0;
  let pendingApprovals = 0;
  let approvedDocuments = 0;
  let rejectedDocuments = 0;
  let recentActivity: {
    id: string;
    action: string;
    performedAt: Date;
    document: { documentNumber: string; title: string };
    performedBy: { name: string; email: string };
  }[] = [];
  let allDocuments: {
    id: string;
    documentNumber: string;
    title: string;
    status: DocumentStatus;
    documentType: "COMPARISON" | "MATERIAL_REQUISITION";
    mrType?: "CASH" | "CREDIT" | null;
    currentVersion: number;
    currentApprover: { name: string } | null;
    currentApproverAssignedAt: Date | null;
    createdAt: Date;
  }[] = [];
  let pendingDocuments: {
    id: string;
    documentNumber: string;
    title: string;
    status: DocumentStatus;
    currentVersion: number;
  }[] = [];
  let agingSummary = { under3: 0, between3And24: 0, over24: 0, overdue: 0 };
  let workflowPipeline = {
    submitted: 0,
    approver1: 0,
    approver2: 0,
    approver3: 0,
    approved: 0,
    rejected: 0,
  };
  let workflowStageDocuments: Array<{
    id: string;
    documentNumber: string;
    title: string;
    currentApproverName: string | null;
    status: DocumentStatus;
    statusLabel: string;
    stageKey: string;
    daysPending: number;
    createdAtLabel: string;
  }> = [];
  let workflowStageMetrics: Array<{
    key: string;
    label: string;
    count: number;
    averageDaysPending: number;
    assignees: { name: string; email: string }[];
    oldestPendingDocument: { documentNumber: string; title: string } | null;
  }> = [];
  let procurementMetrics = {
    comparisons: 0,
    approvedComparisons: 0,
    mrCash: 0,
    approvedMrCash: 0,
    mrCredit: 0,
    approvedMrCredit: 0,
    avgTurnaroundDays: null as number | null,
  };
  let pendingDeletionRequests: {
    id: string;
    documentId: string;
    createdAt: Date;
    requestedBy: { name: string; email: string };
    document: { documentNumber: string; title: string };
  }[] = [];

  try {
    const [total, pending, approved, rejected, activity, roleGroups, allDocs, pendingDocs, allPendingDocs, deletionRequests] = await Promise.all([
      prisma.document.count(),
      prisma.document.count({
        where: {
          status: {
            in: [
              DocumentStatus.PENDING_APPROVER_1,
              DocumentStatus.PENDING_APPROVER_2,
              DocumentStatus.PENDING_APPROVER_3,
            ],
          },
        },
      }),
      prisma.document.count({ where: { status: DocumentStatus.APPROVED } }),
      prisma.document.count({ where: { status: DocumentStatus.REJECTED } }),
      prisma.approvalHistory.findMany({
        include: {
          document: { select: { documentNumber: true, title: true } },
          performedBy: { select: { name: true, email: true } },
        },
        orderBy: { performedAt: "desc" },
        take: 8,
      }),
      prisma.user.findMany({
        select: { role: true, name: true, email: true },
        orderBy: [{ role: "asc" }, { name: "asc" }],
      }),
      prisma.document.findMany({
        orderBy: { createdAt: "desc" },
        take: 12,
        include: {
          currentApprover: { select: { name: true } },
        },
      }),
      prisma.document.findMany({
        where: {
          status: {
            in: [
              DocumentStatus.PENDING_APPROVER_1,
              DocumentStatus.PENDING_APPROVER_2,
              DocumentStatus.PENDING_APPROVER_3,
            ],
          },
        },
        orderBy: { createdAt: "desc" },
        take: 12,
        select: {
          id: true,
          documentNumber: true,
          title: true,
          status: true,
          currentVersion: true,
        },
      }),
      prisma.document.findMany({
        where: {
          status: {
            in: [
              DocumentStatus.PENDING_APPROVER_1,
              DocumentStatus.PENDING_APPROVER_2,
              DocumentStatus.PENDING_APPROVER_3,
            ],
          },
        },
        select: {
          id: true,
          status: true,
          documentType: true,
          mrType: true,
          currentApproverAssignedAt: true,
        },
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
    ]);

    totalDocuments = total;
    pendingApprovals = pending;
    approvedDocuments = approved;
    rejectedDocuments = rejected;
    recentActivity = activity;
    allDocuments = allDocs.map((doc) => ({
      id: doc.id,
      documentNumber: doc.documentNumber,
      title: doc.title,
      status: doc.status,
      documentType: doc.documentType,
      mrType: doc.mrType,
      currentVersion: doc.currentVersion,
      currentApprover: doc.currentApprover,
      currentApproverAssignedAt: doc.currentApproverAssignedAt,
      createdAt: doc.createdAt,
    }));
    pendingDocuments = pendingDocs;
    pendingDeletionRequests = deletionRequests;
    agingSummary = allPendingDocs.reduce(
      (acc, doc) => {
        const hours = getWaitingHours(doc.currentApproverAssignedAt);
        const bucket = getAgeBucket(hours);
        if (bucket === "UNDER_3_HOURS") acc.under3 += 1;
        if (bucket === "BETWEEN_3_AND_24_HOURS") acc.between3And24 += 1;
        if (bucket === "OVER_24_HOURS") acc.over24 += 1;
        if (hours > 3) acc.overdue += 1;
        return acc;
      },
      { under3: 0, between3And24: 0, over24: 0, overdue: 0 },
    );
    workflowPipeline = {
      submitted: total,
      approver1: allPendingDocs.filter((doc) => doc.status === DocumentStatus.PENDING_APPROVER_1).length,
      approver2: allPendingDocs.filter((doc) => doc.status === DocumentStatus.PENDING_APPROVER_2).length,
      approver3: allPendingDocs.filter((doc) => doc.status === DocumentStatus.PENDING_APPROVER_3).length,
      approved: approved,
      rejected: rejected,
    };

    const pipelineStageDefinitions = [
      { key: "DRAFT", label: "Draft", status: null as DocumentStatus | null },
      { key: "APPROVER_1", label: "PMV Engineer", status: DocumentStatus.PENDING_APPROVER_1 },
      { key: "APPROVER_2", label: "Workshop Manager", status: DocumentStatus.PENDING_APPROVER_2 },
      { key: "APPROVER_3", label: "PMV Manager", status: DocumentStatus.PENDING_APPROVER_3 },
      { key: "REVISION_REQUIRED", label: "Revision Required", status: DocumentStatus.REVISION_REQUIRED },
      { key: "APPROVED", label: "Approved", status: DocumentStatus.APPROVED },
    ];

    const stageItems = allDocs.map((doc) => {
      const daysPending = doc.currentApproverAssignedAt ? Math.max(0, Math.floor((Date.now() - new Date(doc.currentApproverAssignedAt).getTime()) / (1000 * 60 * 60 * 24))) : 0;
      const stageKey = doc.status === DocumentStatus.APPROVED
        ? "APPROVED"
        : doc.status === DocumentStatus.REVISION_REQUIRED
          ? "REVISION_REQUIRED"
          : doc.status === DocumentStatus.PENDING_APPROVER_3
            ? "APPROVER_3"
            : doc.status === DocumentStatus.PENDING_APPROVER_2
              ? "APPROVER_2"
              : doc.status === DocumentStatus.PENDING_APPROVER_1
                ? "APPROVER_1"
                : "DRAFT";

      return {
        id: doc.id,
        documentNumber: doc.documentNumber,
        title: doc.title,
        currentApproverName: doc.currentApprover?.name || null,
        status: doc.status,
        statusLabel: stageKey === "APPROVER_1"
          ? "PMV Engineer"
          : stageKey === "APPROVER_2"
            ? "Workshop Manager"
            : stageKey === "APPROVER_3"
              ? "PMV Manager"
              : doc.status === DocumentStatus.REVISION_REQUIRED
                ? "Revision Required"
                : doc.status === DocumentStatus.APPROVED
                  ? "Approved"
                  : doc.status === DocumentStatus.REJECTED
                    ? "Rejected"
                    : doc.status.replaceAll("_", " "),
        stageKey,
        daysPending,
        createdAtLabel: new Intl.DateTimeFormat("en-US", { dateStyle: "medium" }).format(doc.createdAt),
      };
    });

    workflowStageDocuments = stageItems;
    workflowStageMetrics = pipelineStageDefinitions.map((stage) => {
      const matchingDocuments = stageItems.filter((item) => item.stageKey === stage.key);
      const averageDaysPending = matchingDocuments.length > 0
        ? Math.round(matchingDocuments.reduce((sum, item) => sum + item.daysPending, 0) / matchingDocuments.length)
        : 0;
      const oldestPendingDocument = matchingDocuments
        .slice()
        .sort((a, b) => b.daysPending - a.daysPending)[0] ?? null;

      return {
        key: stage.key,
        label: stage.label,
        count: matchingDocuments.length,
        averageDaysPending,
        assignees: stage.key.startsWith("APPROVER_")
          ? roleGroups
              .filter((user) => user.role === stage.key)
              .map((user) => ({ name: user.name, email: user.email }))
          : [],
        oldestPendingDocument: oldestPendingDocument
          ? { documentNumber: oldestPendingDocument.documentNumber, title: oldestPendingDocument.title }
          : null,
      };
    });
    procurementMetrics = {
      comparisons: allDocs.filter((doc) => doc.documentType === "COMPARISON").length,
      approvedComparisons: allDocs.filter((doc) => doc.documentType === "COMPARISON" && doc.status === DocumentStatus.APPROVED).length,
      mrCash: allDocs.filter((doc) => doc.documentType === "MATERIAL_REQUISITION" && doc.mrType === "CASH").length,
      approvedMrCash: allDocs.filter((doc) => doc.documentType === "MATERIAL_REQUISITION" && doc.mrType === "CASH" && doc.status === DocumentStatus.APPROVED).length,
      mrCredit: allDocs.filter((doc) => doc.documentType === "MATERIAL_REQUISITION" && doc.mrType === "CREDIT").length,
      approvedMrCredit: allDocs.filter((doc) => doc.documentType === "MATERIAL_REQUISITION" && doc.mrType === "CREDIT" && doc.status === DocumentStatus.APPROVED).length,
      avgTurnaroundDays: await (async () => {
        const comparisonsWithLinkedMR = await prisma.document.findMany({
          where: {
            documentType: "COMPARISON",
            status: DocumentStatus.APPROVED,
            linkedMRs: { some: {} },
          },
          select: {
            approvals: {
              where: { action: ApprovalActionType.APPROVED },
              orderBy: { performedAt: "desc" },
              take: 1,
              select: { performedAt: true },
            },
            linkedMRs: {
              orderBy: { createdAt: "asc" },
              take: 1,
              select: { createdAt: true },
            },
          },
        });

        const turnarounds = comparisonsWithLinkedMR
          .map((comparison) => {
            const compApprovedAt = comparison.approvals[0]?.performedAt;
            const linkedMrCreatedAt = comparison.linkedMRs[0]?.createdAt;
            if (!compApprovedAt || !linkedMrCreatedAt) return null;
            const diffDays = (linkedMrCreatedAt.getTime() - compApprovedAt.getTime()) / (1000 * 60 * 60 * 24);
            return diffDays >= 0 ? diffDays : null;
          })
          .filter((d): d is number => d !== null);

        return turnarounds.length > 0
          ? Math.round(turnarounds.reduce((a, b) => a + b, 0) / turnarounds.length)
          : null;
      })(),
    };
  } catch {
    totalDocuments = 0;
  }

  return (
    <DashboardShell
      role={session.role}
      userName={session.name}
      title="Admin Dashboard"
      subtitle="System-wide document workflow control center"
    >
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
          <div className="grid grid-cols-1 gap-3 p-5 sm:grid-cols-2">
            <article className="rounded-2xl bg-slate-100 p-5 text-slate-900 ring-1 ring-slate-300 shadow-sm">
              <p className="text-sm font-medium">Total Documents</p>
              <p className="mt-3 text-3xl font-semibold">{totalDocuments}</p>
            </article>
            <article className="rounded-2xl bg-amber-50 p-5 text-amber-900 ring-1 ring-amber-200 shadow-sm">
              <p className="text-sm font-medium">Pending</p>
              <p className="mt-3 text-3xl font-semibold">{pendingApprovals}</p>
            </article>
            <article className="rounded-2xl bg-emerald-50 p-5 text-emerald-900 ring-1 ring-emerald-200 shadow-sm">
              <p className="text-sm font-medium">Approved</p>
              <p className="mt-3 text-3xl font-semibold">{approvedDocuments}</p>
            </article>
            <article className="rounded-2xl bg-rose-50 p-5 text-rose-900 ring-1 ring-rose-200 shadow-sm">
              <p className="text-sm font-medium">Rejected</p>
              <p className="mt-3 text-3xl font-semibold">{rejectedDocuments}</p>
            </article>
          </div>
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 px-5 py-4">
            <h3 className="text-base font-semibold text-slate-900">Pending Aging</h3>
            <p className="mt-1 text-sm text-slate-500">How long documents are waiting</p>
          </div>
          <div className="grid grid-cols-1 gap-3 p-5 sm:grid-cols-2">
            <article className="rounded-2xl bg-emerald-50 p-5 text-emerald-900 ring-1 ring-emerald-200 shadow-sm">
              <p className="text-sm font-medium">Under 3h</p>
              <p className="mt-3 text-3xl font-semibold">{agingSummary.under3}</p>
            </article>
            <article className="rounded-2xl bg-amber-50 p-5 text-amber-900 ring-1 ring-amber-200 shadow-sm">
              <p className="text-sm font-medium">3-24h</p>
              <p className="mt-3 text-3xl font-semibold">{agingSummary.between3And24}</p>
            </article>
            <article className="rounded-2xl bg-rose-50 p-5 text-rose-900 ring-1 ring-rose-200 shadow-sm">
              <p className="text-sm font-medium">24h+</p>
              <p className="mt-3 text-3xl font-semibold">{agingSummary.over24}</p>
            </article>
            <article className="rounded-2xl bg-violet-50 p-5 text-violet-900 ring-1 ring-violet-200 shadow-sm">
              <p className="text-sm font-medium">Overdue</p>
              <p className="mt-3 text-3xl font-semibold">{agingSummary.overdue}</p>
            </article>
          </div>
        </section>
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1.3fr,0.9fr]">
        <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 px-5 py-4">
            <h3 className="text-base font-semibold text-slate-900">Workflow Pipeline</h3>
          </div>
          <div className="p-5">
            <WorkflowPipelineChart stages={workflowStageMetrics} documents={workflowStageDocuments.map((document) => ({ ...document, statusLabel: document.statusLabel.replaceAll("_", " ") }))} />
          </div>
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 px-5 py-4">
            <h3 className="text-base font-semibold text-slate-900">Pending Aging Snapshot</h3>
          </div>
          <div className="space-y-3 p-5">
            {pendingDocuments.length === 0 ? (
              <div className="rounded-xl bg-slate-50 px-4 py-3 text-sm text-slate-600 ring-1 ring-slate-200">
                No pending documents to age.
              </div>
            ) : (
              pendingDocuments.map((doc) => {
                const hours = getWaitingHours(allDocuments.find((item) => item.id === doc.id)?.currentApproverAssignedAt ?? null);
                return (
                  <div key={doc.id} className="rounded-xl bg-slate-50 px-4 py-3 ring-1 ring-slate-200">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-sm font-semibold text-slate-900">{doc.documentNumber}</p>
                      <span className="text-xs font-medium text-slate-600">{formatWaitingTime(hours)}</span>
                    </div>
                    <p className="mt-1 text-sm text-slate-700">Current Approver: {allDocuments.find((item) => item.id === doc.id)?.currentApprover?.name || "Unassigned"}</p>
                  </div>
                );
              })
            )}
          </div>
        </section>
      </div>

      <div className="space-y-6">
        <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 px-5 py-4">
            <h3 className="text-base font-semibold text-slate-900">Deletion Requests</h3>
            <p className="mt-1 text-sm text-slate-500">Clerk requests awaiting Admin approval.</p>
          </div>
          <DeletionRequestsList requests={pendingDeletionRequests} />
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
                  <p className="text-sm font-semibold text-slate-900">
                    {item.document.documentNumber} - {item.document.title}
                  </p>
                  <p className="mt-1 text-sm text-slate-700">Action: {item.action.replaceAll("_", " ")}</p>
                  <p className="mt-1 text-xs text-slate-500">
                    By {item.performedBy.name} ({item.performedBy.email})
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    {new Intl.DateTimeFormat("en-US", {
                      dateStyle: "medium",
                      timeStyle: "short",
                    }).format(item.performedAt)}
                  </p>
                </div>
              ))
            )}
          </div>
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 px-5 py-4">
            <h3 className="text-base font-semibold text-slate-900">Procurement Metrics</h3>
          </div>
          <div className="space-y-3 p-5">
            {[
              { label: "Total Comparisons", value: procurementMetrics.comparisons },
              { label: "Approved Comparisons", value: procurementMetrics.approvedComparisons },
              { label: "Total MR Cash", value: procurementMetrics.mrCash },
              { label: "Approved MR Cash", value: procurementMetrics.approvedMrCash },
              { label: "Total MR Credit", value: procurementMetrics.mrCredit },
              { label: "Approved MR Credit", value: procurementMetrics.approvedMrCredit },
            ].map((item) => (
              <div key={item.label} className="flex items-center justify-between rounded-xl bg-slate-50 px-4 py-3 ring-1 ring-slate-200">
                <p className="text-sm font-medium text-slate-700">{item.label}</p>
                <p className="text-sm font-semibold text-slate-900">{item.value}</p>
              </div>
            ))}
            <div className="flex items-center justify-between rounded-xl bg-slate-100 px-4 py-3 ring-1 ring-slate-300">
              <p className="text-sm font-medium text-slate-700">Avg. Comparison → MR Turnaround</p>
              <p className="text-sm font-semibold text-slate-900">
                {procurementMetrics.avgTurnaroundDays !== null ? `${procurementMetrics.avgTurnaroundDays} day${procurementMetrics.avgTurnaroundDays !== 1 ? "s" : ""}` : "No data"}
              </p>
            </div>
          </div>
        </section>

      </div>
    </DashboardShell>
  );
}
