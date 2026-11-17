import type { Prisma } from "@prisma/client";

export const MOHAMED_AVK_WORKFLOW_UPLOADER_EMAIL = "mohamed.mahran@ahmadiah-sa.com";
export const AVK_WORKFLOW_UPLOADER_EMAILS = [
  MOHAMED_AVK_WORKFLOW_UPLOADER_EMAIL,
  "bernabie.rocha@ahmadiah.com",
] as const;
export const RAMZI_DOCUMENT_APPROVER_EMAIL = "ramzi@ahmadiah.com";
export const MARC_PMV_MANAGER_EMAIL = "marc.baddour@ahmadiah.com";

/** Erro (an AVR account) can also upload AVK MRs and comparisons; those are stored with uploaderLocation = AVK. */
export const ERRO_AVK_WORKFLOW_UPLOADER_EMAIL = "dispatcher.pmv@ahmadiah.com";

/**
 * True for an MR / comparison in the AVK uploader flow (MR: Ramzi then Marc).
 * Pass the document's uploaderLocation so Erro's AVK uploads are recognised; his AVR uploads are not AVK.
 */
export function isAvkUploaderWorkflowDocument(
  uploaderEmail: string | null | undefined,
  documentType: string,
  uploaderLocation?: string | null,
): boolean {
  if (documentType !== "MATERIAL_REQUISITION" && documentType !== "COMPARISON") return false;
  const email = uploaderEmail?.trim().toLowerCase();
  return AVK_WORKFLOW_UPLOADER_EMAILS.includes(email as typeof AVK_WORKFLOW_UPLOADER_EMAILS[number])
    || (email === ERRO_AVK_WORKFLOW_UPLOADER_EMAIL && uploaderLocation === "AVK");
}

/** Prisma filter matching the uploader side of isAvkUploaderWorkflowDocument (document type not included). */
export function avkUploaderWorkflowCreatorWhere(): Prisma.DocumentWhereInput {
  return {
    OR: [
      { createdBy: { email: { in: [...AVK_WORKFLOW_UPLOADER_EMAILS] } } },
      { createdBy: { email: ERRO_AVK_WORKFLOW_UPLOADER_EMAIL }, uploaderLocation: "AVK" },
    ],
  };
}

export function isRamziDocumentApprover(email: string | null | undefined): boolean {
  return email?.trim().toLowerCase() === RAMZI_DOCUMENT_APPROVER_EMAIL;
}

export const PROJECT_DIRECTOR_STAGE_LABEL = "Project Director";

/**
 * True when the approver is Ramzi, who acts as Project Director in the AVK MR / comparison flow.
 * Email is preferred; the name check is only a fallback for list views that don't load the email.
 */
export function isProjectDirectorApprover(approver: { email?: string | null; name?: string | null } | null | undefined): boolean {
  if (!approver) return false;
  if (approver.email) return isRamziDocumentApprover(approver.email);
  return Boolean(approver.name && approver.name.trim().toLowerCase().includes("ramzi"));
}

/** Label override for a PENDING_APPROVER_1 document currently assigned to Ramzi; undefined means "use the default". */
export function getPendingApprover1LabelOverride(
  status: string,
  approver: { email?: string | null; name?: string | null } | null | undefined,
): string | undefined {
  return status === "PENDING_APPROVER_1" && isProjectDirectorApprover(approver)
    ? `Pending ${PROJECT_DIRECTOR_STAGE_LABEL}`
    : undefined;
}