"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import { Fragment, useEffect, useMemo, useState } from "react";
import { ChevronDown } from "lucide-react";
import DownloadPackageButton from "@/components/download-package-button";
import { useColumnPreferences } from "@/components/column-picker";
import { Pager, usePagination } from "@/components/pager";
import { BULK_APPROVE_MAX } from "@/lib/bulk-approve-config";
import WhoCanAct from "@/components/admin/who-can-act";
import ReferenceCell, { type ReferenceSummaryItem } from "@/components/reference-cell";
import type { EligiblePerson } from "@/lib/workflow/eligible-people-types";

export type PendingDocument = {
  id: string;
  documentNumber: string;
  title: string;
  projectLabel?: string | null;
  // Document type (and sub type), used to group the list.
  documentTypeLabel?: string | null;
  // Where it is waiting, e.g. "Pending PMV Engineer" (the level's name comes from the flow).
  statusLabel?: string | null;
  currentVersion: number;
  uploadedAt: string;
  latestComment?: string | null;
  // Only documents waiting for approval can be reviewed together (not ones on hold or sent back for revision).
  batchEligible?: boolean;
  // Admin only: the people who can act on the level the document waits at.
  whoCanReview?: EligiblePerson[];
  // Reference documents attached to this document that the viewer may see (type and how many).
  references?: ReferenceSummaryItem[];
};

type Props = {
  documents: PendingDocument[];
  // Approvers get a Review button; admins only view (they act only where a flow names them).
  allowReview?: boolean;
  emptyMessage?: string;
  // Shows tick boxes and "Review selected" for users who may approve several documents at once.
  allowBatch?: boolean;
  // Admin only: show the document version.
  showVersion?: boolean;
  // Admin only: the "Who can review" column.
  showWhoCanReview?: boolean;
  // Shows the "Reference documents" column (people who may view reference documents).
  showReferences?: boolean;
};

type GroupBy = "none" | "project" | "waitingAt" | "type";

const GROUP_OPTIONS: Array<{ value: GroupBy; label: string }> = [
  { value: "none", label: "No grouping" },
  { value: "project", label: "Project" },
  { value: "waitingAt", label: "Waiting at" },
  { value: "type", label: "Document type" },
];

const GROUP_STORAGE_KEY = "pmv-group:approver-pending";

function groupKeyOf(document: PendingDocument, groupBy: GroupBy): string {
  if (groupBy === "project") return document.projectLabel || "No project";
  if (groupBy === "waitingAt") return document.statusLabel || "Pending";
  if (groupBy === "type") return document.documentTypeLabel || "Other";
  return "";
}

