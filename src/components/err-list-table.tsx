"use client";

import { useState } from "react";
import Link from "next/link";
import { getCsrfTokenFromBrowser } from "@/lib/csrf";
import StatusBadge from "@/components/status-badge";

type ErrRow = { id: string; documentNumber: string; title: string; type: string; status: string; currentApproverId: string | null; projectDirector: { name: string }; currentApprover: { name: string } | null; createdAt: string };

export default function ErrListTable({ errs, userId, canDelete, canRequestDeletion }: { errs: ErrRow[]; userId: string; canDelete: boolean; canRequestDeletion: boolean }) {
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [visibleCount, setVisibleCount] = useState(10);
  const selectedAll = errs.length > 0 && selectedIds.length === errs.length;
  const visibleErrs = errs.slice(0, visibleCount);

  function toggle(id: string) {
    setSelectedIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  }

  function downloadSelected() {
    const params = new URLSearchParams();
    selectedIds.forEach((id) => params.append("ids", id));
    window.open(`/api/errs/bulk-download?${params.toString()}`, "_blank", "noopener,noreferrer");
  }

  async function runAction(action: "delete" | "request-delete") {
    if (selectedIds.length === 0) return;
    if (action === "delete" && !window.confirm(`Permanently delete ${selectedIds.length} ERR(s)?`)) return;
    if (action === "request-delete" && !window.confirm(`Request deletion for ${selectedIds.length} ERR(s)?`)) return;
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch("/api/errs/bulk-actions", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-csrf-token": getCsrfTokenFromBrowser() },
        body: JSON.stringify({ action, ids: selectedIds }),
      });
      const result = await response.json() as { message?: string };
      if (!response.ok) throw new Error(result.message || "Unable to complete the action.");
      setMessage(result.message || "Action completed.");
      setSelectedIds([]);
      if (action === "delete") window.location.reload();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to complete the action.");
    } finally {
      setBusy(false);
    }
  }

  return <>
    <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 bg-slate-50 px-5 py-3">
      <button type="button" onClick={() => setSelectedIds(errs.map((err) => err.id))} className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100">Select all</button>
      <button type="button" onClick={() => setSelectedIds([])} className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100">Clear</button>
      <button type="button" onClick={downloadSelected} disabled={selectedIds.length === 0} className="rounded-lg bg-slate-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50">Download selected</button>
      {canDelete ? <button type="button" onClick={() => void runAction("delete")} disabled={busy || selectedIds.length === 0} className="rounded-lg border border-rose-300 bg-rose-50 px-3 py-1.5 text-sm font-medium text-rose-700 disabled:opacity-50">Delete permanently</button> : null}
      {canRequestDeletion ? <button type="button" onClick={() => void runAction("request-delete")} disabled={busy || selectedIds.length === 0} className="rounded-lg border border-rose-300 bg-rose-50 px-3 py-1.5 text-sm font-medium text-rose-700 disabled:opacity-50">Request deletion</button> : null}
      {message ? <span className="text-sm text-slate-600">{message}</span> : null}
    </div>
    <div className="overflow-x-auto"><table className="min-w-full text-left text-sm"><thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500"><tr><th className="px-3 py-3"><input type="checkbox" checked={selectedAll} onChange={() => setSelectedIds(selectedAll ? [] : errs.map((err) => err.id))} /></th><th className="px-5 py-3 font-semibold">ERR</th><th className="px-5 py-3 font-semibold">Title</th><th className="px-5 py-3 font-semibold">Type</th><th className="px-5 py-3 font-semibold">Status</th><th className="px-5 py-3 font-semibold">Project Director</th><th className="px-5 py-3 font-semibold">Assigned To</th><th className="px-5 py-3 font-semibold">Created</th><th className="px-5 py-3 font-semibold">Actions</th></tr></thead><tbody>{errs.length === 0 ? <tr><td colSpan={9} className="px-5 py-10 text-center text-slate-500">No ERRs found for this view.</td></tr> : visibleErrs.map((err) => <tr key={err.id} className="border-t border-slate-100 hover:bg-slate-50/50"><td className="px-3 py-4"><input type="checkbox" checked={selectedIds.includes(err.id)} onChange={() => toggle(err.id)} /></td><td className="px-5 py-4 font-medium text-slate-900"><Link href={`/errs/${err.id}`} className="text-slate-900 hover:text-indigo-600 hover:underline">{err.documentNumber}</Link></td><td className="px-5 py-4 text-slate-700"><Link href={`/errs/${err.id}`} className="text-slate-800 hover:text-indigo-600 hover:underline">{err.title}</Link></td><td className="px-5 py-4 text-slate-700">{err.type}</td><td className="px-5 py-4"><StatusBadge status={err.status} /></td><td className="px-5 py-4 text-slate-700">{err.projectDirector.name}</td><td className="px-5 py-4 text-slate-700">{err.currentApprover?.name ?? "—"}</td><td className="px-5 py-4 text-slate-500">{new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeZone: "Asia/Riyadh" }).format(new Date(err.createdAt))}</td><td className="px-5 py-4"><div className="flex gap-2"><a href={`/api/errs/${err.id}/download?kind=ERR_PDF`} download className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50">Download</a>{err.currentApproverId === userId && (err.status === "PENDING" || err.status === "ON_HOLD") ? <Link href={`/errs/${err.id}/review`} className="rounded-lg bg-slate-900 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-slate-700">Review</Link> : null}</div></td></tr>)}</tbody></table></div>
    {visibleCount < errs.length ? <div className="border-t border-slate-200 px-5 py-4 text-center"><button type="button" onClick={() => setVisibleCount((count) => count + 10)} className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">Load more</button></div> : null}
  </>;
}
