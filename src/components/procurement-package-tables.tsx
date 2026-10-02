"use client";

import { useState } from "react";
import Link from "next/link";

type PackageRow = {
  id: string;
  documentNumber: string;
  mrType: "CASH" | "CREDIT" | null;
  status: string;
  updatedAt: string;
  createdAt: string;
  relatedComparison: {
    id: string;
    documentNumber: string;
    title: string;
    approvedAt: string | null;
  } | null;
};

type OrphanComparison = {
  id: string;
  documentNumber: string;
  title: string;
  approvedAt: string | null;
};

function formatDate(value: string | null) {
  return value ? new Intl.DateTimeFormat("en-US", { dateStyle: "medium" }).format(new Date(value)) : "—";
}

function formatTurnaround(ms: number): string {
  const days = Math.floor(ms / (1000 * 60 * 60 * 24));
  const hours = Math.floor((ms / (1000 * 60 * 60)) % 24);
  if (days > 0) return `${days}d ${hours}h`;
  return `${hours}h`;
}

export default function ProcurementPackageTables({ packages, orphanComparisons, now }: { packages: PackageRow[]; orphanComparisons: OrphanComparison[]; now: number }) {
  const [packageCount, setPackageCount] = useState(10);
  const [orphanCount, setOrphanCount] = useState(10);
  const visiblePackages = packages.slice(0, packageCount);
  const visibleOrphans = orphanComparisons.slice(0, orphanCount);

  return (
    <>
      <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 px-5 py-4">
          <h3 className="text-base font-semibold text-slate-900">MRs + Comparisons</h3>
          <p className="mt-1 text-sm text-slate-500">Each row shows the MR and the comparison linked to it when one exists.</p>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500"><tr><th className="px-5 py-3 font-semibold">MR Number</th><th className="px-5 py-3 font-semibold">MR Type</th><th className="px-5 py-3 font-semibold">Related Comparison</th><th className="px-5 py-3 font-semibold">Approval Date</th><th className="px-5 py-3 font-semibold">Turnaround</th><th className="px-5 py-3 font-semibold">Status</th><th className="px-5 py-3 font-semibold">Actions</th></tr></thead>
            <tbody>
              {visiblePackages.map((item) => {
                const compApprovedAt = item.relatedComparison?.approvedAt ? new Date(item.relatedComparison.approvedAt).getTime() : null;
                const turnaroundMs = compApprovedAt ? new Date(item.createdAt).getTime() - compApprovedAt : null;
                return <tr key={item.id} className="border-t border-slate-100"><td className="px-5 py-4 font-semibold text-slate-900"><Link href={`/documents/${item.id}`} className="hover:underline">{item.documentNumber}</Link></td><td className="px-5 py-4 text-slate-700">{item.mrType === "CASH" ? "Cash" : item.mrType === "CREDIT" ? "Credit" : "—"}</td><td className="px-5 py-4 text-slate-700">{item.relatedComparison ? <div><Link href={`/documents/${item.relatedComparison.id}`} target="_blank" rel="noopener noreferrer" className="font-medium text-slate-900 hover:underline">{item.relatedComparison.documentNumber}</Link><div className="text-xs text-slate-500">{item.relatedComparison.title}</div></div> : <span className="text-slate-500">No comparison linked</span>}</td><td className="px-5 py-4 text-slate-500">{formatDate(item.updatedAt)}</td><td className="px-5 py-4">{turnaroundMs !== null && turnaroundMs >= 0 ? <span className="inline-flex items-center rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-700">{formatTurnaround(turnaroundMs)}</span> : <span className="text-slate-400">—</span>}</td><td className="px-5 py-4 text-slate-700">{item.status === "APPROVED" ? "Approved" : item.status}</td><td className="px-5 py-4"><Link href={`/procurement-packages/${item.id}`} className="text-sm font-medium text-cyan-700 hover:underline">View package</Link></td></tr>;
              })}
            </tbody>
          </table>
        </div>
        {packageCount < packages.length ? <div className="border-t border-slate-200 px-5 py-4 text-center"><button type="button" onClick={() => setPackageCount((count) => count + 10)} className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">Load more</button></div> : null}
      </section>

      {orphanComparisons.length > 0 ? <section className="rounded-2xl border border-amber-200 bg-amber-50 shadow-sm"><div className="border-b border-amber-200 px-5 py-4"><h3 className="text-base font-semibold text-amber-900">Awaiting MR — Approved Comparisons</h3><p className="mt-1 text-sm text-amber-700">These comparisons are approved but no MR has been linked yet.</p></div><div className="overflow-x-auto"><table className="min-w-full text-left text-sm"><thead className="bg-amber-100/60 text-xs uppercase tracking-wide text-amber-700"><tr><th className="px-5 py-3 font-semibold">Comparison</th><th className="px-5 py-3 font-semibold">Title</th><th className="px-5 py-3 font-semibold">Approved</th><th className="px-5 py-3 font-semibold">Waiting since</th></tr></thead><tbody>{visibleOrphans.map((comp) => { const approvedAt = comp.approvedAt ? new Date(comp.approvedAt).getTime() : null; const waitMs = approvedAt ? now - approvedAt : null; return <tr key={comp.id} className="border-t border-amber-100"><td className="px-5 py-4 font-semibold text-slate-900"><Link href={`/documents/${comp.id}`} className="hover:underline">{comp.documentNumber}</Link></td><td className="px-5 py-4 text-slate-700">{comp.title}</td><td className="px-5 py-4 text-slate-500">{formatDate(comp.approvedAt)}</td><td className="px-5 py-4">{waitMs !== null ? <span className="inline-flex items-center rounded-full bg-amber-200 px-2.5 py-1 text-xs font-semibold text-amber-900">{formatTurnaround(waitMs)} ago</span> : <span className="text-slate-400">—</span>}</td></tr>; })}</tbody></table></div>{orphanCount < orphanComparisons.length ? <div className="border-t border-amber-200 px-5 py-4 text-center"><button type="button" onClick={() => setOrphanCount((count) => count + 10)} className="rounded-lg border border-amber-300 bg-white px-4 py-2 text-sm font-medium text-amber-900 hover:bg-amber-100">Load more</button></div> : null}</section> : null}
    </>
  );
}
