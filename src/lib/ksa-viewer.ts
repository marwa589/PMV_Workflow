import { UserRole } from "@prisma/client";

export const KSA_USER_LOCATIONS = ["AVR", "AVK"] as const;

export function isKsaViewer(user: { role: UserRole }): boolean {
  return user.role === UserRole.KSA_VIEWER;
}