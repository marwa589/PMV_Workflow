import { ApprovalActionType, DocumentStatus, UserRole } from "@prisma/client";
import ApproverPendingTable from "@/components/approver-pending-table";
import DashboardShell from "@/components/dashboard-shell";
import DocumentListTable from "@/components/document-list-table";
import { requireRole } from "@/lib/auth/guards";
import { APPROVER_ROLES, roleLabel } from "@/lib/auth/roles";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export default async function ApproverDashboardPage() {
  const session = await requireRole(APPROVER_ROLES);

  let pendingCount = 0;
  let revisionRequiredCount = 0;
  let approvedCount = 0;
  let rejectedCount = 0;
  let pendingDocuments: {
    id: string;
    documentNumber: string;
    title: string;
    documentType: "COMPARISON" | "MATERIAL_REQUISITION";
    mrType?: "CASH" | "CREDIT" | null;
    currentVersion: number;
    uploadedAt: string;
  }[] = [];
  let revisionRequiredDocuments: {
    id: string;
    documentNumber: string;
    title: string;
    documentType: "COMPARISON" | "MATERIAL_REQUISITION";
    mrType?: "CASH" | "CREDIT" | null;
    currentVersion: number;
    uploadedAt: string;
  }[] = [];
  let approvedDocuments: {
    id: string;
    documentNumber: string;
    title: string;
    status: DocumentStatus;
    documentType: "COMPARISON" | "MATERIAL_REQUISITION";
    mrType?: "CASH" | "CREDIT" | null;
    currentVersion: number;
    performedAt: Date;
  }[] = [];
  let activities: {
    id: string;
    action: ApprovalActionType;
    performedAt: Date;
    comments: string | null;
    document: { documentNumber: string; title: string };
  }[] = [];

  try {
    const [pending, revisionRequired, approved, rejected, pendingDocs, revisionRequiredDocs, recentApproved, recentActivity] = await Promise.all([
      prisma.document.count({
        where: {
          currentApproverId: session.userId,
          status: {
            in: [
              DocumentStatus.PENDING_APPROVER_1,
              DocumentStatus.PENDING_APPROVER_2,
              DocumentStatus.PENDING_APPROVER_3,
            ],
          },
        },
      }),
      prisma.document.count({
        where: {
          currentApproverId: session.userId,
          status: DocumentStatus.REVISION_REQUIRED,
        },
      }),
      prisma.approvalHistory.count({
        where: {
          performedById: session.userId,
          action: ApprovalActionType.APPROVED,
        },
      }),
      prisma.approvalHistory.count({
        where: {
          performedById: session.userId,
          action: ApprovalActionType.REJECTED,
        },
      }),
      prisma.document.findMany({
        where: {
          currentApproverId: session.userId,
          status: {
            in: [
              DocumentStatus.PENDING_APPROVER_1,
              DocumentStatus.PENDING_APPROVER_2,
              DocumentStatus.PENDING_APPROVER_3,
            ],
          },
        },
        orderBy: { createdAt: "desc" },
        take: 10,
      }),
      prisma.document.findMany({
        where: {
          currentApproverId: session.userId,
          status: DocumentStatus.REVISION_REQUIRED,
        },
        orderBy: { createdAt: "desc" },
        take: 10,
      }),
      prisma.approvalHistory.findMany({
        where: {
          performedById: session.userId,
          action: ApprovalActionType.APPROVED,
        },
        include: {
          document: {
            select: {
              id: true,
              documentNumber: true,
              title: true,
              status: true,
              documentType: true,
              mrType: true,
              currentVersion: true,
            },
          },
        },
        orderBy: { performedAt: "desc" },
        take: 8,
      }),
      prisma.approvalHistory.findMany({
        where: { performedById: session.userId },
        include: {
          document: {
            select: {
              documentNumber: true,
              title: true,
            },
          },
        },
        orderBy: { performedAt: "desc" },
        take: 8,
      }),
    ]);

    pendingCount = pending;
    revisionRequiredCount = revisionRequired;
    approvedCount = approved;
    rejectedCount = rejected;
    pendingDocuments = pendingDocs.map((doc) => ({
      id: doc.id,
      documentNumber: doc.documentNumber,
      title: doc.title,
      documentType: doc.documentType,
      mrType: doc.mrType,
      currentVersion: doc.currentVersion,
      uploadedAt: new Intl.DateTimeFormat("en-US", { dateStyle: "medium" }).format(doc.createdAt),
    }));
    revisionRequiredDocuments = revisionRequiredDocs.map((doc) => ({
      id: doc.id,
      documentNumber: doc.documentNumber,
      title: doc.title,
      documentType: doc.documentType,
      mrType: doc.mrType,
      currentVersion: doc.currentVersion,
      uploadedAt: new Intl.DateTimeFormat("en-US", { dateStyle: "medium" }).format(doc.createdAt),
    }));
    approvedDocuments = recentApproved.map((item) => ({
      id: item.document.id,
      documentNumber: item.document.documentNumber,
      title: item.document.title,
      status: item.document.status,
      documentType: item.document.documentType,
      mrType: item.document.mrType,
      currentVersion: item.document.currentVersion,
      performedAt: item.performedAt,
    }));
    activities = recentActivity;
  } catch {
    pendingCount = 0;
  }

  return (
    <DashboardShell
      role={session.role}
      userName={session.name}
      title="Approver Dashboard"
      subtitle={`${roleLabel(session.role)} workflow queue`}
    >
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Approval Workbench</p>
        <h2 className="mt-2 text-2xl font-semibold text-slate-900">Welcome, {session.name}</h2>
        <p className="mt-1 text-sm text-slate-600">Review pending submissions and track your decision activity.</p>
      </div>

      <div className={`grid grid-cols-1 gap-4 ${session.role === UserRole.APPROVER_3 ? "md:grid-cols-5" : "md:grid-cols-4"}`}>
        <article className="rounded-2xl bg-slate-50 p-5 text-slate-900 ring-1 ring-slate-200 shadow-sm">
          <p className="text-sm font-medium">My Pending Approvals</p>
          <p className="mt-3 text-3xl font-semibold">{pendingCount}</p>
        </article>
        <article className="rounded-2xl bg-slate-50 p-5 text-slate-900 ring-1 ring-slate-200 shadow-sm">
          <p className="text-sm font-medium">Revision Required</p>
          <p className="mt-3 text-3xl font-semibold">{revisionRequiredCount}</p>
        </article>
        <article className="rounded-2xl bg-emerald-50 p-5 text-emerald-900 ring-1 ring-emerald-200 shadow-sm">
          <p className="text-sm font-medium">My Approved Documents</p>
          <p className="mt-3 text-3xl font-semibold">{approvedCount}</p>
        </article>
        <article className="rounded-2xl bg-rose-50 p-5 text-rose-900 ring-1 ring-rose-200 shadow-sm">
          <p className="text-sm font-medium">My Rejected Documents</p>
          <p className="mt-3 text-3xl font-semibold">{rejectedCount}</p>
        </article>
      </div>

      <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 px-5 py-4">
          <h3 className="text-base font-semibold text-slate-900">Pending Approvals</h3>
        </div>
        <div className="px-1 py-4">
          <ApproverPendingTable documents={pendingDocuments} />
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 px-5 py-4">
          <h3 className="text-base font-semibold text-slate-900">Revision Required</h3>
        </div>
        <div className="px-1 py-4">
          <ApproverPendingTable documents={revisionRequiredDocuments} />
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 px-5 py-4">
          <h3 className="text-base font-semibold text-slate-900">Approved Documents</h3>
        </div>
        <DocumentListTable
          documents={approvedDocuments.map((doc) => ({
            id: doc.id,
            documentNumber: doc.documentNumber,
            title: doc.title,
            status: doc.status,
            documentType: doc.documentType,
            mrType: doc.mrType,
            currentVersion: doc.currentVersion,
            currentApproverName: null,
            dateLabel: new Intl.DateTimeFormat("en-US", { dateStyle: "medium" }).format(doc.performedAt),
          }))}
          emptyMessage="No approved documents by you yet."
        />
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 px-5 py-4">
          <h3 className="text-base font-semibold text-slate-900">Recent Workflow Activity</h3>
        </div>
        <div className="divide-y divide-slate-100">
          {activities.length === 0 ? (
            <div className="px-5 py-6 text-sm text-slate-500">No activity available yet.</div>
          ) : (
            activities.map((item) => (
              <div key={item.id} className="px-5 py-4">
                <p className="text-sm font-semibold text-slate-900">
                  {item.document.documentNumber} - {item.document.title}
                </p>
                <p className="mt-1 text-sm text-slate-700">Action: {item.action.replaceAll("_", " ")}</p>
                {item.comments ? <p className="mt-1 text-sm text-slate-600">Comment: {item.comments}</p> : null}
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
    </DashboardShell>
  );
}
