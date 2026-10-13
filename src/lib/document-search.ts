export type SearchableDocument = {
  documentNumber?: string | null;
  title?: string | null;
  status?: string | null;
  statusLabel?: string | null;
  documentTypeName?: string | null;
  documentTypeCode?: string | null;
  documentSubtypeName?: string | null;
  projectName?: string | null;
  projectCode?: string | null;
  currentApproverName?: string | null;
  rejectionComments?: string | null;
  // Text of custom field values (e.g. an MR number) so people can search for them.
  fieldValuesText?: string | null;
};

export function parseSearchQuery(value: unknown): string {
  if (typeof value !== "string") {
    return "";
  }

  return value.trim().toLowerCase();
}

export function matchesDocumentSearch(documentItem: SearchableDocument, query: string): boolean {
  if (!query) {
    return true;
  }

  const searchableText = [
    documentItem.documentNumber,
    documentItem.title,
    documentItem.statusLabel,
    documentItem.documentTypeName,
    documentItem.documentTypeCode,
    documentItem.documentSubtypeName,
    documentItem.projectName,
    documentItem.projectCode,
    documentItem.currentApproverName,
    documentItem.rejectionComments,
    documentItem.fieldValuesText,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);

  if (terms.length === 0) {
    return true;
  }

  return terms.every((term) => searchableText.includes(term));
}
