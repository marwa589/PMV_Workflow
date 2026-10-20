import { UserRole } from "@prisma/client";

export const READY_MIX_KHOBAR_PROJECT_NAME = "Ready Mix Khobar";

const READY_MIX_KHOBAR_VIEWER_EMAILS = new Set([
  "dispatcher.pmv@ahmadiah.com",
  "elie.azzam@ahmadiah.com",
  "omar.merzek@ahmadiah.com",
]);

export function canViewReadyMixKhobarMrs(user: { role: UserRole; email?: string | null }): boolean {
  return user.role === UserRole.ADMIN
    || user.role === UserRole.APPROVER_3
    || READY_MIX_KHOBAR_VIEWER_EMAILS.has(user.email?.trim().toLowerCase() || "");
}

export function isReadyMixKhobarMr(document: {
  documentType: string;
  projectName?: string | null;
}): boolean {
  return document.documentType === "MATERIAL_REQUISITION"
    && document.projectName === READY_MIX_KHOBAR_PROJECT_NAME;
}

export function isReadyMixKhobarWorkflowDocument(document: {
  documentType: string;
  projectName?: string | null;
}): boolean {
  return (document.documentType === "MATERIAL_REQUISITION" || document.documentType === "COMPARISON")
    && document.projectName === READY_MIX_KHOBAR_PROJECT_NAME;
}