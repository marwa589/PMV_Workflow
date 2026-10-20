"use client";

import { useState } from "react";
import { CheckCircle2, UploadCloud } from "lucide-react";
import { getCsrfTokenFromBrowser } from "@/lib/csrf";

type InvoicePurchaseOrder = {
  id: string;
  poNumber: string;
  relatedMrLabels: string[];
};

type InvoiceCashMr = { id: string; documentNumber: string; title: string };

export default function PurchaseOrderInvoiceUpload({ purchaseOrders, cashMrs = [] }: { purchaseOrders: InvoicePurchaseOrder[]; cashMrs?: InvoiceCashMr[] }) {
  const [targetType, setTargetType] = useState<"PO" | "CASH_MR">("PO");
  const [selectedTargetId, setSelectedTargetId] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function submit() {
    if (!selectedTargetId) {
      setError(targetType === "PO" ? "Select the related purchase order." : "Select the related Cash MR.");
      return;
    }
    if (files.length === 0) {
      setError("Select at least one invoice file.");
      return;
    }

    setSubmitting(true);
    setError(null);
    setMessage(null);
    try {
      const formData = new FormData();
      files.forEach((file) => formData.append("files", file));
      const endpoint = targetType === "PO"
        ? `/api/purchase-orders/${selectedTargetId}/invoices`
        : `/api/documents/${selectedTargetId}/invoices`;
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "x-csrf-token": getCsrfTokenFromBrowser() },
        body: formData,
      });
      const result = (await response.json()) as { message?: string };
      if (!response.ok) throw new Error(result.message || "Unable to upload invoices.");

      setMessage(result.message || "Invoices uploaded.");
      setFiles([]);
      setSelectedTargetId("");
      window.setTimeout(() => window.location.reload(), 800);
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "Unable to upload invoices.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <h2 className="text-lg font-semibold text-slate-900">Upload Invoices</h2>
      <p className="mt-1 text-sm text-slate-600">Attach invoice files to a purchase order or an approved Cash MR.</p>
      <div className="mt-4 inline-flex rounded-lg border border-slate-300 p-1" role="group" aria-label="Invoice target type">
        <button type="button" aria-pressed={targetType === "PO"} onClick={() => { setTargetType("PO"); setSelectedTargetId(""); }} className={`rounded-md px-3 py-1.5 text-sm font-medium ${targetType === "PO" ? "bg-slate-900 text-white" : "text-slate-700 hover:bg-slate-100"}`}>Purchase Order</button>
        <button type="button" aria-pressed={targetType === "CASH_MR"} onClick={() => { setTargetType("CASH_MR"); setSelectedTargetId(""); }} className={`rounded-md px-3 py-1.5 text-sm font-medium ${targetType === "CASH_MR" ? "bg-slate-900 text-white" : "text-slate-700 hover:bg-slate-100"}`}>Cash MR</button>
      </div>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <label className="text-sm font-medium text-slate-700">
          {targetType === "PO" ? "Related purchase order" : "Related Cash MR"}
          <select value={selectedTargetId} onChange={(event) => setSelectedTargetId(event.target.value)} className="mt-1 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 font-normal">
            <option value="">{targetType === "PO" ? "Select a PO" : "Select a Cash MR"}</option>
            {targetType === "PO" ? purchaseOrders.map((purchaseOrder) => (
              <option key={purchaseOrder.id} value={purchaseOrder.id}>{purchaseOrder.poNumber} | {purchaseOrder.relatedMrLabels.join(", ")}</option>
            )) : cashMrs.map((mr) => (
              <option key={mr.id} value={mr.id}>{mr.documentNumber} | {mr.title}</option>
            ))}
          </select>
        </label>
        <label className="text-sm font-medium text-slate-700">
          Invoice files
          <input
            type="file"
            multiple
            accept=".pdf,.docx,.xlsx,.jpg,.jpeg,.png"
            onChange={(event) => setFiles(Array.from(event.target.files ?? []))}
            className="mt-1 block w-full rounded-lg border border-slate-300 bg-white text-sm file:mr-3 file:border-0 file:bg-blue-600 file:px-3 file:py-2 file:font-medium file:text-white"
          />
        </label>
      </div>
      {files.length > 0 ? <p className="mt-2 text-xs text-slate-500">{files.length} file(s) selected</p> : null}
      {error ? <p className="mt-3 text-sm text-rose-700">{error}</p> : null}
      {message ? <p className="mt-3 flex items-center gap-2 text-sm text-emerald-700"><CheckCircle2 className="h-4 w-4" />{message}</p> : null}
      <button type="button" onClick={() => void submit()} disabled={submitting || (targetType === "PO" ? purchaseOrders.length === 0 : cashMrs.length === 0)} className="mt-4 inline-flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
        <UploadCloud className="h-4 w-4" />
        {submitting ? "Uploading..." : "Upload invoices"}
      </button>
      {targetType === "PO" && purchaseOrders.length === 0 ? <p className="mt-3 text-sm text-slate-500">No Kuwait purchase orders are available for invoice upload.</p> : null}
      {targetType === "CASH_MR" && cashMrs.length === 0 ? <p className="mt-3 text-sm text-slate-500">No approved Kuwait Cash MRs are available for invoice upload.</p> : null}
    </section>
  );
}