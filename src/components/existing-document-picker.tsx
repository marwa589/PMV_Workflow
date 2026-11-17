"use client";

import { useCallback, useEffect, useState } from "react";
import { callApi } from "@/lib/admin-client";
import { Banner, inputClass, primaryButton, secondaryButton } from "@/components/admin/admin-ui";

type Candidate = { id: string; documentNumber: string; title: string; approvedAt: string | null };

/**
 * Admin picker: search the approved documents already in the system that fit a process step (its type and sub type,
 * and the run's project) and are not used in another process run yet. The caller decides what picking one does.
 *  - projectId undefined = any project (starting a process: the run takes the document's project);
 *  - projectId null = documents without a project; a string = that project.
 */
export default function ExistingDocumentPicker({
  documentTypeId,
  documentSubtypeId,
  projectId,
  includeUsed = false,
  busy = false,
  onPick,
  onCancel,
}: {
  documentTypeId: string;
  documentSubtypeId: string | null;
  projectId?: string | null;
  /** Also list documents that already fill a step of another run (admin corrective runs). */
  includeUsed?: boolean;
  busy?: boolean;
  onPick: (documentId: string, options: { notify: boolean }) => void;
  onCancel: () => void;
}) {
  const [search, setSearch] = useState("");
  const [documents, setDocuments] = useState<Candidate[] | null>(null);
  const [notify, setNotify] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (term: string) => {
      const query = new URLSearchParams({ documentTypeId, approvedOnly: "1" });
      if (!includeUsed) query.set("unlinked", "1");
      if (documentSubtypeId) query.set("documentSubtypeId", documentSubtypeId);
      if (projectId !== undefined) query.set("projectId", projectId ?? "");
      if (term) query.set("search", term);
      const result = await callApi<{ documents: Candidate[] }>(`/api/documents/linkable?${query.toString()}`);
      if (!result.ok) return setError(result.message);
      setError(null);
      setDocuments(result.data.documents);
    },
    [documentTypeId, documentSubtypeId, projectId, includeUsed],
  );

  useEffect(() => {
    void load("");
  }, [load]);

  return (
    <div className="mt-3 rounded-xl border border-slate-200 bg-white p-4">
      {error ? <Banner kind="error">{error}</Banner> : null}

      <div className="flex flex-wrap items-center gap-2">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void load(search.trim());
            }
          }}
          placeholder="Search by document number or title"
          className={`${inputClass} max-w-sm`}
        />
        <button type="button" className={secondaryButton} onClick={() => void load(search.trim())}>Search</button>
        <button type="button" className={secondaryButton} onClick={onCancel}>Close</button>
      </div>

      {documents === null ? <p className="mt-3 text-sm text-slate-500">Loading...</p> : null}
      {documents !== null && documents.length === 0 ? (
        <p className="mt-3 text-sm text-slate-500">No approved documents of this type are available {includeUsed ? "" : "(documents already used in a process run are not listed)."}</p>
      ) : null}

      {documents && documents.length > 0 ? (
        <ul className="mt-3 divide-y divide-slate-100">
          {documents.map((document) => (
            <li key={document.id} className="flex flex-wrap items-center justify-between gap-3 py-2">
              <div className="text-sm">
                <span className="font-medium text-slate-900">{document.documentNumber}</span>
                <span className="text-slate-600"> · {document.title}</span>
                {document.approvedAt ? <span className="text-xs text-slate-500"> · approved {document.approvedAt}</span> : null}
              </div>
              <button type="button" disabled={busy} className={primaryButton} onClick={() => onPick(document.id, { notify })}>Use this document</button>
            </li>
          ))}
        </ul>
      ) : null}

      <label className="mt-3 flex items-start gap-2 text-xs text-slate-600">
        <input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} className="mt-0.5 h-3.5 w-3.5 rounded border-slate-300" />
        <span>Tell the people who may upload the next document of this process</span>
      </label>
    </div>
  );
}
