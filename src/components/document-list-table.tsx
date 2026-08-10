"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
// import { DocumentStatus } from "@prisma/client";
import StatusBadge from "@/components/status-badge";
import DocumentDeleteButton from "@/components/document-delete-button";
import { matchesDocumentSearch, parseSearchQuery } from "@/lib/document-search";

type DocumentStatus =
  | "PENDING_APPROVER_1"
  | "PENDING_APPROVER_2"
  | "PENDING_APPROVER_3"
  | "APPROVED"
  | "REJECTED"
  | "REVISION_REQUIRED"
  | "ARCHIVED";

export type DocumentListItem = {
  id: string;
  documentNumber: string;
  title: string;
  status: DocumentStatus;
  statusLabel?: string;
  documentType?: "COMPARISON" | "MATERIAL_REQUISITION" | null;
  mrType?: "CASH" | "CREDIT" | null;
  currentVersion: number;
  currentApproverName?: string | null;
  rejectionComments?: string | null;
  dateLabel: string;
};

type Props = {
  documents: DocumentListItem[];
  emptyMessage: string;
  showDeleteAction?: boolean;
  showBulkActions?: boolean;
};

export default function DocumentListTable({ documents, emptyMessage, showDeleteAction = false, showBulkActions = false }: Props) {
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const searchParams = useSearchParams();

  const searchQuery = useMemo(() => parseSearchQuery(searchParams?.get("search")), [searchParams]);
  const visibleDocuments = useMemo(() => documents.filter((doc) => matchesDocumentSearch(doc, searchQuery)), [documents, searchQuery]);
  const approvedDocuments = useMemo(() => visibleDocuments.filter((doc) => doc.status === "APPROVED"), [visibleDocuments]);
  const selectedDocuments = useMemo(() => visibleDocuments.filter((doc) => selectedIds.includes(doc.id)), [selectedIds, visibleDocuments]);

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
      `Are you sure you want to permanently delete ${selectedDocuments.length} selected document(s) and all related versions and history?`,
    );

    if (!confirmed) {
      return;
    }

    try {
      const response = await fetch("/api/documents/bulk-delete", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ ids: selectedDocuments.map((doc) => doc.id) }),
      });

      const result = (await response.json()) as { message?: string };
      if (!response.ok) {
        window.alert(result.message || "Failed to delete selected documents.");
        return;
      }

      setSelectedIds([]);
      window.location.reload();
    } catch {
      window.alert("Unexpected error while deleting the selected documents.");
    }
  }

  function getDocumentTypeLabel(doc: DocumentListItem): string {
    if (doc.documentType === "MATERIAL_REQUISITION") {
      if (doc.mrType === "CASH") return "MR - Cash";
      if (doc.mrType === "CREDIT") return "MR - Credit";
      return "Material Requisition";
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
          <button type="button" onClick={() => handleBulkDownload("selected")} className="rounded-lg bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-700">
            Download selected
          </button>
          <button type="button" onClick={handleBulkDelete} className="rounded-lg border border-rose-300 bg-rose-50 px-3 py-1.5 text-sm font-medium text-rose-700 hover:bg-rose-100">
            Delete selected
          </button>
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
            <th className="px-5 py-3 font-semibold">Version</th>
            <th className="px-5 py-3 font-semibold">Current Approver</th>
            <th className="px-5 py-3 font-semibold">Last Updated</th>
            <th className="px-5 py-3 font-semibold">Download</th>
            {showDeleteAction ? <th className="px-5 py-3 font-semibold">Delete</th> : null}
          </tr>
        </thead>
        <tbody>
          {visibleDocuments.length === 0 ? (
            <tr>
              <td colSpan={(showBulkActions ? 1 : 0) + (showDeleteAction ? 8 : 7)} className="px-5 py-6 text-center text-slate-500">
                {emptyMessage}
              </td>
            </tr>
          ) : (
            visibleDocuments.map((doc) => (
              <tr key={doc.id} className="border-t border-slate-100">
                {showBulkActions ? (
                  <td className="px-3 py-4">
                    <input type="checkbox" checked={selectedIds.includes(doc.id)} onChange={() => toggleSelection(doc.id)} className="h-4 w-4 rounded border-slate-300" />
                  </td>
                ) : null}
                <td className="px-5 py-4 font-medium text-slate-900">
                  <Link href={`/documents/${doc.id}`} className="text-slate-900 hover:text-slate-700 hover:underline">
                    {doc.documentNumber}
                  </Link>
                </td>
                <td className="px-5 py-4 text-slate-700">
                  <Link href={`/documents/${doc.id}`} className="hover:text-slate-900 hover:underline">
                    <div>{doc.title}</div>
                  </Link>
                  {doc.rejectionComments ? <div className="mt-1 text-xs text-slate-500">{doc.rejectionComments}</div> : null}
                </td>
                <td className="px-5 py-4">
                  <StatusBadge status={doc.status} label={doc.statusLabel} />
                </td>
                <td className="px-5 py-4">
                  <span className="inline-flex rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-700">
                    {getDocumentTypeLabel(doc)}
                  </span>
                </td>
                <td className="px-5 py-4 text-slate-700">V{doc.currentVersion}</td>
                <td className="px-5 py-4 text-slate-700">{getCurrentApproverDisplay(doc)}</td>
                <td className="px-5 py-4 text-slate-500">{doc.dateLabel}</td>
                <td className="px-5 py-4">
                  <a
                    href={`/api/documents/${doc.id}/download`}
                    className="inline-flex rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                  >
                    Download
                  </a>
                </td>
                {showDeleteAction ? (
                  <td className="px-5 py-4">
                    <DocumentDeleteButton documentId={doc.id} />
                  </td>
                ) : null}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
    </div>
  );
}
