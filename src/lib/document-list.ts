import { DocumentStatus } from "@prisma/client";
import type { DocumentListItem } from "@/components/document-list-table";
import type { DocumentRow } from "@/lib/document-queries";
import { matchesDocumentSearch, parseSearchQuery } from "@/lib/document-search";
import {
  parseDocumentStatusFilter,
  parseDocumentSubtypeFilter,
  parseDocumentTypeFilter,
  parseDownloadStatusFilter,
  parseProjectFilter,
  type DocumentStatusFilterValue,
  type DownloadStatusFilter,
} from "@/lib/document-status";

export type ListSearchParams = Record<string, string | string[] | undefined> | undefined;

// What the filter bar sends in the URL: ?status=&documentType=&documentSubtype=&project=&search=&downloadStatus=&approvalFrom=&approvalTo=
export type ListFilters = {
  status: DocumentStatusFilterValue;
  documentType: string; // document type code, e.g. "MR"
  documentSubtype: string; // sub type code, e.g. "CASH"
  project: string; // project id
  downloadStatus: DownloadStatusFilter;
  approvalFrom: string;
  approvalTo: string;
  search: string;
};

function first(value: string | string[] | undefined): string {
  return Array.isArray(value) ? (value[0] ?? "") : (value ?? "");
}

export function parseListFilters(params: ListSearchParams): ListFilters {
  return {
    status: parseDocumentStatusFilter(first(params?.status)),
    documentType: parseDocumentTypeFilter(first(params?.documentType)),
    documentSubtype: parseDocumentSubtypeFilter(first(params?.documentSubtype)),
    project: parseProjectFilter(first(params?.project)),
    downloadStatus: parseDownloadStatusFilter(first(params?.downloadStatus)),
    approvalFrom: first(params?.approvalFrom),
    approvalTo: first(params?.approvalTo),
    search: parseSearchQuery(first(params?.search)),
  };
}

function searchTextOf(row: DocumentRow) {
  return {
    documentNumber: row.documentNumber,
    title: row.title,
    statusLabel: row.statusLabel,
    documentTypeName: row.documentType.name,
    documentTypeCode: row.documentType.code,
    documentSubtypeName: row.documentSubtype?.name,
    projectName: row.project?.name,
    projectCode: row.project?.code,
    currentApproverName: row.currentApprover?.name,
    rejectionComments: row.rejection?.comments,
  };
}

export function applyListFilters(rows: DocumentRow[], filters: ListFilters, options: { ignoreStatus?: boolean } = {}): DocumentRow[] {
  const from = filters.approvalFrom ? new Date(filters.approvalFrom).getTime() : null;
  const to = filters.approvalTo ? new Date(filters.approvalTo).getTime() : null;

  return rows
    .filter((row) => options.ignoreStatus || !filters.status || row.status === filters.status)
    .filter((row) => !filters.documentType || row.documentType.code === filters.documentType)
    .filter((row) => !filters.documentSubtype || row.documentSubtype?.code === filters.documentSubtype)
    .filter((row) => !filters.project || row.project?.id === filters.project)
    .filter((row) => !filters.downloadStatus || (filters.downloadStatus === "DOWNLOADED" ? Boolean(row.downloadedAt) : !row.downloadedAt))
    .filter((row) => {
      if (from === null && to === null) return true;
      const approvedAt = row.approvedAt?.getTime();
      return (from === null || (approvedAt !== undefined && approvedAt >= from)) && (to === null || (approvedAt !== undefined && approvedAt <= to));
    })
    .filter((row) => matchesDocumentSearch(searchTextOf(row), filters.search));
}

const dateFormat = new Intl.DateTimeFormat("en-US", { dateStyle: "medium" });

/** The plain object the list table needs (safe to pass from a server page to a client component). */
export function toListItem(row: DocumentRow): DocumentListItem {
  return {
    id: row.id,
    documentNumber: row.documentNumber,
    title: row.title,
    status: row.status,
    statusLabel: row.statusLabel,
    documentTypeName: row.documentType.name,
    documentTypeCode: row.documentType.code,
    documentSubtypeName: row.documentSubtype?.name ?? null,
    projectLabel: row.project ? `${row.project.code} - ${row.project.name}` : null,
    rejectionComments: row.rejection?.comments ?? null,
    processStatus: row.processStatus,
    processStatusLabel: row.processStatusLabel ?? "No Process",
    currentVersion: row.currentVersion,
    currentApproverName: row.currentApprover?.name ?? null,
    downloadedAt: row.downloadedAt,
    approvalDate: row.approvedAt,
    dateLabel: dateFormat.format(row.updatedAt),
  };
}

type SummaryCard = { label: string; value: string; tone: string };

const TYPE_TONES = [
  "bg-slate-50 text-slate-900 ring-1 ring-slate-200",
  "bg-sky-50 text-sky-900 ring-1 ring-sky-200",
  "bg-violet-50 text-violet-900 ring-1 ring-violet-200",
];

/**
 * "overview": total, pending, approved, rejected.
 * "byType": total plus the three document types with the most documents (the types are data, not hard-coded).
 */
export function buildSummaryCards(rows: DocumentRow[], mode: "overview" | "byType"): SummaryCard[] {
  const total: SummaryCard = { label: "Assigned/Handled", value: String(rows.length), tone: "bg-slate-900 text-white" };

  if (mode === "byType") {
    const counts = new Map<string, number>();
    for (const row of rows) counts.set(row.documentType.name, (counts.get(row.documentType.name) ?? 0) + 1);
    const top = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
    return [total, ...top.map(([name, count], index) => ({ label: name, value: String(count), tone: TYPE_TONES[index % TYPE_TONES.length] }))];
  }

  const count = (status: DocumentStatus) => String(rows.filter((row) => row.status === status).length);
  return [
    total,
    { label: "Pending", value: count(DocumentStatus.PENDING), tone: "bg-yellow-50 text-yellow-900 ring-1 ring-yellow-200" },
    { label: "Approved", value: count(DocumentStatus.APPROVED), tone: "bg-emerald-50 text-emerald-900 ring-1 ring-emerald-200" },
    { label: "Rejected", value: count(DocumentStatus.CANCELLED), tone: "bg-rose-50 text-rose-900 ring-1 ring-rose-200" },
  ];
}

/** Page title that follows the active filters, e.g. "Material Req - Cash". */
export function describeFilters(filters: ListFilters, documentTypes: Array<{ code: string; name: string; subtypes: Array<{ code: string; name: string }> }>): string {
  const type = documentTypes.find((candidate) => candidate.code === filters.documentType);
  if (!type) return "";
  const subtype = type.subtypes.find((candidate) => candidate.code === filters.documentSubtype);
  return subtype ? `${type.name} - ${subtype.name}` : type.name;
}
