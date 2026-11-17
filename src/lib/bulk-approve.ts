import "server-only";

import { prisma } from "@/lib/prisma";
import { USER_TYPE } from "@/lib/auth/roles";

/**
 * May this user select several pending documents and review them together? Admin users always may; for everyone else
 * an admin switches it on per user (Users page).
 */
export async function userCanBulkApprove(userId: string): Promise<boolean> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { canBulkApprove: true, isActive: true, userType: { select: { code: true } } },
  });
  if (!user?.isActive) return false;
  return user.userType.code === USER_TYPE.ADMIN || user.canBulkApprove;
}
