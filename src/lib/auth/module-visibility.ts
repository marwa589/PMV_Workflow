import type { UserRole } from "@prisma/client";

export type ModuleVisibility = "ERR_ONLY" | "DOCUMENTS_ONLY" | "ALL";

const DOCUMENT_ONLY_NAMES = new Set([
  "omar merzek",
  "george azzi",
  "aqueel sayed",
  "jad",
  "mohamed mahmoud",
  "mohammad mahmoud",
  "mohammad mehieddine",
  "mohammad mehialddine",
]);

function normalizedName(name: string): string {
  return name.trim().toLocaleLowerCase().replace(/\s+/g, " ");
}

export function getModuleVisibility(name: string, role: UserRole): ModuleVisibility {
  const normalized = normalizedName(name);

  if (role === "ERR_USER" || normalized === "edmond houeiss" || normalized === "reine al souki") {
    return "ERR_ONLY";
  }

  if (role === "ADMIN" || role === "APPROVER_3" || normalized === "marc baddour" || normalized === "marwa mehielddine") {
    return "ALL";
  }

  if (DOCUMENT_ONLY_NAMES.has(normalized) || role === "CLERK" || role === "APPROVER_1" || role === "APPROVER_2") {
    return "DOCUMENTS_ONLY";
  }

  return "DOCUMENTS_ONLY";
}

export function canAccessDocuments(name: string, role: UserRole): boolean {
  return getModuleVisibility(name, role) !== "ERR_ONLY";
}

export function canAccessErrs(name: string, role: UserRole): boolean {
  return getModuleVisibility(name, role) !== "DOCUMENTS_ONLY";
}
