// Statuses follow the PDF: pending (at some level), revision, on hold, approved, cancelled (rejected), archived.
// "Pending at which level" is no longer part of the status; it is the document's currentWorkflowStep,
// and the level's name comes from the approval flow.
export type DocumentStatusValue =
  | "PENDING"
  | "REVISION_REQUIRED"
  | "ON_HOLD"
  | "APPROVED"
  | "CANCELLED"
  | "ARCHIVED";

export type DocumentStatusFilterValue = DocumentStatusValue | "";
export type DownloadStatusFilter = "DOWNLOADED" | "NOT_DOWNLOADED" | "";

// Document type, sub type and project are data now, so their filters are just the selected code / id.
export type DocumentTypeFilter = string;
export type DocumentSubtypeFilter = string;
export type ProjectFilter = string;

export const DOCUMENT_STATUS_FILTER_OPTIONS: Array<{ value: DocumentStatusValue; label: string }> = [
  { value: "PENDING", label: "Pending" },
  { value: "ON_HOLD", label: "On Hold" },
  { value: "REVISION_REQUIRED", label: "Revision Required" },
  { value: "APPROVED", label: "Approved" },
  { value: "CANCELLED", label: "Rejected" },
  { value: "ARCHIVED", label: "Archived" },
];

export type LevelInfo = { levelNumber: number | null; name?: string | null };

/** Display text for a status. A pending document also shows which level it waits at, e.g. "Pending PMV Engineer". */
export function getDocumentStatusDisplay(status: string | null | undefined, level?: LevelInfo | null): string {
  switch (status) {
    case "PENDING": {
      if (!level || level.levelNumber === null) return "Pending";
      const levelLabel = level.name?.trim() || `Level ${level.levelNumber}`;
      return `Pending ${levelLabel}`;
    }
    case "ON_HOLD":
      return "On Hold";
    case "REVISION_REQUIRED":
      return "Revision Required";
    case "APPROVED":
      return "Approved";
    case "CANCELLED":
      return "Rejected";
    case "ARCHIVED":
      return "Archived";
    default:
      return "";
  }
}

export function parseDocumentStatusFilter(value: unknown): DocumentStatusFilterValue {
  if (typeof value !== "string" || value.length === 0) return "";
  return DOCUMENT_STATUS_FILTER_OPTIONS.some((option) => option.value === value)
    ? (value as DocumentStatusValue)
    : "";
}

function parseSafeToken(value: unknown): string {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  return /^[A-Za-z0-9_-]{1,64}$/.test(trimmed) ? trimmed : "";
}

/** The document type's code (e.g. "MR"). Validity is checked against the database when the query runs. */
export function parseDocumentTypeFilter(value: unknown): DocumentTypeFilter {
  return parseSafeToken(value);
}

export function parseDocumentSubtypeFilter(value: unknown): DocumentSubtypeFilter {
  return parseSafeToken(value);
}

/** A project id. */
export function parseProjectFilter(value: unknown): ProjectFilter {
  return parseSafeToken(value);
}

export function parseDownloadStatusFilter(value: unknown): DownloadStatusFilter {
  return value === "DOWNLOADED" || value === "NOT_DOWNLOADED" ? value : "";
}
