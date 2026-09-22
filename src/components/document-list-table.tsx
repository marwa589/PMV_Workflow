"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
// import { DocumentStatus } from "@prisma/client";
import StatusBadge from "@/components/status-badge";
import { getCsrfTokenFromBrowser } from "@/lib/csrf";
import { matchesDocumentSearch, parseSearchQuery } from "@/lib/document-search";

type DocumentStatus = string;

export type DocumentListItem = {
  id: string;
  documentNumber: string;
  title: string;
  status: DocumentStatus;
  statusLabel?: string;
  documentType?: "COMPARISON" | "MATERIAL_REQUISITION" | "ERR" | null;
  mrType?: "CASH" | "CREDIT" | null;
  poStatus?: "UPLOADED" | "PENDING" | "NOT_APPLICABLE";
  currentVersion: number;
  currentApproverName?: string | null;
  canReview?: boolean;
  rejectionComments?: string | null;
  dateLabel: string;
  relatedComparisonId?: string | null;
  relatedComparisonDocumentNumber?: string | null;
  downloadedAt?: Date | null;
  approvalDate?: Date | null;
};

function formatDateTime(value?: Date | null): string {
  return value ? new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)) : "—";
}

type Props = {
  documents: DocumentListItem[];
  emptyMessage: string;
  showBulkActions?: boolean;
  allowBulkDelete?: boolean;
  allowAdminDelete?: boolean;
  allowReview?: boolean;
  showDownloadTracking?: boolean;
};

