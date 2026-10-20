export const MOHAMED_AVK_WORKFLOW_UPLOADER_EMAIL = "mohamed.mahran@ahmadiah-sa.com";
export const AVK_WORKFLOW_UPLOADER_EMAILS = [
  MOHAMED_AVK_WORKFLOW_UPLOADER_EMAIL,
  "bernabie.rocha@ahmadiah.com",
] as const;
export const RAMZI_DOCUMENT_APPROVER_EMAIL = "ramzi@ahmadiah.com";
export const MARC_PMV_MANAGER_EMAIL = "marc.baddour@ahmadiah.com";

export function isAvkUploaderWorkflowDocument(
  uploaderEmail: string | null | undefined,
  documentType: string,
): boolean {
  return AVK_WORKFLOW_UPLOADER_EMAILS.includes(uploaderEmail?.trim().toLowerCase() as typeof AVK_WORKFLOW_UPLOADER_EMAILS[number])
    && (documentType === "MATERIAL_REQUISITION" || documentType === "COMPARISON");
}

export function isRamziDocumentApprover(email: string | null | undefined): boolean {
  return email?.trim().toLowerCase() === RAMZI_DOCUMENT_APPROVER_EMAIL;
}