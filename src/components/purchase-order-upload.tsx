"use client";

import { useRef, useState } from "react";
import { CheckCircle2, Trash2, UploadCloud } from "lucide-react";
import { getCsrfTokenFromBrowser } from "@/lib/csrf";

type ApprovedMr = { id: string; documentNumber: string; title: string; mrNumber: string | null; fileName?: string | null };

type Props = {
  approvedMrs: ApprovedMr[];
  initialMrId?: string;
  showMrSelection?: boolean;
};

type SelectedFile = { file: File; mrId: string };

export default function PurchaseOrderUpload({ approvedMrs, initialMrId, showMrSelection = true }: Props) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [files, setFiles] = useState<SelectedFile[]>([]);
  const [description, setDescription] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [mrSearch, setMrSearch] = useState<Record<number, string>>({});
  const [openMrSearch, setOpenMrSearch] = useState<number | null>(null);

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

  function matchingMrs(index: number) {
    const search = (mrSearch[index] || "").trim().toLowerCase();
    if (!search) return approvedMrs;
    return approvedMrs.filter((mr) => [mr.documentNumber, mr.mrNumber, mr.title, mr.fileName]
      .filter(Boolean)
      .some((value) => value!.toLowerCase().includes(search)));
  }

  return (
    <div>
      <button type="button" onClick={() => setOpen(true)} className="inline-flex items-center gap-2 rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-800 hover:bg-emerald-100">
        <UploadCloud className="h-4 w-4" />
        Upload PO
      </button>
      {open ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
          <section className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white p-6 shadow-xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-lg font-semibold text-slate-900">Upload Purchase Order</h2>
                <p className="mt-1 text-sm text-slate-600">Each selected file creates one PO record.</p>
              </div>
              <button type="button" onClick={() => setOpen(false)} className="text-xl text-slate-500" aria-label="Close">×</button>
            </div>
            <div className="
  mt-4 block w-full rounded-lg border border-slate-300 text-sm
  file:bg-blue-600
  file:text-white
  file:border-0
  file:px-4
  file:py-2
  file:mr-3
  file:font-medium
  file:cursor-pointer
  hover:file:bg-blue-700
">Document Type: Purchase Order (PO)</div>
            <label className="mt-4 block text-sm font-medium text-slate-700">Description<input value={description} onChange={(event) => setDescription(event.target.value)} placeholder="PO description" className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-normal" /></label>
            <input ref={inputRef} type="file" multiple accept=".pdf,.doc,.docx,.xls,.xlsx,.jpg,.jpeg,.png" onChange={(event) => { const selected = Array.from(event.target.files || []); setFiles(selected.map((file) => ({ file, mrId: initialMrId || "" }))); }} className="
14
mt-4 block w-full rounded-lg border border-slate-300 text-sm
15
file:bg-blue-600
16
file:text-white
17
file:border-0
18
file:px-4
19
file:py-2
20
file:mr-3
21
file:font-medium
22
file:cursor-pointer
23
hover:file:bg-blue-700
24
" />
            {files.length > 0 ? <div className="mt-3 space-y-2">{files.map((item, index) => <div key={`${item.file.name}-${index}`} className="grid min-w-0 grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] items-center gap-3 rounded-lg border border-slate-200 p-3"><span className="min-w-0 truncate text-sm text-slate-700" title={item.file.name}>{item.file.name}</span><div className="relative min-w-0"><input value={mrSearch[index] || ""} onFocus={() => setOpenMrSearch(index)} onChange={(event) => { setOpenMrSearch(index); setMrSearch((current) => ({ ...current, [index]: event.target.value })); }} disabled={!showMrSelection} placeholder="Search document or filename" className="w-full rounded-lg border border-slate-300 px-2 py-2 text-sm" />{showMrSelection && openMrSearch === index ? <div className="absolute left-0 right-0 top-full z-20 max-h-56 overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-lg">{matchingMrs(index).map((mr) => <button key={mr.id} type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => { setFiles((current) => current.map((value, valueIndex) => valueIndex === index ? { ...value, mrId: mr.id } : value)); setMrSearch((current) => ({ ...current, [index]: `${mr.documentNumber} - ${mr.fileName || ""}` })); setOpenMrSearch(null); }} className={`block w-full px-3 py-2 text-left text-sm hover:bg-slate-50 ${item.mrId === mr.id ? "bg-cyan-50 text-cyan-900" : "text-slate-700"}`}>{mr.documentNumber} - {mr.fileName || "Filename unavailable"}</button>)}{matchingMrs(index).length === 0 ? <p className="px-3 py-2 text-sm text-slate-500">No matching approved MR.</p> : null}</div> : null}</div><button type="button" onClick={() => setFiles((current) => current.filter((_, valueIndex) => valueIndex !== index))} disabled={submitting} className="inline-flex items-center justify-center rounded-lg p-2 text-rose-700 hover:bg-rose-50 disabled:opacity-50" aria-label={`Remove ${item.file.name}`} title="Remove file"><Trash2 className="h-4 w-4" /></button></div>)}</div> : null}
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