export default function DocumentListTable({ documents, emptyMessage, showBulkActions = false, allowBulkDelete = false, allowAdminDelete = false, allowReview = false, showDownloadTracking = false }: Props) {
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [visibleCount, setVisibleCount] = useState(10);
  const searchParams = useSearchParams();

  const searchQuery = useMemo(() => parseSearchQuery(searchParams?.get("search")), [searchParams]);
  const visibleDocuments = useMemo(() => documents.filter((doc) => matchesDocumentSearch(doc, searchQuery)), [documents, searchQuery]);
  const pagedDocuments = visibleDocuments.slice(0, visibleCount);
  const approvedDocuments = useMemo(() => visibleDocuments.filter((doc) => doc.status === "APPROVED"), [visibleDocuments]);
  const selectedDocuments = useMemo(() => visibleDocuments.filter((doc) => selectedIds.includes(doc.id)), [selectedIds, visibleDocuments]);
  const columnCount = (showBulkActions ? 1 : 0) + (showDownloadTracking ? 13 : 10);

  function toggleSelection(id: string) {
    setSelectedIds((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]));
  }

  function selectAll() {
    setSelectedIds(visibleDocuments.map((doc) => doc.id));
  }

  function clearSelection() {
    setSelectedIds([]);
  }

  function selectApprovedOnly() {
    setSelectedIds(approvedDocuments.map((doc) => doc.id));
  }

  function handleBulkDownload(target: "selected") {
    const ids = target === "selected" ? selectedDocuments.map((doc) => doc.id) : [];
    if (ids.length === 0) return;
    const params = new URLSearchParams();
    ids.forEach((id) => params.append("ids", id));
    window.open(`/api/documents/bulk-download?${params.toString()}`, "_blank", "noopener,noreferrer");
  }

  async function handleBulkDelete() {
    if (selectedDocuments.length === 0) return;

    const confirmed = window.confirm(
      `Send deletion requests for ${selectedDocuments.length} document(s) to Admin for approval?`,
    );

    if (!confirmed) {
      return;
    }

    try {
      const response = await fetch("/api/documents/deletion-requests", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-csrf-token": getCsrfTokenFromBrowser(),
        },
        body: JSON.stringify({ ids: selectedDocuments.map((doc) => doc.id) }),
      });

      const result = (await response.json()) as { message?: string };
      if (!response.ok) {
        window.alert(result.message || "Failed to request deletion.");
        return;
      }

      setSelectedIds([]);
      window.alert(result.message || "Deletion request sent to Admin.");
      window.location.reload();
    } catch {
      window.alert("Unexpected error while sending deletion requests.");
    }
  }

  async function handleAdminDelete() {
    if (selectedDocuments.length === 0) return;
    if (!window.confirm(`Permanently delete ${selectedDocuments.length} document(s) and their files?`)) return;

    try {
      const response = await fetch("/api/documents/bulk-delete", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-csrf-token": getCsrfTokenFromBrowser() },
        body: JSON.stringify({ ids: selectedDocuments.map((doc) => doc.id) }),
      });
      const result = (await response.json()) as { message?: string };
      if (!response.ok) {
        window.alert(result.message || "Failed to delete documents.");
        return;
      }
      setSelectedIds([]);
      window.alert(result.message || "Documents deleted.");
      window.location.reload();
    } catch {
      window.alert("Unexpected error while deleting documents.");
    }
  }

  function getDocumentTypeLabel(doc: DocumentListItem): string {
    if (doc.documentType === "MATERIAL_REQUISITION") {
      if (doc.mrType === "CASH") return "MR - Cash";
      if (doc.mrType === "CREDIT") return "MR - Credit";
      return "Material Requisition";
    }

    if (doc.documentType === "ERR") {
      return "ERR";
    }

    return "Comparison Sheet";
  }

  function getCurrentApproverDisplay(doc: DocumentListItem): string {
    if (doc.status === "APPROVED") {
      return "Approved";
    }

    if (doc.status === "REJECTED") {
      return "Rejected";
    }

    return doc.currentApproverName || "Unassigned";
  }

  return (
    <div>
      {showBulkActions ? (
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 bg-slate-50 px-5 py-3">
          <button type="button" onClick={selectAll} className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100">
            Select all
          </button>
          <button type="button" onClick={clearSelection} className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100">
            Clear
          </button>
          <button type="button" onClick={() => handleBulkDownload("selected")} disabled={selectedDocuments.length === 0} className="rounded-lg bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50">
            Download selected
          </button>
          {allowBulkDelete ? (
            <button type="button" onClick={handleBulkDelete} disabled={selectedDocuments.length === 0} className="rounded-lg border border-rose-300 bg-rose-50 px-3 py-1.5 text-sm font-medium text-rose-700 hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-50">
              Request deletion
            </button>
          ) : null}
          {allowAdminDelete ? (
            <button type="button" onClick={handleAdminDelete} disabled={selectedDocuments.length === 0} className="rounded-lg border border-rose-300 bg-rose-50 px-3 py-1.5 text-sm font-medium text-rose-700 hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-50">
              Delete permanently
            </button>
          ) : null}
        </div>
      ) : null}
      <div className="overflow-x-auto">
      <table className="min-w-full text-left text-sm">
        <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
          <tr>
            {showBulkActions ? <th className="px-3 py-3 font-semibold"><input type="checkbox" checked={visibleDocuments.length > 0 && selectedIds.length === visibleDocuments.length} onChange={() => (selectedIds.length === visibleDocuments.length ? clearSelection() : selectAll())} className="h-4 w-4 rounded border-slate-300" /></th> : null}
            <th className="px-5 py-3 font-semibold">Document Number</th>
            <th className="px-5 py-3 font-semibold">Title</th>
            <th className="px-5 py-3 font-semibold">Status</th>
            <th className="px-5 py-3 font-semibold">Type</th>
            <th className="px-5 py-3 font-semibold">PO Status</th>
            <th className="px-5 py-3 font-semibold">Related Comparison</th>
            {showDownloadTracking ? <><th className="px-5 py-3 font-semibold">Download Status</th><th className="px-5 py-3 font-semibold">Download Timestamp</th><th className="px-5 py-3 font-semibold">Approval Date/Time</th></> : null}
            <th className="px-5 py-3 font-semibold">Version</th>
            <th className="px-5 py-3 font-semibold">Current Approver</th>
            <th className="px-5 py-3 font-semibold">Last Updated</th>
            <th className="px-5 py-3 font-semibold">Actions</th>
          </tr>
        </thead>
        <tbody>
          {visibleDocuments.length === 0 ? (
            <tr>
              <td colSpan={columnCount} className="px-5 py-6 text-center text-slate-500">
                {emptyMessage}
              </td>
            </tr>
          ) : (
            pagedDocuments.map((doc) => {
              const detailUrl =
                doc.documentType === "ERR"
                  ? `/errs/${doc.id}`
                  : `/documents/${doc.id}`;

              return (
                <tr key={doc.id} className="border-t border-slate-100 hover:bg-slate-50/50">
                  {showBulkActions ? (
                    <td className="px-3 py-4">
                      <input
                        type="checkbox"
                        checked={selectedIds.includes(doc.id)}
                        onChange={() => toggleSelection(doc.id)}
                        className="h-4 w-4 rounded border-slate-300"
                      />
                    </td>
                  ) : null}
                  <td className="px-5 py-4 font-medium text-slate-900">
                    <Link
                      href={detailUrl}
                      className="text-slate-900 hover:text-indigo-600 hover:underline"
                    >
                      {doc.documentNumber}
                    </Link>
                  </td>
                  <td className="px-5 py-4 text-slate-700">
                    <Link
                      href={detailUrl}
                      className="text-slate-800 hover:text-indigo-600 hover:underline"
                    >
                      <div>{doc.title}</div>
                    </Link>
                    {doc.rejectionComments ? (
                      <div className="mt-1 text-xs text-slate-500">{doc.rejectionComments}</div>
                    ) : null}
                  </td>
                  <td className="px-5 py-4">
                    <StatusBadge status={doc.status} label={doc.statusLabel} />
                  </td>
                  <td className="px-5 py-4">
                    <span className="inline-flex rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-700">
                      {getDocumentTypeLabel(doc)}
                    </span>
                  </td>
                  <td className="px-5 py-4">
                    <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${doc.poStatus === "UPLOADED" ? "bg-emerald-50 text-emerald-700" : doc.poStatus === "PENDING" ? "bg-yellow-50 text-yellow-800" : "bg-slate-100 text-slate-600"}`}>
                      {doc.poStatus === "UPLOADED" ? "PO Uploaded" : doc.poStatus === "PENDING" ? "PO Pending" : "Not Applicable"}
                    </span>
                  </td>
                  <td className="px-5 py-4 text-slate-700">
                    {doc.relatedComparisonId && doc.relatedComparisonDocumentNumber ? (
                      <Link
                        href={`/documents/${doc.relatedComparisonId}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-medium text-cyan-700 hover:underline"
                      >
                        {doc.relatedComparisonDocumentNumber}
                      </Link>
                    ) : (
                      "—"
                    )}
                  </td>
                  {showDownloadTracking ? (
                    <>
                      <td className="px-5 py-4 text-slate-700">
                        {doc.downloadedAt ? "Downloaded" : "Not Downloaded"}
                      </td>
                      <td className="px-5 py-4 text-slate-500">{formatDateTime(doc.downloadedAt)}</td>
                      <td className="px-5 py-4 text-slate-500">{formatDateTime(doc.approvalDate)}</td>
                    </>
                  ) : null}
                  <td className="px-5 py-4 text-slate-700">V{doc.currentVersion}</td>
                  <td className="px-5 py-4 text-slate-700">{getCurrentApproverDisplay(doc)}</td>
                  <td className="px-5 py-4 text-slate-500">{doc.dateLabel}</td>
                  <td className="px-5 py-4">
                    <div className="flex gap-2">
                      <a
                        href={
                          doc.documentType === "ERR"
                            ? `/api/errs/${doc.id}/download?kind=ERR_PDF`
                            : `/api/documents/${doc.id}/download`
                        }
                        download
                        className="inline-flex rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                      >
                        Download
                      </a>
                      {allowReview &&
                      (doc.canReview ??
                        (doc.status !== "APPROVED" && doc.status !== "REJECTED")) ? (
                        <Link
                          href={
                            doc.documentType === "ERR"
                              ? `/errs/${doc.id}/review`
                              : `/approver/review/${doc.id}`
                          }
                          className="inline-flex rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-700"
                        >
                          Review
                        </Link>
                      ) : null}
                    </div>
                  </td>
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
    {visibleCount < visibleDocuments.length ? (
      <div className="border-t border-slate-200 px-5 py-4 text-center">
        <button type="button" onClick={() => setVisibleCount((count) => count + 10)} className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
          Load more
        </button>
      </div>
    ) : null}
    </div>
  );
}