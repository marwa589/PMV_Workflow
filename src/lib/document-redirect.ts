import type { UserRole } from "@prisma/client";
import { MARC_PMV_MANAGER_EMAIL } from "@/lib/mohamed-document-workflow";

export type RedirectFallbackValue = "FULLY_APPROVE" | "BACK_TO_REDIRECTOR";

export const REDIRECT_FALLBACK_OPTIONS: Array<{ value: RedirectFallbackValue; label: string }> = [
  { value: "FULLY_APPROVE", label: "Fully approve" },
  { value: "BACK_TO_REDIRECTOR", label: "Back to me" },
];

/** Only Marc Baddour can redirect a document to another user. */
export function canRedirectDocuments(email: string | null | undefined): boolean {
  return email?.trim().toLowerCase() === MARC_PMV_MANAGER_EMAIL;
}

export function parseRedirectFallback(value: unknown): RedirectFallbackValue | null {
  return value === "FULLY_APPROVE" || value === "BACK_TO_REDIRECTOR" ? value : null;
}

/** True when the document is currently with the person Marc redirected it to. */
export function isRedirectedToUser(
  document: { redirectedById?: string | null; currentApproverId?: string | null },
  userId: string,
): boolean {
  return Boolean(document.redirectedById) && document.currentApproverId === userId;
}

/**
 * KSA viewers are read-only everywhere (the actions API refuses them), so they cannot be
 * redirect targets. Everyone else in the system can be picked.
 */
export function isRedirectTargetRole(role: UserRole): boolean {
  return role !== "KSA_VIEWER";
}

export function redirectedStatusLabel(currentApproverName: string | null | undefined): string {
  return `Redirected to ${currentApproverName?.trim() || "another user"}`;
}
