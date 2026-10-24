import "server-only";

import { prisma } from "@/lib/prisma";

/** May this user select several pending documents and approve them together? (Set per user by an admin.) */
export async function userCanBulkApprove(userId: string): Promise<boolean> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { canBulkApprove: true, isActive: true } });
  return Boolean(user?.isActive && user.canBulkApprove);
}
