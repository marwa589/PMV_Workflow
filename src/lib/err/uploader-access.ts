import type { UserRole } from "@prisma/client";

export const GLOBAL_ERR_UPLOADER_EMAILS = [
  "reine.alsouki@ahmadiah.com",
  "edmond.houeiss@ahmadiah.com",
] as const;

function normalizeName(name: string): string {
  return name.trim().toLocaleLowerCase().replace(/\s+/g, " ");
}

export function isErrUploaderAccount(name: string, role: UserRole): boolean {
  if (role !== "ERR_USER") {
    return false;
  }

  const normalized = normalizeName(name);
  return normalized === "reine al souki" || normalized === "edmond houeiss";
}

export function isKsaErrUploaderAccount(email: string): boolean {
  return ["mohamed.mahran@ahmadiah-sa.com", "bernabie.rocha@ahmadiah.com"]
    .includes(email.trim().toLowerCase());
}
