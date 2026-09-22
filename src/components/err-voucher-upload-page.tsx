"use client";

import { useState } from "react";
import { FilePlus2, Loader2, Plus, Trash2, UploadCloud } from "lucide-react";
import { getCsrfTokenFromBrowser } from "@/lib/csrf";

type ApprovedErr = {
  id: string;
  documentNumber: string;
  title: string;
  projectName: string;
  type: string;
  releaseVoucherCount: number;
  receiptVoucherCount: number;
};

type VoucherRow = {
  id: string;
  errId: string;
  voucherType: "RELEASE_VOUCHER" | "RECEIPT_VOUCHER";
  file: File | null;
  comments: string;
};

function newRow(): VoucherRow {
  return {
    id: `${Date.now()}-${Math.random()}`,
    errId: "",
    voucherType: "RELEASE_VOUCHER",
    file: null,
    comments: "",
  };
}

export default function ErrVoucherUploadPage({ approvedErrs }: { approvedErrs: ApprovedErr[] }) {
  const [rows, setRows] = useState<VoucherRow[]>([newRow()]);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function updateRow(id: string, update: Partial<VoucherRow>) {
    setRows((current) => current.map((row) => (row.id === id ? { ...row, ...update } : row)));
  }

  function removeRow(id: string) {
    setRows((current) => current.length === 1 ? current : current.filter((row) => row.id !== id));
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setMessage(null);

    const invalid = rows.find((row) => !row.errId || !row.file);
    if (invalid) {
      setError("Choose an approved ERR and PDF file for every voucher row.");
      return;
    }

    setSubmitting(true);
    let uploaded = 0;
    try {
      for (const row of rows) {
        const formData = new FormData();
        formData.set("voucherType", row.voucherType);
        formData.set("file", row.file as File);
        if (row.comments.trim()) formData.set("comments", row.comments.trim());

        const response = await fetch(`/api/errs/${row.errId}/vouchers`, {
          method: "POST",
          headers: { "x-csrf-token": getCsrfTokenFromBrowser() },
          body: formData,
        });
        const result = (await response.json()) as { message?: string };
        if (!response.ok) throw new Error(result.message || "Unable to upload voucher.");
        uploaded += 1;
      }

      setMessage(`${uploaded} voucher${uploaded === 1 ? "" : "s"} uploaded successfully.`);
      setRows([newRow()]);
    } catch (uploadError) {
      setError(uploadError instanceof Error ? `${uploaded} uploaded. ${uploadError.message}` : "Unable to upload vouchers.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-6">
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Approved ERRs</p>
            <h2 className="mt-2 text-2xl font-semibold text-slate-900">Attach vouchers</h2>
            <p className="mt-2 text-sm text-slate-600">Add multiple release or receipt vouchers and choose the related approved ERR for each file.</p>
          </div>
          <UploadCloud className="h-6 w-6 text-cyan-700" />
        </div>

        {approvedErrs.length === 0 ? (
          <p className="mt-6 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">No approved rental ERRs are available for voucher upload.</p>
        ) : (
          <div className="mt-6 space-y-4">
            {rows.map((row, index) => (
              <div key={row.id} className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-semibold text-slate-900">Voucher {index + 1}</p>
                  <button type="button" onClick={() => removeRow(row.id)} disabled={rows.length === 1 || submitting} className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-rose-700 hover:bg-rose-50 disabled:opacity-40">
                    <Trash2 className="h-3.5 w-3.5" /> Remove
                  </button>
                </div>
                <div className="mt-4 grid gap-4 md:grid-cols-[1.2fr,0.8fr]">
                  <label className="block text-sm font-medium text-slate-700">Approved ERR
                    <select value={row.errId} onChange={(event) => updateRow(row.id, { errId: event.target.value })} disabled={submitting} className="mt-2 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm font-normal text-slate-900">
                      <option value="">Select an approved ERR</option>
                      {approvedErrs.map((err) => <option key={err.id} value={err.id}>{err.documentNumber} - {err.title} ({err.projectName})</option>)}
                    </select>
                  </label>
                  <label className="block text-sm font-medium text-slate-700">Voucher type
                    <select value={row.voucherType} onChange={(event) => updateRow(row.id, { voucherType: event.target.value as VoucherRow["voucherType"] })} disabled={submitting} className="mt-2 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm font-normal text-slate-900">
                      <option value="RELEASE_VOUCHER">Release voucher</option>
                      <option value="RECEIPT_VOUCHER">Receipt voucher</option>
                    </select>
                  </label>
                </div>
                <div className="mt-4 grid gap-4 md:grid-cols-[1fr,1.2fr]">
                  <label className="block text-sm font-medium text-slate-700">Voucher PDF
                    <input type="file" accept="application/pdf,.pdf" onChange={(event) => updateRow(row.id, { file: event.target.files?.[0] || null })} disabled={submitting} className="mt-2 block w-full rounded-lg border border-slate-300 bg-white text-sm font-normal text-slate-700 file:mr-3 file:cursor-pointer file:border-0 file:bg-blue-600 file:px-3 file:py-2 file:text-sm file:font-semibold file:text-white hover:file:bg-blue-700" />
                    {row.file ? <button type="button" onClick={() => updateRow(row.id, { file: null })} disabled={submitting} className="mt-2 inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-rose-700 hover:bg-rose-50 disabled:opacity-50">Remove selected file</button> : null}
                  </label>
                  <label className="block text-sm font-medium text-slate-700">Comments <span className="font-normal text-slate-500">(optional)</span>
                    <input type="text" value={row.comments} onChange={(event) => updateRow(row.id, { comments: event.target.value })} disabled={submitting} className="mt-2 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm font-normal text-slate-900" placeholder="Add a note" />
                  </label>
                </div>
              </div>
            ))}
            <button type="button" onClick={() => setRows((current) => [...current, newRow()])} disabled={submitting} className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50">
              <Plus className="h-4 w-4" /> Add another voucher
            </button>
          </div>
        )}

        {error ? <p className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</p> : null}
        {message ? <p className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{message}</p> : null}
        {approvedErrs.length > 0 ? <button type="submit" disabled={submitting} className="mt-5 inline-flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-700 disabled:opacity-50">
          {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <FilePlus2 className="h-4 w-4" />}
          {submitting ? "Uploading..." : "Upload vouchers"}
        </button> : null}
      </section>
    </form>
  );
}
