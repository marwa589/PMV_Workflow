"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ArrowLeft, Loader2, Send } from "lucide-react";
import { getCsrfTokenFromBrowser } from "@/lib/csrf";

type Props = {
  documentId: string;
  documentNumber: string;
  title: string;
  // The reviewer's comment that sent the document back.
  revisionComment?: string | null;
  returnUrl: string;
};

/** The uploader step after "Revision required": upload the corrected file and send it through the flow again. */
export default function DocumentResubmitForm({ documentId, documentNumber, title, revisionComment, returnUrl }: Props) {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [comments, setComments] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!file) {
      setError("Choose the revised file first.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const formData = new FormData();
      formData.set("decision", "RESUBMIT");
      formData.set("comments", comments);
      formData.set("file", file);
      const response = await fetch(`/api/documents/${documentId}/actions`, {
        method: "POST",
        headers: { "x-csrf-token": getCsrfTokenFromBrowser() },
        body: formData,
      });
      const result = (await response.json().catch(() => ({}))) as { message?: string };
      if (!response.ok) throw new Error(result.message || "Unable to resubmit the document.");
      router.push(returnUrl);
      router.refresh();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Unable to resubmit the document.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="min-h-screen bg-slate-100 px-4 py-8 text-slate-900 sm:px-8">
      <div className="mx-auto max-w-2xl space-y-5">
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Revision required</p>
          <h1 className="mt-2 text-2xl font-semibold">{documentNumber}</h1>
          <p className="mt-1 text-sm text-slate-600">{title}</p>
        </div>

        {revisionComment ? (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
            <p className="font-semibold">What needs to change</p>
            <p className="mt-1">{revisionComment}</p>
          </div>
        ) : null}

        <div className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div>
            <label htmlFor="revised-file" className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-600">Revised file</label>
            <input
              id="revised-file"
              type="file"
              accept=".pdf,.doc,.docx,.xls,.xlsx,.jpg,.jpeg,.png"
              onChange={(event) => setFile(event.target.files?.[0] || null)}
              disabled={saving}
              className="w-full rounded-md border border-slate-300 text-sm file:mr-3 file:cursor-pointer file:border-0 file:bg-blue-600 file:px-4 file:py-2 file:font-medium file:text-white hover:file:bg-blue-700"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-600">Comments</label>
            <input value={comments} onChange={(event) => setComments(event.target.value)} placeholder="Comments (optional)" className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
          </div>
          {error ? <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">{error}</div> : null}
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => router.back()} className="inline-flex items-center gap-2 rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium">
              <ArrowLeft className="h-4 w-4" />
              Back
            </button>
            <button type="button" onClick={submit} disabled={saving} className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              Resubmit
            </button>
          </div>
        </div>
      </div>
    </main>
  );
}
