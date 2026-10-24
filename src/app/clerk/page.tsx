// src/app/clerk/page.tsx
import Link from "next/link";
import { DocumentStatus } from "@prisma/client";
import DashboardShell from "@/components/dashboard-shell";
import DocumentListTable from "@/components/document-list-table";
import PageSummaryCards from "@/components/page-summary-cards";
import { requireUserType } from "@/lib/auth/guards";
import { USER_TYPE } from "@/lib/auth/roles";
import { prisma } from "@/lib/prisma";
import { getDocumentsForClerk } from "@/lib/document-queries";
import { toListItem } from "@/lib/document-list";
import { withDownloadTracking } from "@/lib/download-tracking";

export const dynamic = "force-dynamic";

export default async function ClerkDashboardPage() {
  const session = await requireUserType([USER_TYPE.CLERK]);

  const [data, activities] = await Promise.all([
    getDocumentsForClerk(session.userId, session.userType),
    prisma.approvalHistory.findMany({
      where: { document: { createdById: session.userId } },
      include: { document: { select: { documentNumber: true, title: true } } },
      orderBy: { performedAt: "desc" },
      take: 8,
    }),
  ]);

  const recentDocuments = await withDownloadTracking(data.documents.slice(0, 6), session.userId);
  const revisionRequired = data.documents.filter((doc) => doc.status === DocumentStatus.REVISION_REQUIRED).length;

  return (
    <DashboardShell role={session.userType} userName={session.name} title="Clerk Dashboard" subtitle="Submit and track document workflows">
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
          { label: "Total Documents", value: String(data.total), tone: "bg-slate-900 text-white" },
          { label: "Pending", value: String(data.pending), tone: "bg-yellow-50 text-yellow-900 ring-1 ring-yellow-200" },
          { label: "Revision Required", value: String(revisionRequired), tone: "bg-violet-50 text-violet-900 ring-1 ring-violet-200" },
          { label: "Approved", value: String(data.approved), tone: "bg-emerald-50 text-emerald-900 ring-1 ring-emerald-200" },
          { label: "Rejected", value: String(data.rejected), tone: "bg-rose-50 text-rose-900 ring-1 ring-rose-200" },
        ]}
      />

      <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
          <h3 className="text-base font-semibold text-slate-900">Recent Documents</h3>
        </div>
        <DocumentListTable documents={recentDocuments.map(toListItem)} emptyMessage="No documents available yet." showDownloadTracking />
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 px-5 py-4">
          <h3 className="text-base font-semibold text-slate-900">Workflow Activity</h3>
        </div>
        <div className="divide-y divide-slate-100">
          {activities.length === 0 ? (
            <div className="px-5 py-6 text-sm text-slate-500">No workflow activity found.</div>
          ) : (
            activities.map((item) => (
              <div key={item.id} className="px-5 py-4">
                <p className="text-sm font-semibold text-slate-900">{item.document.documentNumber} - {item.document.title}</p>
                <p className="mt-1 text-sm text-slate-700">Action: {String(item.action).replaceAll("_", " ")}</p>
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