export default function ApproverPendingTable({ documents, allowReview = true, allowBatch = false, showVersion = false, showWhoCanReview = false, showReferences = false, emptyMessage = "No pending approvals assigned to you." }: Props) {
  const router = useRouter();
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [groupBy, setGroupByState] = useState<GroupBy>("none");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const canGroupByType = documents.some((document) => document.documentTypeLabel);
  const { isShown, picker } = useColumnPreferences("approver-pending", [
    { key: "number", label: "Document Number" },
    { key: "title", label: "Title" },
    { key: "project", label: "Project" },
    { key: "waitingAt", label: "Waiting At" },
    ...(showVersion ? [{ key: "version", label: "Current Version" }] : []),
    ...(showWhoCanReview ? [{ key: "whoCanReview", label: "Who can review" }] : []),
    ...(showReferences ? [{ key: "references", label: "Reference documents" }] : []),
    { key: "date", label: "Date" },
  ]);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(GROUP_STORAGE_KEY) as GroupBy | null;
      if (stored && GROUP_OPTIONS.some((option) => option.value === stored)) setGroupByState(stored);
    } catch {
      // Storage blocked: no grouping.
    }
  }, []);

  function setGroupBy(value: GroupBy) {
    setGroupByState(value);
    setCollapsed(new Set());
    try {
      window.localStorage.setItem(GROUP_STORAGE_KEY, value);
    } catch {
      // Not saved; still applies until the page is closed.
    }
  }

  const activeGroupBy: GroupBy = groupBy === "type" && !canGroupByType ? "none" : groupBy;

  // Groups in a stable order (by name), each with all of its documents; collapsed groups drop out of the pages.
  const groups = useMemo(() => {
    if (activeGroupBy === "none") return [];
    const map = new Map<string, PendingDocument[]>();
    for (const document of documents) {
      const key = groupKeyOf(document, activeGroupBy);
      const list = map.get(key) ?? [];
      list.push(document);
      map.set(key, list);
    }
    return [...map.entries()].map(([key, items]) => ({ key, items })).sort((a, b) => a.key.localeCompare(b.key));
  }, [documents, activeGroupBy]);

  const orderedRows = useMemo(
    () => (activeGroupBy === "none" ? documents : groups.flatMap((group) => (collapsed.has(group.key) ? [] : group.items))),
    [activeGroupBy, collapsed, documents, groups],
  );

  const pagination = usePagination(orderedRows, { storageKey: "approver-pending", initialPageSize: 25 });

  // Selections of documents that are no longer in the list (approved meanwhile, filtered out) are dropped.
  useEffect(() => {
    const present = new Set(documents.map((document) => document.id));
    setSelectedIds((current) => (current.every((id) => present.has(id)) ? current : current.filter((id) => present.has(id))));
  }, [documents]);

  if (documents.length === 0) {
    return <div className="px-5 py-6 text-sm text-slate-500">{emptyMessage}</div>;
  }

  const showBatch = allowBatch && allowReview;
  const selectableIds = pagination.pageItems.filter((document) => document.batchEligible !== false).map((document) => document.id);
  const allSelected = selectableIds.length > 0 && selectableIds.every((id) => selectedIds.includes(id));
  const groupCount = new Map(groups.map((group) => [group.key, group.items.length]));

  const columnCount =
    (showBatch ? 1 : 0) +
    ["number", "title", "project", "waitingAt", "date"].filter((key) => isShown(key)).length +
    (showVersion && isShown("version") ? 1 : 0) +
    (showWhoCanReview && isShown("whoCanReview") ? 1 : 0) +
    (showReferences && isShown("references") ? 1 : 0) +
    1;

  function toggleOne(id: string) {
    setSelectedIds((current) => (current.includes(id) ? current.filter((value) => value !== id) : current.length >= BULK_APPROVE_MAX ? current : [...current, id]));
  }

  function togglePage() {
    setSelectedIds((current) => {
      if (allSelected) return current.filter((id) => !selectableIds.includes(id));
      const next = [...current];
      for (const id of selectableIds) {
        if (next.length >= BULK_APPROVE_MAX) break;
        if (!next.includes(id)) next.push(id);
      }
      return next;
    });
  }

  function toggleGroup(key: string) {
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function reviewSelected() {
    if (selectedIds.length === 0) return;
    router.push(`/approver/review-batch?ids=${selectedIds.join(",")}`);
  }

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-2">
        <label className="flex items-center gap-2 text-sm text-slate-600">
          Group by
          <select
            value={activeGroupBy}
            onChange={(event) => setGroupBy(event.target.value as GroupBy)}
            className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-800 outline-none focus:ring-2 focus:ring-cyan-300"
          >
            {GROUP_OPTIONS.filter((option) => option.value !== "type" || canGroupByType).map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </label>
        {picker}
      </div>

      {groups.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 px-5 py-3">
          {groups.map((group) => {
            const isCollapsed = collapsed.has(group.key);
            return (
              <button
                key={group.key}
                type="button"
                onClick={() => toggleGroup(group.key)}
                aria-pressed={!isCollapsed}
                title={isCollapsed ? "Show this group" : "Hide this group"}
                className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition ${
                  isCollapsed ? "border-slate-200 bg-white text-slate-400 line-through" : "border-cyan-200 bg-cyan-50 text-cyan-900 hover:bg-cyan-100"
                }`}
              >
                {group.key}
                <span className={`rounded-full px-1.5 ${isCollapsed ? "bg-slate-100" : "bg-white"}`}>{group.items.length}</span>
              </button>
            );
          })}
          {collapsed.size > 0 ? (
            <button type="button" onClick={() => setCollapsed(new Set())} className="text-xs font-medium text-cyan-700 hover:underline">Show all</button>
          ) : (
            <button type="button" onClick={() => setCollapsed(new Set(groups.map((group) => group.key)))} className="text-xs font-medium text-slate-500 hover:underline">Hide all</button>
          )}
        </div>
      ) : null}

      {showBatch ? (
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 px-5 py-3">
          <p className="text-sm text-slate-600">
            {selectedIds.length === 0 ? `Tick documents to review and approve them together (up to ${BULK_APPROVE_MAX}).` : `${selectedIds.length} selected${selectedIds.length >= BULK_APPROVE_MAX ? " (maximum)" : ""}`}
          </p>
          <div className="flex items-center gap-2">
            {selectedIds.length > 0 ? (
              <button type="button" onClick={() => setSelectedIds([])} className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50">Clear</button>
            ) : null}
            <button type="button" onClick={reviewSelected} disabled={selectedIds.length === 0} className="rounded-lg bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50">Review selected</button>
          </div>
        </div>
      ) : null}

      {orderedRows.length === 0 ? (
        <div className="border-t border-slate-200 px-5 py-6 text-sm text-slate-500">Every group is hidden. Click a group above to show it.</div>
      ) : (
        // The list scrolls inside its own box with the column titles kept in view, so a long list does not push the page.
        <div className="max-h-[70vh] overflow-auto border-t border-slate-200">
          <table className="min-w-full text-left text-sm">
            <thead className="sticky top-0 z-10 bg-slate-50 text-xs uppercase tracking-wide text-slate-500 shadow-[inset_0_-1px_0_rgb(226_232_240)]">
              <tr>
                {showBatch ? <th className="px-3 py-3 font-semibold"><input type="checkbox" aria-label="Select all on this page" checked={allSelected} onChange={togglePage} className="h-4 w-4 rounded border-slate-300" /></th> : null}
                {isShown("number") ? <th className="px-5 py-3 font-semibold">Document Number</th> : null}
                {isShown("title") ? <th className="px-5 py-3 font-semibold">Title</th> : null}
                {isShown("project") ? <th className="px-5 py-3 font-semibold">Project</th> : null}
                {isShown("waitingAt") ? <th className="px-5 py-3 font-semibold">Waiting At</th> : null}
                {showVersion && isShown("version") ? <th className="px-5 py-3 font-semibold">Current Version</th> : null}
                {showWhoCanReview && isShown("whoCanReview") ? <th className="px-5 py-3 font-semibold">Who can review</th> : null}
                {showReferences && isShown("references") ? <th className="px-5 py-3 font-semibold">Reference documents</th> : null}
                {isShown("date") ? <th className="px-5 py-3 font-semibold">Date</th> : null}
                <th className="px-5 py-3 font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody>
              {pagination.pageItems.map((document, index) => {
                const detailUrl = `/documents/${document.id}`;
                const key = activeGroupBy === "none" ? "" : groupKeyOf(document, activeGroupBy);
                const previous = index > 0 ? pagination.pageItems[index - 1] : null;
                const startsGroup = activeGroupBy !== "none" && (!previous || groupKeyOf(previous, activeGroupBy) !== key);
                const continues = startsGroup && index === 0 && pagination.page > 1 && orderedRows[(pagination.page - 1) * pagination.pageSize - 1] && groupKeyOf(orderedRows[(pagination.page - 1) * pagination.pageSize - 1], activeGroupBy) === key;

                return (
                  <Fragment key={document.id}>
                    {startsGroup ? (
                      <tr className="border-t border-slate-200 bg-slate-100/70">
                        <td colSpan={columnCount} className="px-5 py-2">
                          <button type="button" onClick={() => toggleGroup(key)} className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-700">
                            <ChevronDown className="h-4 w-4 text-slate-400" />
                            {key}
                            <span className="rounded-full bg-white px-2 py-0.5 text-[11px] font-medium normal-case tracking-normal text-slate-600">{groupCount.get(key) ?? 0} document(s)</span>
                            {continues ? <span className="text-[11px] font-normal normal-case tracking-normal text-slate-500">continued</span> : null}
                          </button>
                        </td>
                      </tr>
                    ) : null}
                    <tr className="border-t border-slate-100 hover:bg-slate-50/50">
                      {showBatch ? (
                        <td className="px-3 py-3">
                          {document.batchEligible === false ? null : <input type="checkbox" aria-label={`Select ${document.documentNumber}`} checked={selectedIds.includes(document.id)} onChange={() => toggleOne(document.id)} className="h-4 w-4 rounded border-slate-300" />}
                        </td>
                      ) : null}
                      {isShown("number") ? (
                        <td className="px-5 py-3 font-medium text-slate-900">
                          <Link href={detailUrl} className="hover:text-indigo-600 hover:underline">{document.documentNumber}</Link>
                        </td>
                      ) : null}
                      {isShown("title") ? (
                        <td className="px-5 py-3 text-slate-700">
                          <Link href={detailUrl} className="text-slate-800 hover:text-indigo-600 hover:underline">{document.title}</Link>
                          {document.latestComment ? <div className="mt-1 line-clamp-2 text-xs text-slate-500" title={document.latestComment}>{document.latestComment}</div> : null}
                        </td>
                      ) : null}
                      {isShown("project") ? <td className="px-5 py-3 text-slate-700">{document.projectLabel || "—"}</td> : null}
                      {isShown("waitingAt") ? <td className="px-5 py-3 text-slate-700">{document.statusLabel || "Pending"}</td> : null}
                      {showVersion && isShown("version") ? <td className="px-5 py-3 text-slate-700">V{document.currentVersion}</td> : null}
                      {showWhoCanReview && isShown("whoCanReview") ? (
                        <td className="px-5 py-3 align-top">
                          {document.whoCanReview && document.whoCanReview.length > 0 ? <WhoCanAct people={document.whoCanReview} label="Who can review" /> : <p className="text-xs font-medium text-amber-700">Nobody except admins</p>}
                        </td>
                      ) : null}
                      {showReferences && isShown("references") ? <td className="px-5 py-3 align-top"><ReferenceCell items={document.references ?? []} /></td> : null}
                      {isShown("date") ? <td className="whitespace-nowrap px-5 py-3 text-slate-500">{document.uploadedAt}</td> : null}
                      <td className="px-5 py-3">
                        <div className="flex gap-2">
                          <a href={`/api/documents/${document.id}/download`} download className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50">
                            Download
                          </a>
                          <DownloadPackageButton ids={[document.id]} label="Package" compact />
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
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <Pager {...pagination} noun="documents" />
    </div>
  );
}
