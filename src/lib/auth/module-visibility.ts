import type { UserRole } from "@prisma/client";

export type ModuleVisibility = "ERR_ONLY" | "DOCUMENTS_ONLY" | "ALL";

export function getModuleVisibility(_name: string, role: UserRole): ModuleVisibility {
  if (role === "ERR_USER") {
    return "ERR_ONLY";
  }

  if (role === "ADMIN" || role === "APPROVER_3") {
    return "ALL";
  }

  if (role === "CLERK" || role === "APPROVER_1" || role === "APPROVER_2") {
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
