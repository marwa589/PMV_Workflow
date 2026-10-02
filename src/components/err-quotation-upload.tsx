"use client";

import { useState } from "react";
import { getCsrfTokenFromBrowser } from "@/lib/csrf";

export default function ErrQuotationUpload({ errId }: { errId: string }) {
  const [files, setFiles] = useState<File[]>([]);
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (files.length === 0) return;
    setBusy(true);
    setMessage(null);
    const formData = new FormData();
    files.forEach((file) => formData.append("quotations", file));
    try {
      const response = await fetch(`/api/errs/${errId}/quotations`, {
        method: "POST",
        headers: { "x-csrf-token": getCsrfTokenFromBrowser() },
        body: formData,
      });
      const result = (await response.json()) as { message?: string };
      if (!response.ok) throw new Error(result.message || "Unable to attach quotations.");
      setMessage(result.message || "Quotations attached.");
      setFiles([]);
      setOpen(false);
      window.location.reload();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to attach quotations.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="inline-flex rounded-lg border border-cyan-300 bg-cyan-50 px-3 py-2 text-sm font-medium text-cyan-800 hover:bg-cyan-100">Attach Quotation</button>
      {open ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
          <section className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-xl">
            <div className="flex items-start justify-between gap-4">
              <div><h2 className="text-lg font-semibold text-slate-900">Attach quotations</h2><p className="mt-1 text-sm text-slate-500">Select one or more quotation files.</p></div>
              <button type="button" onClick={() => setOpen(false)} className="text-xl text-slate-500" aria-label="Close">×</button>
            </div>
            <label className="mt-5 flex cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed border-cyan-300 bg-cyan-50/50 px-4 py-6 text-center hover:bg-cyan-50">
              <span className="text-sm font-medium text-slate-700">Choose quotation files</span>
              <span className="mt-1 text-xs text-slate-500">PDF, Word, Excel, JPG, JPEG, or PNG</span>
              <input type="file" multiple accept=".pdf,.doc,.docx,.xls,.xlsx,.jpg,.jpeg,.png" onChange={(event) => setFiles(Array.from(event.target.files ?? []))} disabled={busy} className="sr-only" />
            </label>
            {files.length > 0 ? <ul className="mt-3 max-h-28 space-y-1 overflow-y-auto rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">{files.map((file) => <li key={`${file.name}-${file.size}-${file.lastModified}`} className="truncate" title={file.name}>{file.name}</li>)}</ul> : null}
            <div className="mt-5 flex justify-end gap-2"><button type="button" onClick={() => setOpen(false)} className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700">Cancel</button><button type="button" onClick={() => void submit()} disabled={busy || files.length === 0} className="rounded-lg bg-cyan-700 px-3 py-2 text-sm font-medium text-white disabled:opacity-50">{busy ? "Attaching..." : "Attach quotation"}</button></div>
            {message ? <p className="mt-3 text-sm text-slate-600">{message}</p> : null}
          </section>
        </div>
      ) : null}
    </>
  );
}
