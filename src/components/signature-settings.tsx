"use client";

import { useRef, useState } from "react";
import { CheckCircle2, ImagePlus, Loader2, Trash2 } from "lucide-react";
import { getCsrfTokenFromBrowser } from "@/lib/csrf";

export default function SignatureSettings({ hasSignature, signatureName }: { hasSignature: boolean; signatureName: string | null }) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState(hasSignature ? "/api/auth/signature" : null);
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function selectFile(file: File | null) {
    if (!file) return;
    if (previewUrl?.startsWith("blob:")) URL.revokeObjectURL(previewUrl);
    setSelectedFile(file);
    setPreviewUrl(URL.createObjectURL(file));
    setMessage(null);
    setError(null);
  }

  async function saveSignature() {
    if (!selectedFile) return;
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const formData = new FormData();
      formData.set("signature", selectedFile);
      const response = await fetch("/api/auth/signature", {
        method: "POST",
        headers: { "x-csrf-token": getCsrfTokenFromBrowser() },
        body: formData,
      });
      const result = (await response.json()) as { message?: string };
      if (!response.ok) throw new Error(result.message || "Unable to save signature.");
      setSelectedFile(null);
      setPreviewUrl(`/api/auth/signature?updated=${Date.now()}`);
      setMessage("Signature saved.");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Unable to save signature.");
    } finally {
      setSaving(false);
    }
  }

  async function removeSignature() {
    if (!window.confirm("Remove your saved signature?")) return;
    setRemoving(true);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch("/api/auth/signature", {
        method: "DELETE",
        headers: { "x-csrf-token": getCsrfTokenFromBrowser() },
      });
      const result = (await response.json()) as { message?: string };
      if (!response.ok) throw new Error(result.message || "Unable to remove signature.");
      setSelectedFile(null);
      setPreviewUrl(null);
      setMessage("Signature removed.");
    } catch (removeError) {
      setError(removeError instanceof Error ? removeError.message : "Unable to remove signature.");
    } finally {
      setRemoving(false);
    }
  }

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Account Settings</p>
          <h2 className="mt-2 text-2xl font-semibold text-slate-900">Signature</h2>
          <p className="mt-2 text-sm text-slate-600">Save the signature used when approving documents. You can replace or remove it at any time.</p>
        </div>
        <ImagePlus className="h-6 w-6 text-cyan-700" />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr,1.2fr]">
        <div className="flex min-h-44 items-center justify-center rounded-xl border border-dashed border-slate-300 bg-slate-50 p-6">
          {previewUrl ? <img src={previewUrl} alt="Current signature preview" className="max-h-36 max-w-full object-contain" /> : <p className="text-sm text-slate-500">No signature saved.</p>}
        </div>
        <div className="space-y-4">
          <p className="text-sm text-slate-600">{selectedFile?.name || signatureName || "Choose a signature image."}</p>
          <input ref={inputRef} type="file" accept="image/*" className="block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm" onChange={(event) => selectFile(event.target.files?.[0] || null)} />
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={saveSignature} disabled={!selectedFile || saving} className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-700 disabled:opacity-50">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
              {hasSignature ? "Replace Signature" : "Save Signature"}
            </button>
            <button type="button" onClick={removeSignature} disabled={!previewUrl || removing} className="inline-flex items-center gap-2 rounded-lg border border-rose-200 px-4 py-2.5 text-sm font-semibold text-rose-700 hover:bg-rose-50 disabled:opacity-50">
              {removing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
              Remove
            </button>
          </div>
          {message ? <p className="text-sm text-emerald-700">{message}</p> : null}
          {error ? <p className="text-sm text-rose-700">{error}</p> : null}
        </div>
      </div>
    </section>
  );
}
