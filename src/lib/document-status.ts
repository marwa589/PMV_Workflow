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

// The order documents are listed in: pending first, then revision required, on hold, approved, archived and rejected.
export const DOCUMENT_STATUS_ORDER: Record<string, number> = {
  PENDING: 0,
  REVISION_REQUIRED: 1,
  ON_HOLD: 2,
  APPROVED: 3,
  ARCHIVED: 4,
  CANCELLED: 5,
};

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

// waitingFor: the level goes to the project's Director / Manager, but the project has none yet (and nobody else is on it).
export type LevelInfo = { levelNumber: number | null; name?: string | null; waitingFor?: "PROJECT_DIRECTOR" | "PROJECT_MANAGER" | null };

/**
 * Which missing project role a level is stuck on: only when nobody at all can act on it (no approver entries) and it
 * was marked as waiting for the Project Director / Manager.
 */
export function levelWaitingFor(step: { approvers: unknown[]; awaitingProjectDirector?: boolean; awaitingProjectManager?: boolean } | null | undefined): "PROJECT_DIRECTOR" | "PROJECT_MANAGER" | null {
  if (!step || step.approvers.length > 0) return null;
  if (step.awaitingProjectDirector) return "PROJECT_DIRECTOR";
  if (step.awaitingProjectManager) return "PROJECT_MANAGER";
  return null;
}

/** Display text for a status. A pending document also shows which level it waits at, e.g. "Pending PMV Engineer". */
export function getDocumentStatusDisplay(status: string | null | undefined, level?: LevelInfo | null): string {
  switch (status) {
    case "PENDING": {
      if (!level || level.levelNumber === null) return "Pending";
      if (level.waitingFor === "PROJECT_DIRECTOR") return "Pending Project Director - No PD Assigned";
      if (level.waitingFor === "PROJECT_MANAGER") return "Pending Project Manager - No PM Assigned";
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

/** Every value of a repeated query parameter (?x=a&x=b), already cleaned by `parse` and without duplicates. */
export function parseMultiFilter<T extends string>(value: string | string[] | undefined, parse: (item: unknown) => T | ""): T[] {
  const items = Array.isArray(value) ? value : value === undefined ? [] : [value];
  return [...new Set(items.map((item) => parse(item)).filter((item): item is T => item !== ""))];
}

export function parseDownloadStatusFilter(value: unknown): DownloadStatusFilter {
  return value === "DOWNLOADED" || value === "NOT_DOWNLOADED" ? value : "";
}
