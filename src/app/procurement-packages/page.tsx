import { ApprovalActionType, DocumentStatus } from "@prisma/client";
import Link from "next/link";
import DashboardShell from "@/components/dashboard-shell";
import { requireAuth } from "@/lib/auth/guards";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

function formatTurnaround(ms: number): string {
  const days = Math.floor(ms / (1000 * 60 * 60 * 24));
  const hours = Math.floor((ms % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
  if (days > 0) return `${days}d ${hours}h`;
  return `${hours}h`;
}

export default async function ProcurementPackagesPage() {
  const session = await requireAuth();

  const packages = await prisma.document.findMany({
    where: { documentType: "MATERIAL_REQUISITION", status: DocumentStatus.APPROVED },
    select: {
      id: true,
      documentNumber: true,
      title: true,
      mrType: true,
      mrNumber: true,
      status: true,
      createdAt: true,
      updatedAt: true,
      relatedComparison: {
        select: {
          id: true,
          documentNumber: true,
          title: true,
          approvals: {
            where: { action: ApprovalActionType.APPROVED },
            orderBy: { performedAt: "desc" },
            take: 1,
            select: { performedAt: true },
          },
        },
      },
    },
    orderBy: { updatedAt: "desc" },
  });

  // Approved comparisons with no linked MR submitted yet
  const orphanComparisons = await prisma.document.findMany({
    where: {
      documentType: "COMPARISON",
      status: DocumentStatus.APPROVED,
      linkedMRs: { none: {} },
    },
    select: {
      id: true,
      documentNumber: true,
      title: true,
      approvals: {
        where: { action: ApprovalActionType.APPROVED },
        orderBy: { performedAt: "desc" },
        take: 1,
        select: { performedAt: true },
      },
    },
    orderBy: { updatedAt: "desc" },
  });

  const now = Date.now();

  return (
    <DashboardShell role={session.role} userName={session.name} title="MRs + Comparisons" subtitle="Approved MRs with their linked comparison sheets">
      <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 px-5 py-4">
          <h3 className="text-base font-semibold text-slate-900">MRs + Comparisons</h3>
          <p className="mt-1 text-sm text-slate-500">Each row shows the MR and the comparison linked to it when one exists.</p>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-5 py-3 font-semibold">MR Number</th>
                <th className="px-5 py-3 font-semibold">MR Type</th>
                <th className="px-5 py-3 font-semibold">Related Comparison</th>
                <th className="px-5 py-3 font-semibold">Approval Date</th>
                <th className="px-5 py-3 font-semibold">Turnaround</th>
                <th className="px-5 py-3 font-semibold">Status</th>
                <th className="px-5 py-3 font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody>
              {packages.map((item) => {
                const compApprovedAt = item.relatedComparison?.approvals[0]?.performedAt;
                const turnaroundMs = compApprovedAt ? item.createdAt.getTime() - compApprovedAt.getTime() : null;
                return (
                  <tr key={item.id} className="border-t border-slate-100">
                    <td className="px-5 py-4 font-semibold text-slate-900">{item.documentNumber}</td>
                    <td className="px-5 py-4 text-slate-700">{item.mrType === "CASH" ? "Cash" : item.mrType === "CREDIT" ? "Credit" : "—"}</td>
                    <td className="px-5 py-4 text-slate-700">
                      {item.relatedComparison ? (
                        <div>
                          <div className="font-medium text-slate-900">{item.relatedComparison.documentNumber}</div>
                          <div className="text-xs text-slate-500">{item.relatedComparison.title}</div>
                        </div>
                      ) : (
                        <span className="text-slate-500">No comparison linked</span>
                      )}
                    </td>
                    <td className="px-5 py-4 text-slate-500">{new Intl.DateTimeFormat("en-US", { dateStyle: "medium" }).format(item.updatedAt)}</td>
                    <td className="px-5 py-4">
                      {turnaroundMs !== null && turnaroundMs >= 0 ? (
                        <span className="inline-flex items-center rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-700">
                          {formatTurnaround(turnaroundMs)}
                        </span>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>
                    <td className="px-5 py-4 text-slate-700">{item.status === DocumentStatus.APPROVED ? "Approved" : item.status}</td>
                    <td className="px-5 py-4">
                      <Link href={`/procurement-packages/${item.id}`} className="text-sm font-medium text-cyan-700 hover:underline">
                        View package
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {orphanComparisons.length > 0 ? (
        <section className="rounded-2xl border border-amber-200 bg-amber-50 shadow-sm">
          <div className="border-b border-amber-200 px-5 py-4">
            <h3 className="text-base font-semibold text-amber-900">Awaiting MR — Approved Comparisons</h3>
            <p className="mt-1 text-sm text-amber-700">These comparisons are approved but no MR has been linked yet.</p>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-amber-100/60 text-xs uppercase tracking-wide text-amber-700">
                <tr>
                  <th className="px-5 py-3 font-semibold">Comparison</th>
                  <th className="px-5 py-3 font-semibold">Title</th>
                  <th className="px-5 py-3 font-semibold">Approved</th>
                  <th className="px-5 py-3 font-semibold">Waiting since</th>
                </tr>
              </thead>
              <tbody>
                {orphanComparisons.map((comp) => {
                  const approvedAt = comp.approvals[0]?.performedAt;
                  const waitMs = approvedAt ? now - approvedAt.getTime() : null;
                  return (
                    <tr key={comp.id} className="border-t border-amber-100">
                      <td className="px-5 py-4 font-semibold text-slate-900">{comp.documentNumber}</td>
                      <td className="px-5 py-4 text-slate-700">{comp.title}</td>
                      <td className="px-5 py-4 text-slate-500">
                        {approvedAt ? new Intl.DateTimeFormat("en-US", { dateStyle: "medium" }).format(approvedAt) : "—"}
                      </td>
                      <td className="px-5 py-4">
                        {waitMs !== null ? (
                          <span className="inline-flex items-center rounded-full bg-amber-200 px-2.5 py-1 text-xs font-semibold text-amber-900">
                            {formatTurnaround(waitMs)} ago
                          </span>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
    </DashboardShell>
  );
}
