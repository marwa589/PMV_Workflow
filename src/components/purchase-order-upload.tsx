"use client";

import { useRef, useState } from "react";
import { CheckCircle2, UploadCloud } from "lucide-react";
import { getCsrfTokenFromBrowser } from "@/lib/csrf";

type ApprovedMr = { id: string; documentNumber: string; title: string; mrNumber: string | null };

type Props = {
  approvedMrs: ApprovedMr[];
  initialMrId?: string;
  showMrSelection?: boolean;
};

type SelectedFile = { file: File; mrId: string };

export default function PurchaseOrderUpload({ approvedMrs, initialMrId, showMrSelection = true }: Props) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [selectedMrIds, setSelectedMrIds] = useState<string[]>(initialMrId ? [initialMrId] : []);
  const [files, setFiles] = useState<SelectedFile[]>([]);
  const [description, setDescription] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  function toggleMr(id: string) {
    setSelectedMrIds((current) => current.includes(id) ? current.filter((value) => value !== id) : [...current, id]);
  }

  async function submit() {
    if (files.length === 0 || files.some((item) => !item.mrId)) {
      setError("Select a related approved MR for every PO file.");
      return;
    }

    setSubmitting(true);
    setError(null);
    setMessage(null);
    try {
      const formData = new FormData();
      formData.set("description", description);
      formData.set("fileMrIds", JSON.stringify(files.map((item) => item.mrId)));
      files.forEach((item) => formData.append("files", item.file));
      const response = await fetch("/api/purchase-orders", {
        method: "POST",
        headers: { "x-csrf-token": getCsrfTokenFromBrowser() },
        body: formData,
      });
      const result = (await response.json()) as { message?: string };
      if (!response.ok) throw new Error(result.message || "Unable to upload PO.");
      setMessage(result.message || "PO created.");
      setFiles([]);
      setDescription("");
      if (inputRef.current) inputRef.current.value = "";
      window.setTimeout(() => window.location.reload(), 700);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Unable to upload PO.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div>
      <button type="button" onClick={() => setOpen(true)} className="inline-flex items-center gap-2 rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-800 hover:bg-emerald-100">
        <UploadCloud className="h-4 w-4" />
        Upload PO
      </button>
      {open ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
          <section className="w-full max-w-2xl rounded-2xl bg-white p-6 shadow-xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-lg font-semibold text-slate-900">Upload Purchase Order</h2>
                <p className="mt-1 text-sm text-slate-600">Each selected file creates one PO record.</p>
              </div>
              <button type="button" onClick={() => setOpen(false)} className="text-xl text-slate-500" aria-label="Close">×</button>
            </div>
            <div className="mt-5 rounded-lg border border-cyan-200 bg-cyan-50 px-3 py-2 text-sm font-medium text-cyan-800">Document Type: Purchase Order (PO)</div>
            <label className="mt-4 block text-sm font-medium text-slate-700">Description<input value={description} onChange={(event) => setDescription(event.target.value)} placeholder="PO description" className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-normal" /></label>
            <input ref={inputRef} type="file" multiple accept=".pdf,.doc,.docx,.xls,.xlsx,.jpg,.jpeg,.png" onChange={(event) => { const selected = Array.from(event.target.files || []); const fallbackMr = initialMrId || selectedMrIds[0] || ""; setFiles(selected.map((file) => ({ file, mrId: fallbackMr }))); }} className="mt-4 block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
            {files.length > 0 ? <div className="mt-3 space-y-2">{files.map((item, index) => <div key={`${item.file.name}-${index}`} className="grid gap-2 rounded-lg border border-slate-200 p-3 sm:grid-cols-[1fr,1fr]"><span className="self-center text-sm text-slate-700">{item.file.name}</span><select value={item.mrId} onChange={(event) => setFiles((current) => current.map((value, valueIndex) => valueIndex === index ? { ...value, mrId: event.target.value } : value))} disabled={!showMrSelection} className="rounded-lg border border-slate-300 px-2 py-2 text-sm"><option value="">Select related approved MR</option>{approvedMrs.map((mr) => <option key={mr.id} value={mr.id}>{mr.documentNumber}{mr.mrNumber ? ` (${mr.mrNumber})` : ""} - {mr.title}</option>)}</select></div>)}</div> : null}
            {error ? <p className="mt-3 text-sm text-rose-700">{error}</p> : null}
            {message ? <p className="mt-3 flex items-center gap-2 text-sm text-emerald-700"><CheckCircle2 className="h-4 w-4" />{message}</p> : null}
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" onClick={() => setOpen(false)} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700">Cancel</button>
              <button type="button" onClick={submit} disabled={submitting} className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">{submitting ? "Uploading..." : "Upload PO"}</button>
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}
