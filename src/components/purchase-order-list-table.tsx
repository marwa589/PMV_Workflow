"use client";

import { useState } from "react";
import { getCsrfTokenFromBrowser } from "@/lib/csrf";

type PurchaseOrderRow = {
  id: string;
  poNumber: string;
  originalName: string;
  description: string | null;
  uploadedAt: string;
  uploadedByName: string;
};

export default function PurchaseOrderListTable({
  purchaseOrders,
  canAdminDelete,
  canRequestDeletion,
}: {
  purchaseOrders: PurchaseOrderRow[];
  canAdminDelete: boolean;
  canRequestDeletion: boolean;
}) {
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const allSelected = purchaseOrders.length > 0 && selectedIds.length === purchaseOrders.length;

  function toggle(id: string) {
    setSelectedIds((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id],
    );
  }

  function downloadSelected() {
    if (selectedIds.length === 0) return;
    const params = new URLSearchParams();
    selectedIds.forEach((id) => params.append("ids", id));
    window.open(`/api/purchase-orders/bulk-download?${params.toString()}`, "_blank", "noopener,noreferrer");
  }

  async function runAction(action: "delete" | "request-delete") {
    if (selectedIds.length === 0) return;
    if (action === "delete" && !window.confirm(`Permanently delete ${selectedIds.length} PO(s)?`)) return;
    if (action === "request-delete" && !window.confirm(`Request deletion for ${selectedIds.length} PO(s)?`)) return;

    setBusy(true);
    setMessage(null);

    try {
      const response = await fetch("/api/purchase-orders/bulk-actions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-csrf-token": getCsrfTokenFromBrowser(),
        },
        body: JSON.stringify({ action, ids: selectedIds }),
      });

      const result = (await response.json()) as { message?: string };
      if (!response.ok) throw new Error(result.message || "Unable to complete the PO action.");

      setMessage(result.message || "Action completed.");
      setSelectedIds([]);
      window.location.reload();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to complete the PO action.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 bg-slate-50 px-5 py-3">
        <button
          type="button"
          onClick={() => setSelectedIds(purchaseOrders.map((po) => po.id))}
          className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100"
        >
          Select all
        </button>
        <button
          type="button"
          onClick={() => setSelectedIds([])}
          className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100"
        >
          Clear
        </button>
        <button
          type="button"
          onClick={downloadSelected}
          disabled={selectedIds.length === 0}
          className="rounded-lg bg-slate-900 px-3 py-1.5 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
        >
          Download selected
        </button>
        {canRequestDeletion ? (
          <button
            type="button"
            onClick={() => void runAction("request-delete")}
            disabled={busy || selectedIds.length === 0}
            className="rounded-lg border border-rose-300 bg-rose-50 px-3 py-1.5 text-sm font-medium text-rose-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Request deletion
          </button>
        ) : null}
        {canAdminDelete ? (
          <button
            type="button"
            onClick={() => void runAction("delete")}
            disabled={busy || selectedIds.length === 0}
            className="rounded-lg border border-rose-300 bg-rose-50 px-3 py-1.5 text-sm font-medium text-rose-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Delete permanently
          </button>
        ) : null}
        {message ? <span className="text-sm text-slate-600">{message}</span> : null}
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-full text-left text-sm">
          <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-3 py-3 font-semibold">
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={() => setSelectedIds(allSelected ? [] : purchaseOrders.map((po) => po.id))}
                  className="h-4 w-4 rounded border-slate-300"
                />
              </th>
              <th className="px-5 py-3 font-semibold">PO Number</th>
              <th className="px-5 py-3 font-semibold">Filename</th>
              <th className="px-5 py-3 font-semibold">Description</th>
              <th className="px-5 py-3 font-semibold">Uploaded</th>
              <th className="px-5 py-3 font-semibold">Uploaded By</th>
              <th className="px-5 py-3 font-semibold">Linked MRs</th>
              <th className="px-5 py-3 font-semibold">Actions</th>
            </tr>
          </thead>
          <tbody>
            {purchaseOrders.map((po) => (
              <tr key={po.id} className="border-t border-slate-100">
                <td className="px-3 py-4">
                  <input
                    type="checkbox"
                    checked={selectedIds.includes(po.id)}
                    onChange={() => toggle(po.id)}
                    className="h-4 w-4 rounded border-slate-300"
                  />
                </td>
                <td className="px-5 py-4">
                  <a href={`/purchase-orders/${po.id}`} className="font-medium text-cyan-700 hover:underline">
                    {po.poNumber}
                  </a>
                </td>
                <td className="px-5 py-4 text-slate-700">{po.originalName}</td>
                <td className="px-5 py-4 text-slate-600">{po.description || "—"}</td>
                <td className="px-5 py-4 text-slate-600">
                  {new Intl.DateTimeFormat("en-US", { dateStyle: "medium" }).format(new Date(po.uploadedAt))}
                </td>
                <td className="px-5 py-4 text-slate-600">{po.uploadedByName}</td>
                <td className="px-5 py-4 text-slate-600">—</td>
                <td className="px-5 py-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <a href={`/api/purchase-orders/${po.id}/download?inline=1`} target="_blank" rel="noopener noreferrer" className="font-medium text-cyan-700 hover:underline">
                      Open File
                    </a>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
