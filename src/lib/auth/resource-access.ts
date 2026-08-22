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
    },
  });

  if (!document) {
    return false;
  }

  return true;
}

export async function canAccessPackage(session: AuthSessionLike, documentId: string): Promise<boolean> {
  return canAccessDocument(session, documentId);
}
