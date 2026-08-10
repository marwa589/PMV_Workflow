import { ApprovalActionType, DocumentStatus } from "@prisma/client";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Clock, Download } from "lucide-react";
import DashboardShell from "@/components/dashboard-shell";
import { requireAuth } from "@/lib/auth/guards";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

function formatTurnaround(ms: number): string {
  const days = Math.floor(ms / (1000 * 60 * 60 * 24));
  const hours = Math.floor((ms % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
  if (days > 0) return `${days} day${days !== 1 ? "s" : ""} ${hours}h`;
  return `${hours} hour${hours !== 1 ? "s" : ""}`;
}

export default async function ProcurementPackagePage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireAuth();
  const { id } = await params;

  const packageDocument = await prisma.document.findUnique({
    where: { id },
    select: {
      id: true,
      documentNumber: true,
      title: true,
      mrNumber: true,
      mrType: true,
      status: true,
      createdAt: true,
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
      versions: { orderBy: { versionNumber: "asc" }, select: { id: true, versionNumber: true, originalName: true, filePath: true, mimeType: true } },
    },
  });

  if (!packageDocument) {
    notFound();
  }

  const compApprovedAt = packageDocument.relatedComparison?.approvals[0]?.performedAt ?? null;
  const turnaroundMs = compApprovedAt ? packageDocument.createdAt.getTime() - compApprovedAt.getTime() : null;

  return (
    <DashboardShell role={session.role} userName={session.name} title="Procurement Package" subtitle="Approved MR and comparison package">
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Package overview</p>
            <h2 className="mt-2 text-2xl font-semibold text-slate-900">{packageDocument.documentNumber}</h2>
            <p className="mt-2 text-sm text-slate-600">{packageDocument.title}</p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            {turnaroundMs !== null && turnaroundMs >= 0 ? (
              <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-4 py-2">
                <Clock className="h-4 w-4 text-slate-500" />
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-widest text-slate-400">Comparison → MR turnaround</p>
                  <p className="text-sm font-semibold text-slate-900">{formatTurnaround(turnaroundMs)}</p>
                </div>
              </div>
            ) : null}
            <div className="rounded-full bg-emerald-50 px-3 py-1 text-sm font-medium text-emerald-700">Approved</div>
          </div>
        </div>

        <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <p className="text-sm font-semibold text-slate-900">MR</p>
            <p className="mt-2 text-sm text-slate-600">MR Number: {packageDocument.mrNumber || "—"}</p>
            <p className="mt-1 text-sm text-slate-600">MR Type: {packageDocument.mrType === "CASH" ? "Cash" : packageDocument.mrType === "CREDIT" ? "Credit" : "—"}</p>
            <p className="mt-1 text-sm text-slate-600">Submitted: {new Intl.DateTimeFormat("en-US", { dateStyle: "medium" }).format(packageDocument.createdAt)}</p>
            <a href={`/api/documents/${packageDocument.id}/download`} className="mt-4 inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
              <Download className="h-4 w-4" />
              Download MR
            </a>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <p className="text-sm font-semibold text-slate-900">Comparison</p>
            {packageDocument.relatedComparison ? (
              <>
                <p className="mt-2 text-sm text-slate-600">{packageDocument.relatedComparison.documentNumber}</p>
                <p className="mt-1 text-sm text-slate-600">{packageDocument.relatedComparison.title}</p>
                {compApprovedAt ? (
                  <p className="mt-1 text-sm text-slate-600">
                    Approved: {new Intl.DateTimeFormat("en-US", { dateStyle: "medium" }).format(compApprovedAt)}
                  </p>
                ) : null}
                <a href={`/api/documents/${packageDocument.relatedComparison.id}/download`} className="mt-4 inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
                  <Download className="h-4 w-4" />
                  Download Comparison
                </a>
              </>
            ) : (
              <p className="mt-2 text-sm text-slate-600">No comparison linked.</p>
            )}
          </div>
        </div>
      </div>
    </DashboardShell>
  );
}
