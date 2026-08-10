// import { DocumentStatus } from "@prisma/client";

type DocumentStatus =
  | "PENDING_APPROVER_1"
  | "PENDING_APPROVER_2"
  | "PENDING_APPROVER_3"
  | "APPROVED"
  | "REJECTED"
  | "REVISION_REQUIRED"
  | "ARCHIVED";

export type SearchableDocument = {
  documentNumber?: string | null;
  title?: string | null;
  status?: DocumentStatus | null;
  statusLabel?: string | null;
  documentType?: "COMPARISON" | "MATERIAL_REQUISITION" | null;
  mrType?: "CASH" | "CREDIT" | null;
  mrNumber?: string | null;
  currentApproverName?: string | null;
  rejectionComments?: string | null;
  relatedComparisonDocumentNumber?: string | null;
  relatedComparisonTitle?: string | null;
};

export function parseSearchQuery(value: unknown): string {
  if (typeof value !== "string") {
    return "";
  }

  return value.trim().toLowerCase();
}

export function getDocumentStatusLabel(status?: DocumentStatus | null): string {
  switch (status) {
    case "PENDING_APPROVER_1":
      return "pending approval 1";
    case "PENDING_APPROVER_2":
      return "pending approval 2";
    case "PENDING_APPROVER_3":
      return "pending approval 3";
    case "APPROVED":
      return "approved";
    case "REJECTED":
      return "rejected";
    case "REVISION_REQUIRED":
      return "revision required";
    case "ARCHIVED":
      return "archived";
    default:
      return "";
  }
}

export function matchesDocumentSearch(documentItem: SearchableDocument, query: string): boolean {
  if (!query) {
    return true;
  }

  const searchableText = [
    documentItem.documentNumber,
    documentItem.title,
    documentItem.statusLabel ?? getDocumentStatusLabel(documentItem.status),
    documentItem.documentType === "MATERIAL_REQUISITION"
      ? "material requisition mr"
      : documentItem.documentType === "COMPARISON"
        ? "comparison sheet"
        : "",
    documentItem.mrType === "CASH" ? "cash" : documentItem.mrType === "CREDIT" ? "credit" : "",
    documentItem.mrNumber,
    documentItem.relatedComparisonDocumentNumber,
    documentItem.relatedComparisonTitle,
    documentItem.currentApproverName,
    documentItem.rejectionComments,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  const normalizedQuery = query.trim().toLowerCase();
  const terms = normalizedQuery.split(/\s+/).filter(Boolean);

  if (terms.length === 0) {
    return true;
  }

  return terms.every((term) => searchableText.includes(term));
}
