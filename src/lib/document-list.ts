import { DocumentStatus } from "@prisma/client";
import type { DocumentListItem } from "@/components/document-list-table";
import type { DocumentRow } from "@/lib/document-queries";
import { TONE_CLASSES } from "@/lib/status-colors";
import { matchesDocumentSearch, parseSearchQuery } from "@/lib/document-search";
import {
  parseDocumentStatusFilter,
  parseDocumentSubtypeFilter,
  parseDocumentTypeFilter,
  parseDownloadStatusFilter,
  parseMultiFilter,
  parseProjectFilter,
  type DocumentStatusFilterValue,
  type DownloadStatusFilter,
} from "@/lib/document-status";

export type ListSearchParams = Record<string, string | string[] | undefined> | undefined;

// What the filter bar sends in the URL: ?status=&documentType=&documentSubtype=&project=&search=&downloadStatus=&approvalFrom=&approvalTo=
// Status, type, sub type, project and location accept several values (?documentType=MR&documentType=PO);
// an empty list means "all".
export type ListFilters = {
  status: Array<Exclude<DocumentStatusFilterValue, "">>;
  documentType: string[]; // document type codes, e.g. "MR"
  documentSubtype: string[]; // sub type codes, e.g. "CASH"
  project: string[]; // project ids
  location: string[]; // location ids (a document's location is its project's location)
  downloadStatus: DownloadStatusFilter;
  approvalFrom: string;
  approvalTo: string;
  search: string;
};

function first(value: string | string[] | undefined): string {
  return Array.isArray(value) ? (value[0] ?? "") : (value ?? "");
}

const matchesAny = (selected: string[], value: string | null | undefined) => selected.length === 0 || (value != null && selected.includes(value));

export function parseListFilters(params: ListSearchParams): ListFilters {
  return {
    status: parseMultiFilter(params?.status, parseDocumentStatusFilter) as ListFilters["status"],
    documentType: parseMultiFilter(params?.documentType, parseDocumentTypeFilter),
    documentSubtype: parseMultiFilter(params?.documentSubtype, parseDocumentSubtypeFilter),
    project: parseMultiFilter(params?.project, parseProjectFilter),
    location: parseMultiFilter(params?.location, parseProjectFilter),
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
    rejectedByName: row.rejection?.performedByName,
  };
}

export function applyListFilters(rows: DocumentRow[], filters: ListFilters, options: { ignoreStatus?: boolean } = {}): DocumentRow[] {
  const from = filters.approvalFrom ? new Date(filters.approvalFrom).getTime() : null;
  const to = filters.approvalTo ? new Date(filters.approvalTo).getTime() : null;

  return rows
    .filter((row) => options.ignoreStatus || matchesAny(filters.status, row.status))
    .filter((row) => matchesAny(filters.documentType, row.documentType.code))
    .filter((row) => matchesAny(filters.documentSubtype, row.documentSubtype?.code))
    .filter((row) => matchesAny(filters.project, row.project?.id))
    .filter((row) => matchesAny(filters.location, row.project?.locationId))
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
    rejectedByName: row.rejection?.performedByName ?? null,
    processStatus: row.processStatus,
    processStatusLabel: row.processStatusLabel ?? "No Process",
    currentVersion: row.currentVersion,
    currentApproverName: row.currentApprover?.name ?? null,
    currentApproverNames: row.currentApprover?.names ?? [],
    downloadedAt: row.downloadedAt,
    receivedAt: row.receivedAt,
    receiptConfirmationRequired: row.receiptConfirmationRequired,
    approvalDate: row.approvedAt,
    dateLabel: dateFormat.format(row.updatedAt),
    sortTime: row.createdAt.getTime(),
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
    { label: "Pending", value: count(DocumentStatus.PENDING), tone: TONE_CLASSES.yellow },
    { label: "Approved", value: count(DocumentStatus.APPROVED), tone: TONE_CLASSES.blue },
    { label: "Rejected", value: count(DocumentStatus.CANCELLED), tone: TONE_CLASSES.red },
  ];
}

/** Page title that follows the active filters, e.g. "Material Req - Cash". */
export function describeFilters(filters: ListFilters, documentTypes: Array<{ code: string; name: string; subtypes: Array<{ code: string; name: string }> }>): string {
  // A title only makes sense for exactly one type (and at most one sub type).
  if (filters.documentType.length !== 1) return "";
  const type = documentTypes.find((candidate) => candidate.code === filters.documentType[0]);
  if (!type) return "";
  const subtype = filters.documentSubtype.length === 1 ? type.subtypes.find((candidate) => candidate.code === filters.documentSubtype[0]) : undefined;
  return subtype ? `${type.name} - ${subtype.name}` : type.name;
}
