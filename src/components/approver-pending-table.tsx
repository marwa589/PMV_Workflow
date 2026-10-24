"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import { useState } from "react";
import { BULK_APPROVE_MAX } from "@/lib/bulk-approve-config";

export type PendingDocument = {
  id: string;
  documentNumber: string;
  title: string;
  projectLabel?: string | null;
  // Where it is waiting, e.g. "Pending PMV Engineer" (the level's name comes from the flow).
  statusLabel?: string | null;
  currentVersion: number;
  uploadedAt: string;
  latestComment?: string | null;
  // Only documents waiting for approval can be reviewed together (not ones on hold or sent back for revision).
  batchEligible?: boolean;
};

type Props = {
  documents: PendingDocument[];
  // Approvers get a Review button; admins only view (they act only where a flow names them).
  allowReview?: boolean;
  emptyMessage?: string;
  // Shows tick boxes and "Review selected" for users who may approve several documents at once.
  allowBatch?: boolean;
};

export default function ApproverPendingTable({ documents, allowReview = true, allowBatch = false, emptyMessage = "No pending approvals assigned to you." }: Props) {
  const router = useRouter();
  const [visibleCount, setVisibleCount] = useState(10);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  if (documents.length === 0) {
    return <div className="px-5 py-6 text-sm text-slate-500">{emptyMessage}</div>;
  }

  const showBatch = allowBatch && allowReview;
  const selectableIds = documents.slice(0, visibleCount).filter((document) => document.batchEligible !== false).map((document) => document.id).slice(0, BULK_APPROVE_MAX);
  const allSelected = selectableIds.length > 0 && selectableIds.every((id) => selectedIds.includes(id));

  function toggleOne(id: string) {
    setSelectedIds((current) => (current.includes(id) ? current.filter((value) => value !== id) : current.length >= BULK_APPROVE_MAX ? current : [...current, id]));
  }

  function reviewSelected() {
    if (selectedIds.length === 0) return;
    router.push(`/approver/review-batch?ids=${selectedIds.join(",")}`);
  }

  return (
    <div className="overflow-x-auto">
      {showBatch ? (
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-5 py-3">
          <p className="text-sm text-slate-600">{selectedIds.length === 0 ? `Tick documents to review and approve them together (up to ${BULK_APPROVE_MAX}).` : `${selectedIds.length} selected`}</p>
          <button type="button" onClick={reviewSelected} disabled={selectedIds.length === 0} className="rounded-lg bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50">Review selected</button>
        </div>
      ) : null}
      <table className="min-w-full text-left text-sm">
        <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
          <tr>
            {showBatch ? <th className="px-3 py-3 font-semibold"><input type="checkbox" aria-label="Select all shown" checked={allSelected} onChange={() => setSelectedIds(allSelected ? [] : selectableIds)} className="h-4 w-4 rounded border-slate-300" /></th> : null}
            <th className="px-5 py-3 font-semibold">Document Number</th>
            <th className="px-5 py-3 font-semibold">Title</th>
            <th className="px-5 py-3 font-semibold">Project</th>
            <th className="px-5 py-3 font-semibold">Waiting At</th>
            <th className="px-5 py-3 font-semibold">Current Version</th>
            <th className="px-5 py-3 font-semibold">Date</th>
            <th className="px-5 py-3 font-semibold">Actions</th>
          </tr>
        </thead>
        <tbody>
          {documents.slice(0, visibleCount).map((document) => {
            const detailUrl = `/documents/${document.id}`;

            return (
              <tr key={document.id} className="border-t border-slate-100 hover:bg-slate-50/50">
                {showBatch ? (
                  <td className="px-3 py-4">
                    {document.batchEligible === false ? null : <input type="checkbox" aria-label={`Select ${document.documentNumber}`} checked={selectedIds.includes(document.id)} onChange={() => toggleOne(document.id)} className="h-4 w-4 rounded border-slate-300" />}
                  </td>
                ) : null}
                <td className="px-5 py-4 font-medium text-slate-900">
                  <Link href={detailUrl} className="hover:text-indigo-600 hover:underline">
                    {document.documentNumber}
                  </Link>
                </td>
                <td className="px-5 py-4 text-slate-700">
                  <Link href={detailUrl} className="text-slate-800 hover:text-indigo-600 hover:underline">
                    {document.title}
                  </Link>
                  {document.latestComment ? <div className="mt-1 text-xs text-slate-500">{document.latestComment}</div> : null}
                </td>
                <td className="px-5 py-4 text-slate-700">{document.projectLabel || "—"}</td>
                <td className="px-5 py-4 text-slate-700">{document.statusLabel || "Pending"}</td>
                <td className="px-5 py-4 text-slate-700">V{document.currentVersion}</td>
                <td className="px-5 py-4 text-slate-500">{document.uploadedAt}</td>
                <td className="px-5 py-4">
                  <div className="flex gap-2">
                    <a
                      href={`/api/documents/${document.id}/download`}
                      download
                      className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                    >
                      Download
                    </a>
                    <button
                      type="button"
                      onClick={() => router.push(allowReview ? `/approver/review/${document.id}` : detailUrl)}
                      className="rounded-lg bg-slate-900 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-slate-700"
                    >
                      {allowReview ? "Review" : "Open"}
                    </button>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {visibleCount < documents.length ? <div className="border-t border-slate-200 px-5 py-4 text-center"><button type="button" onClick={() => setVisibleCount((count) => count + 10)} className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">Load more</button></div> : null}
    </div>
  );
}
