import Link from "next/link";
import { DocumentStatus, UserRole } from "@prisma/client";
import DashboardShell from "@/components/dashboard-shell";
import DocumentListTable from "@/components/document-list-table";
import PageSummaryCards from "@/components/page-summary-cards";
import { requireRole } from "@/lib/auth/guards";
import { isRestrictedClerk } from "@/lib/auth/resource-access";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export default async function ClerkDashboardPage() {
  const session = await requireRole([UserRole.CLERK]);

  const isRestricted = isRestrictedClerk(session);
  const clerkWhere = isRestricted ? { createdById: session.userId } : {};

  let totalDocuments = 0;
  let recentDocuments: {
    id: string;
    documentNumber: string;
    title: string;
    status: DocumentStatus;
    documentType: "COMPARISON" | "MATERIAL_REQUISITION";
    mrType?: "CASH" | "CREDIT" | null;
    currentVersion: number;
    createdAt: Date;
    downloadedAt: Date | null;
    currentApprover: { name: string } | null;
    relatedComparison: { id: string; documentNumber: string } | null;
    approvals: { performedAt: Date }[];
  }[] = [];
  let statusCounts = {
    pending: 0,
    revisionRequired: 0,
    approved: 0,
    rejected: 0,
  };
  let activities: { id: string; action: string; performedAt: Date; document: { documentNumber: string; title: string } }[] = [];

  try {
    const [total, recent, pendingCount, approvedCount, rejectedCount, recentActivity] = await Promise.all([
      prisma.document.count({ where: clerkWhere }),
      prisma.document.findMany({
        where: clerkWhere,
        include: {
          currentApprover: { select: { name: true } },
          relatedComparison: { select: { id: true, documentNumber: true } },
          approvals: {
            where: { action: "APPROVED" },
            orderBy: { performedAt: "desc" },
            take: 1,
            select: { performedAt: true },
          },
        },
        orderBy: { createdAt: "desc" },
        take: 6,
      }),
      prisma.document.count({
        where: {
          ...clerkWhere,
          status: {
            in: [
              DocumentStatus.PENDING_APPROVER_1,
              DocumentStatus.PENDING_APPROVER_2,
              DocumentStatus.PENDING_APPROVER_3,
            ],
          },
        },
      }),
      prisma.document.count({ where: { ...clerkWhere, status: DocumentStatus.APPROVED } }),
      prisma.document.count({ where: { ...clerkWhere, status: DocumentStatus.REJECTED } }),
      prisma.approvalHistory.findMany({
        where: { document: { createdById: session.userId } },
        include: { document: { select: { documentNumber: true, title: true } } },
        orderBy: { performedAt: "desc" },
        take: 8,
      }),
    ]);

    totalDocuments = total;
    recentDocuments = recent;
    statusCounts = {
      pending: pendingCount,
      revisionRequired: 0,
      approved: approvedCount,
      rejected: rejectedCount,
    };
    activities = recentActivity.map((item) => ({ ...item, action: String(item.action) }));
  } catch {
    totalDocuments = 0;
  }

  const pendingDocuments = recentDocuments.filter((doc) => doc.status === DocumentStatus.PENDING_APPROVER_1 || doc.status === DocumentStatus.PENDING_APPROVER_2 || doc.status === DocumentStatus.PENDING_APPROVER_3);

  if (isRestricted) {
  return (
    <DashboardShell role={session.role} userName={session.name} title="Dashboard" subtitle="Submit and track document workflows">
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Document Dashboard</p>
        <h2 className="mt-2 text-2xl font-semibold text-slate-900">Welcome, {session.name}</h2>
        <p className="mt-1 text-sm text-slate-600">Review pending approvals and track your workflow activity.</p>
      </div>
      <PageSummaryCards cards={[
        { label: "Pending Approval", value: String(statusCounts.pending), tone: "bg-yellow-50 text-yellow-900 ring-1 ring-yellow-200" },
        { label: "Revision Required", value: String(statusCounts.revisionRequired), tone: "bg-violet-50 text-violet-900 ring-1 ring-violet-200" },
        { label: "Approved", value: String(statusCounts.approved), tone: "bg-emerald-50 text-emerald-900 ring-1 ring-emerald-200" },
        { label: "Rejected", value: String(statusCounts.rejected), tone: "bg-rose-50 text-rose-900 ring-1 ring-rose-200" },
      ]} />
      <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 px-5 py-4"><h3 className="text-base font-semibold text-slate-900">Pending Approvals</h3></div>
        <DocumentListTable documents={pendingDocuments.map((doc) => ({ id: doc.id, documentNumber: doc.documentNumber, title: doc.title, status: doc.status, documentType: doc.documentType, mrType: doc.mrType, currentVersion: doc.currentVersion, currentApproverName: doc.currentApprover?.name || null, relatedComparisonId: doc.relatedComparison?.id || null, relatedComparisonDocumentNumber: doc.relatedComparison?.documentNumber || null, downloadedAt: doc.downloadedAt, approvalDate: doc.approvals[0]?.performedAt || null, dateLabel: new Intl.DateTimeFormat("en-US", { dateStyle: "medium" }).format(doc.createdAt) }))} emptyMessage="No pending approvals." showDownloadTracking />
      </section>
      <section className="rounded-2xl border border-slate-200 bg-white shadow-sm"><div className="border-b border-slate-200 px-5 py-4"><h3 className="text-base font-semibold text-slate-900">Workflow Activity</h3></div><div className="divide-y divide-slate-100">{activities.length === 0 ? <div className="px-5 py-6 text-sm text-slate-500">No workflow activity found.</div> : activities.map((item) => <div key={item.id} className="px-5 py-4"><p className="text-sm font-semibold text-slate-900">{item.document.documentNumber} - {item.document.title}</p><p className="mt-1 text-sm text-slate-700">Action: {item.action.replaceAll("_", " ")}</p><p className="mt-1 text-xs text-slate-500">{new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" }).format(item.performedAt)}</p></div>)}</div></section>
    </DashboardShell>
  );
  }

  return (
    <DashboardShell
      role={session.role}
      userName={session.name}
      title="Clerk Dashboard"
      subtitle="Submit and track document workflows"
    >
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Welcome</p>
            <h2 className="mt-2 text-2xl font-semibold text-slate-900">Hello, {session.name}</h2>
            <p className="mt-1 text-sm text-slate-600">Create new documents and monitor approval status.</p>
          </div>
          <Link
            href="/new-document"
            className="inline-flex items-center rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-slate-700"
          >
            Upload New Document
          </Link>
        </div>
      </div>

      <PageSummaryCards
        cards={[
          { label: "Total Documents", value: String(totalDocuments), tone: "bg-slate-900 text-white" },
          { label: "Pending", value: String(statusCounts.pending), tone: "bg-yellow-50 text-yellow-900 ring-1 ring-yellow-200" },
          { label: "Approved", value: String(statusCounts.approved), tone: "bg-emerald-50 text-emerald-900 ring-1 ring-emerald-200" },
          { label: "Rejected", value: String(statusCounts.rejected), tone: "bg-rose-50 text-rose-900 ring-1 ring-rose-200" },
        ]}
      />

      <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
          <h3 className="text-base font-semibold text-slate-900">Recent Documents</h3>
        </div>
        <DocumentListTable
          documents={recentDocuments.map((doc) => ({
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
            downloadedAt: doc.downloadedAt,
            approvalDate: doc.approvals[0]?.performedAt || null,
            dateLabel: new Intl.DateTimeFormat("en-US", { dateStyle: "medium" }).format(doc.createdAt),
          }))}
          emptyMessage="No documents available yet."
          showDownloadTracking
        />
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h3 className="text-base font-semibold text-slate-900">Document Status Overview</h3>
        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="rounded-xl bg-yellow-50 px-4 py-3 ring-1 ring-yellow-200">
            <p className="text-xs uppercase tracking-wide text-yellow-700">Pending</p>
            <p className="mt-1 text-2xl font-semibold text-yellow-900">{statusCounts.pending}</p>
          </div>
          <div className="rounded-xl bg-emerald-50 px-4 py-3 ring-1 ring-emerald-200">
            <p className="text-xs uppercase tracking-wide text-emerald-700">Approved</p>
            <p className="mt-1 text-2xl font-semibold text-emerald-900">{statusCounts.approved}</p>
          </div>
          <div className="rounded-xl bg-rose-50 px-4 py-3 ring-1 ring-rose-200">
            <p className="text-xs uppercase tracking-wide text-rose-700">Rejected</p>
            <p className="mt-1 text-2xl font-semibold text-rose-900">{statusCounts.rejected}</p>
          </div>
        </div>
      </section>
    </DashboardShell>
  );
}
