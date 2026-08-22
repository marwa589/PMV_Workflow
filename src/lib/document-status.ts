import { DocumentStatus } from "@prisma/client";

export type DocumentTypeFilter = "COMPARISON" | "MATERIAL_REQUISITION" | "";

export const DOCUMENT_STATUS_FILTER_OPTIONS: Array<{ value: DocumentStatus; label: string }> = [
  { value: DocumentStatus.PENDING_APPROVER_1, label: "Pending PMV Engineer" },
  { value: DocumentStatus.PENDING_APPROVER_2, label: "Pending Workshop Manager" },
  { value: DocumentStatus.PENDING_APPROVER_3, label: "Pending PMV Manager" },
  { value: DocumentStatus.APPROVED, label: "Approved" },
  { value: DocumentStatus.REJECTED, label: "Rejected" },
  { value: DocumentStatus.REVISION_REQUIRED, label: "Revision Required" },
  { value: DocumentStatus.ARCHIVED, label: "Archived" },
];

export function parseDocumentStatusFilter(value: unknown): DocumentStatus | "" {
  if (typeof value !== "string" || value.length === 0) {
    return "";
  }

  if (DOCUMENT_STATUS_FILTER_OPTIONS.some((option) => option.value === value)) {
    return value as DocumentStatus;
  }

  return "";
}

export function parseDocumentTypeFilter(value: unknown): DocumentTypeFilter {
  if (typeof value !== "string" || value.length === 0) {
    return "";
  }

  if (value === "COMPARISON" || value === "MATERIAL_REQUISITION") {
    return value;
  }

  return "";
}
