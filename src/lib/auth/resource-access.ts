import { UserRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";

export type AuthSessionLike = {
  userId: string;
  role: UserRole;
};

export async function canAccessDocument(session: AuthSessionLike, documentId: string): Promise<boolean> {
  const document = await prisma.document.findUnique({
    where: { id: documentId },
    select: {
      id: true,
      createdById: true,
      currentApproverId: true,
      status: true,
    },
  });

  if (!document) {
    return false;
  }

  if (session.role === UserRole.ADMIN) {
    return true;
  }

  if (session.role === UserRole.CLERK) {
    return document.createdById === session.userId;
  }

  if (session.role === UserRole.APPROVER_1 || session.role === UserRole.APPROVER_2 || session.role === UserRole.APPROVER_3) {
    return document.currentApproverId === session.userId || document.createdById === session.userId;
  }

  return false;
}

export async function canAccessPackage(session: AuthSessionLike, documentId: string): Promise<boolean> {
  return canAccessDocument(session, documentId);
}
