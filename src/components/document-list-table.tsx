"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { BULK_APPROVE_MAX } from "@/lib/bulk-approve-config";
// import { DocumentStatus } from "@prisma/client";
import StatusBadge from "@/components/status-badge";
import DownloadPackageButton from "@/components/download-package-button";
import { useColumnPreferences } from "@/components/column-picker";
import { Pager, usePagination } from "@/components/pager";
import { getCsrfTokenFromBrowser } from "@/lib/csrf";
import { matchesDocumentSearch, parseSearchQuery } from "@/lib/document-search";
import WhoCanAct from "@/components/admin/who-can-act";
import ReferenceCell, { type ReferenceSummaryItem } from "@/components/reference-cell";
import type { EligiblePerson } from "@/lib/workflow/eligible-people-types";

type DocumentStatus = string;

export type DocumentListItem = {
  id: string;
  documentNumber: string;
  title: string;
  status: DocumentStatus;
  statusLabel?: string;
  // Document type and sub type are data (names and codes from the database), not a fixed list.
  documentTypeName?: string | null;
  documentTypeCode?: string | null;
  documentSubtypeName?: string | null;
  projectLabel?: string | null;
  currentVersion: number;
  currentApproverName?: string | null;
  // The people the document waits for, one by one (the table shows the first few and the rest in a tooltip).
  currentApproverNames?: string[];
  processStatus?: string | null;
  processStatusLabel?: string | null;
  canReview?: boolean;
  // True when the document is pending and waiting for THIS user (it can be reviewed together with others).
  batchEligible?: boolean;
  rejectionComments?: string | null;
  rejectedByName?: string | null;
  // Used by the page to order the list (a time value; kept loose so the page can pass a number or a date).
  sortTime?: number | string | Date | null;
  dateLabel: string;
  downloadedAt?: Date | null;
  receivedAt?: Date | null;
  receiptConfirmationRequired?: boolean;
  // True when the viewer holds documents.confirm_receipt for this approved document and it is not received yet.
  canConfirmReceipt?: boolean;
  approvalDate?: Date | null;
  // Admin only: the people who can act on the level the document waits at.
  whoCanReview?: EligiblePerson[];
  // Reference documents attached to this document that the viewer may see (type and how many).
  references?: ReferenceSummaryItem[];
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
  // Admin-only columns: process status and document version.
  showAdminColumns?: boolean;
  // Adds "Review selected" (several pending documents approved together). Only for users an admin allowed to do so.
  allowBatchReview?: boolean;
  // Shows the "Reference documents" column (people who may view reference documents).
  showReferences?: boolean;
};

