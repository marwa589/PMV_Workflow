export type DocumentTypeFilter = "COMPARISON" | "MATERIAL_REQUISITION" | "ERR" | "";
export type DownloadStatusFilter = "DOWNLOADED" | "NOT_DOWNLOADED" | "";
export type MrTypeFilter = "CASH" | "CREDIT" | "";
export type ErrTypeFilter = "RENTAL_ACTC" | "RENTAL_EXTERNAL" | "PURCHASE" | "";
export type ErrStatusFilter = "PENDING" | "ON_HOLD" | "REVISION_REQUIRED" | "REJECTED" | "APPROVED" | "";
export type DocumentStatusFilterValue =
  | "PENDING_APPROVER_1"
  | "PENDING_APPROVER_2"
  | "PENDING_APPROVER_3"
  | "APPROVED"
  | "REJECTED"
  | "REVISION_REQUIRED"
  | "ARCHIVED"
  | "";

export const DOCUMENT_STATUS_FILTER_OPTIONS: Array<{ value: DocumentStatusFilterValue; label: string }> = [
  { value: "PENDING_APPROVER_1", label: "Pending PMV Engineer" },
  { value: "PENDING_APPROVER_2", label: "Pending Workshop Manager" },
  { value: "PENDING_APPROVER_3", label: "Pending PMV Manager" },
  { value: "APPROVED", label: "Approved" },
  { value: "REJECTED", label: "Rejected" },
  { value: "REVISION_REQUIRED", label: "Revision Required" },
  { value: "ARCHIVED", label: "Archived" },
];

export const ERR_STATUS_FILTER_OPTIONS: Array<{ value: ErrStatusFilter; label: string }> = [
  { value: "PENDING", label: "Pending" },
  { value: "ON_HOLD", label: "On Hold" },
  { value: "REVISION_REQUIRED", label: "Revision Required" },
  { value: "REJECTED", label: "Rejected" },
  { value: "APPROVED", label: "Approved" },
];

export function parseDocumentStatusFilter(value: unknown): DocumentStatusFilterValue {
  if (typeof value !== "string" || value.length === 0) {
    return "";
  }

  if (DOCUMENT_STATUS_FILTER_OPTIONS.some((option) => option.value === value)) {
    return value as DocumentStatusFilterValue;
  }

  return "";
}

export function parseDocumentTypeFilter(value: unknown): DocumentTypeFilter {
  if (typeof value !== "string" || value.length === 0) {
    return "";
  }

  if (value === "COMPARISON" || value === "MATERIAL_REQUISITION" || value === "ERR") {
    return value;
  }

  return "";
}

export function parseDownloadStatusFilter(value: unknown): DownloadStatusFilter {
  if (value === "DOWNLOADED" || value === "NOT_DOWNLOADED") {
    return value;
  }

  return "";
}

export function parseMrTypeFilter(value: unknown): MrTypeFilter {
  if (value === "CASH" || value === "CREDIT") {
    return value;
  }

  return "";
}

export function parseErrTypeFilter(value: unknown): ErrTypeFilter {
  if (value === "RENTAL_ACTC" || value === "RENTAL_EXTERNAL" || value === "PURCHASE") {
    return value;
  }

  return "";
}

export function parseErrStatusFilter(value: unknown): ErrStatusFilter {
  if (value === "PENDING" || value === "ON_HOLD" || value === "REVISION_REQUIRED" || value === "REJECTED" || value === "APPROVED") {
    return value;
  }

  return "";
}
