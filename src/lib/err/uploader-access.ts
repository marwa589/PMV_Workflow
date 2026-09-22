import type { UserRole } from "@prisma/client";

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