export default function DocumentListTable({ documents, emptyMessage, showBulkActions = false, allowBulkDelete = false, allowAdminDelete = false, allowReview = false, showDownloadTracking = false, allowBatchReview = false, showAdminColumns = false, showReferences = false }: Props) {
  const router = useRouter();
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const searchParams = useSearchParams();

  const searchQuery = useMemo(() => parseSearchQuery(searchParams?.get("search")), [searchParams]);
  const visibleDocuments = useMemo(() => documents.filter((doc) => matchesDocumentSearch(doc, searchQuery)), [documents, searchQuery]);
  const pagination = usePagination(visibleDocuments, { storageKey: "document-list", initialPageSize: 25 });
  const pagedDocuments = pagination.pageItems;
  const approvedDocuments = useMemo(() => visibleDocuments.filter((doc) => doc.status === "APPROVED"), [visibleDocuments]);
  const selectedDocuments = useMemo(() => visibleDocuments.filter((doc) => selectedIds.includes(doc.id)), [selectedIds, visibleDocuments]);
  const showReceivedColumn = documents.some((doc) => doc.receiptConfirmationRequired && (doc.canConfirmReceipt || doc.receivedAt));
  const [receivedOverrides, setReceivedOverrides] = useState<Record<string, string>>({});
  const [receiptBusyId, setReceiptBusyId] = useState<string | null>(null);
  const { isShown, picker } = useColumnPreferences("document-list", [
    { key: "number", label: "Document Number" },
    { key: "title", label: "Title" },
    { key: "status", label: "Status" },
    ...(showAdminColumns ? [{ key: "process", label: "Process Status" }] : []),
    { key: "project", label: "Project" },
    ...(showDownloadTracking
      ? [
          { key: "downloadStatus", label: "Download Status" },
          { key: "downloadTime", label: "Download Timestamp" },
          { key: "approvalDate", label: "Approval Date/Time" },
        ]
      : []),
    ...(showAdminColumns ? [{ key: "version", label: "Version" }] : []),
    { key: "approver", label: "Current Approver" },
    ...(showAdminColumns ? [{ key: "whoCanReview", label: "Who can review" }] : []),
    ...(showReferences ? [{ key: "references", label: "Reference documents" }] : []),
    { key: "updated", label: "Last Updated" },
    ...(showReceivedColumn ? [{ key: "received", label: "Received" }] : []),
  ]);
  const columnCount = (showReceivedColumn ? 1 : 0) + (showBulkActions ? 1 : 0) + (showDownloadTracking ? 12 : 9) - (showAdminColumns ? 0 : 2) + (showAdminColumns ? 1 : 0) + (showReferences ? 1 : 0);

  async function confirmReceived(id: string) {
    setReceiptBusyId(id);
    try {
      const response = await fetch(`/api/documents/${id}/received`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-csrf-token": getCsrfTokenFromBrowser() },
      });
      const result = (await response.json()) as { message?: string; receivedAt?: string };
      if (!response.ok || !result.receivedAt) {
        window.alert(result.message || "Failed to confirm receipt.");
        return;
      }
      setReceivedOverrides((current) => ({ ...current, [id]: result.receivedAt as string }));
    } catch {
      window.alert("Unexpected error while confirming receipt.");
    } finally {
      setReceiptBusyId(null);
    }
  }

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

  // Every selected document must be pending for this user (and no more than the batch limit).
  const notReviewable = selectedDocuments.filter((doc) => !doc.batchEligible);
  const canReviewSelected = selectedDocuments.length > 0 && notReviewable.length === 0 && selectedDocuments.length <= BULK_APPROVE_MAX;
  const reviewHint =
    selectedDocuments.length === 0
      ? ""
      : notReviewable.length > 0
        ? `${notReviewable.length} selected document(s) are not pending for you`
        : selectedDocuments.length > BULK_APPROVE_MAX
          ? `Select at most ${BULK_APPROVE_MAX} documents`
          : "";

  function handleReviewSelected() {
    if (!canReviewSelected) return;
    router.push(`/approver/review-batch?ids=${selectedDocuments.map((doc) => doc.id).join(",")}`);
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
      `Send deletion requests for ${selectedDocuments.length} document(s) for review?`,
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
      window.alert(result.message || "Deletion request sent for review.");
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

    function getCurrentApproverDisplay(doc: DocumentListItem): string {
    if (doc.status === "APPROVED") {
      return "Approved";
    }

    if (doc.status === "CANCELLED") {
      return doc.rejectedByName ? `Rejected by ${doc.rejectedByName}` : "Rejected";
    }

    if (doc.status === "ARCHIVED") {
      return "Archived";
    }

    return doc.currentApproverName || "Unassigned";
  }

  // A level that names a user type can have many eligible people, so a long list is shortened (full list on hover).
  const MAX_APPROVER_NAMES = 3;
  function renderCurrentApprover(doc: DocumentListItem) {
    const names = doc.currentApproverNames ?? [];
    const waiting = doc.status !== "APPROVED" && doc.status !== "CANCELLED" && doc.status !== "ARCHIVED";
    if (!waiting || names.length <= MAX_APPROVER_NAMES) return getCurrentApproverDisplay(doc);
    return (
      <span title={names.join(", ")}>
        {names.slice(0, MAX_APPROVER_NAMES).join(", ")}{" "}
        <span className="text-xs font-medium text-slate-500">+{names.length - MAX_APPROVER_NAMES} more</span>
      </span>
    );
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
          <DownloadPackageButton ids={selectedDocuments.map((doc) => doc.id)} disabled={selectedDocuments.length === 0} label="Download package" compact />
          {allowBatchReview ? (
            <>
              <button
                type="button"
                onClick={handleReviewSelected}
                disabled={!canReviewSelected}
                title={reviewHint || "Review and approve the selected documents together"}
                className="rounded-lg bg-cyan-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-cyan-800 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Review selected
              </button>
              {reviewHint ? <span className="text-xs text-amber-700">{reviewHint}</span> : null}
            </>
          ) : null}
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
      <div className="flex justify-end border-b border-slate-100 px-5 py-2">{picker}</div>
      <div className="overflow-x-auto">
      <table className="min-w-full text-left text-sm">
        <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
          <tr>
            {showBulkActions ? <th className="px-3 py-3 font-semibold"><input type="checkbox" checked={visibleDocuments.length > 0 && selectedIds.length === visibleDocuments.length} onChange={() => (selectedIds.length === visibleDocuments.length ? clearSelection() : selectAll())} className="h-4 w-4 rounded border-slate-300" /></th> : null}
            {isShown("number") ? <th className="px-5 py-3 font-semibold">Document Number</th> : null}
            {isShown("title") ? <th className="px-5 py-3 font-semibold">Title</th> : null}
            {isShown("status") ? <th className="px-5 py-3 font-semibold">Status</th> : null}
            {showAdminColumns && isShown("process") ? <th className="px-5 py-3 font-semibold">Process Status</th> : null}
            {isShown("project") ? <th className="px-5 py-3 font-semibold">Project</th> : null}
            {showDownloadTracking && isShown("downloadStatus") ? <th className="px-5 py-3 font-semibold">Download Status</th> : null}{showDownloadTracking && isShown("downloadTime") ? <th className="px-5 py-3 font-semibold">Download Timestamp</th> : null}{showDownloadTracking && isShown("approvalDate") ? <th className="px-5 py-3 font-semibold">Approval Date/Time</th> : null}
            {showAdminColumns && isShown("version") ? <th className="px-5 py-3 font-semibold">Version</th> : null}
            {isShown("approver") ? <th className="px-5 py-3 font-semibold">Current Approver</th> : null}
            {showAdminColumns && isShown("whoCanReview") ? <th className="px-5 py-3 font-semibold">Who can review</th> : null}
            {showReferences && isShown("references") ? <th className="px-5 py-3 font-semibold">Reference documents</th> : null}
            {isShown("updated") ? <th className="px-5 py-3 font-semibold">Last Updated</th> : null}
            {showReceivedColumn && isShown("received") ? <th className="px-5 py-3 font-semibold">Received</th> : null}
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
              const detailUrl = `/documents/${doc.id}`;

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
                  {isShown("number") ? (
<td className="px-5 py-4 font-medium text-slate-900">
                    <Link
                      href={detailUrl}
                      className="text-slate-900 hover:text-indigo-600 hover:underline"
                    >
                      {doc.documentNumber}
                    </Link>
                  </td>
) : null}
                  {isShown("title") ? (
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
) : null}
                  {isShown("status") ? (
<td className="px-5 py-4">
                    <StatusBadge status={doc.status} label={doc.statusLabel} downloaded={Boolean(doc.downloadedAt)} />
                  </td>
) : null}
                  {showAdminColumns && isShown("process") ? (
                    <td className="px-5 py-4">
                      <StatusBadge status={doc.processStatus || "NONE"} label={doc.processStatusLabel || "No Process"} />
                    </td>
                  ) : null}
                  {isShown("project") ? (
<td className="px-5 py-4 text-slate-700">{doc.projectLabel || "—"}</td>
) : null}
                  {showDownloadTracking && isShown("downloadStatus") ? (
                    <td className="px-5 py-4 text-slate-700">{doc.downloadedAt ? "Downloaded" : "Not Downloaded"}</td>
                  ) : null}
                  {showDownloadTracking && isShown("downloadTime") ? <td className="px-5 py-4 text-slate-500">{formatDateTime(doc.downloadedAt)}</td> : null}
                  {showDownloadTracking && isShown("approvalDate") ? <td className="px-5 py-4 text-slate-500">{formatDateTime(doc.approvalDate)}</td> : null}
                  {showAdminColumns && isShown("version") ? <td className="px-5 py-4 text-slate-700">V{doc.currentVersion}</td> : null}
                  {isShown("approver") ? (
<td className="px-5 py-4 text-slate-700">{renderCurrentApprover(doc)}</td>
) : null}
                  {showAdminColumns && isShown("whoCanReview") ? (
                    <td className="px-5 py-4 align-top">
                      {doc.whoCanReview && doc.whoCanReview.length > 0 ? <WhoCanAct people={doc.whoCanReview} label="Who can review" /> : ["PENDING", "ON_HOLD", "REVISION_REQUIRED"].includes(doc.status) ? <p className="text-xs font-medium text-amber-700">Nobody except admins</p> : <span className="text-slate-400">—</span>}
                    </td>
                  ) : null}
                  {showReferences && isShown("references") ? <td className="px-5 py-4 align-top"><ReferenceCell items={doc.references ?? []} /></td> : null}
                  {isShown("updated") ? (
<td className="px-5 py-4 text-slate-500">{doc.dateLabel}</td>
) : null}
                  {showReceivedColumn && isShown("received") ? (
                    <td className="px-5 py-4 text-slate-700">
                      {!doc.receiptConfirmationRequired ? <span className="text-xs text-slate-400">Not required</span> : doc.receivedAt || receivedOverrides[doc.id] ? (
                        <span className="text-xs font-medium text-green-700">Received {formatDateTime(new Date(receivedOverrides[doc.id] ?? (doc.receivedAt as Date)))}</span>
                      ) : doc.canConfirmReceipt ? (
                        <button
                          type="button"
                          disabled={receiptBusyId === doc.id}
                          onClick={() => confirmReceived(doc.id)}
                          className="inline-flex rounded-lg border border-green-300 bg-green-50 px-3 py-1.5 text-xs font-medium text-green-800 hover:bg-green-100 disabled:opacity-50"
                        >
                          {receiptBusyId === doc.id ? "Saving..." : "Confirm received"}
                        </button>
                      ) : (
                        "—"
                      )}
                    </td>
                  ) : null}
                  <td className="px-5 py-4">
                    <div className="flex gap-2">
                      <a
                        href={`/api/documents/${doc.id}/download`}
                        download
                        className="inline-flex rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                      >
                        Download
                      </a>
                      <DownloadPackageButton ids={[doc.id]} label="Package" compact />
                      {allowReview && (doc.canReview ?? (doc.status === "PENDING" || doc.status === "ON_HOLD" || doc.status === "REVISION_REQUIRED")) ? (
                        <Link
                          href={`/approver/review/${doc.id}`}
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
    <Pager {...pagination} noun="documents" />
    </div>
  );
}