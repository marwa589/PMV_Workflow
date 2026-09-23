import { UserRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getModuleVisibility } from "@/lib/auth/module-visibility";
import { hasUserRole } from "@/lib/user-capabilities";

export type AuthSessionLike = {
  userId: string;
  name: string;
  role: UserRole;
  roles?: UserRole[];
  email?: string | null;
};

export function isErroUser(user: { name?: string | null; email?: string | null; role?: UserRole }): boolean {
  const email = user.email?.trim().toLowerCase();
  const name = user.name?.trim().toLowerCase().replace(/\s+/g, " ");
  return email === "dispatcher.pmv@ahmadiah.com" || name === "erro almacen";
}

export function isAvkUploader(user: { email?: string | null }): boolean {
  const email = user.email?.trim().toLowerCase();
  return email === "joemar.paraiso@ahmadiah.com" ||
    email === "bernabie.rocha@ahmadiah.com" ||
    email === "mohamed.mahran@ahmadiah.com";
}

export function isRestrictedClerk(user: { name?: string | null; email?: string | null; role?: UserRole }): boolean {
  return isErroUser(user) || isAvkUploader(user);
}

export function canAccessMrModule(role: UserRole | { role: UserRole; roles?: UserRole[] | null }): boolean {
  const allowedRoles: UserRole[] = [
    UserRole.CLERK,
    UserRole.APPROVER_1,
    UserRole.APPROVER_2,
    UserRole.APPROVER_3,
    UserRole.ADMIN,
  ];

  if (typeof role === "object") {
    return allowedRoles.some((allowedRole) => hasUserRole(role, allowedRole));
  }

  return allowedRoles.includes(role);
}

export function canAccessMrModuleForSession(session: AuthSessionLike): boolean {
  return canAccessMrModule(session) && getModuleVisibility(session.name, session.role) !== "ERR_ONLY";
}

export async function canAccessDocument(
  session: AuthSessionLike,
  documentId: string,
): Promise<boolean> {
  if (!canAccessMrModuleForSession(session)) {
    return false;
  }

  const document = await prisma.document.findUnique({
    where: {
      id: documentId,
    },
    select: {
      id: true,
      createdById: true,
    },
  });

  if (!document) {
    return false;
  }

  if (isRestrictedClerk(session) && session.role === UserRole.CLERK) {
    return document.createdById === session.userId;
  }

  return true;
}

export async function canAccessPackage(session: AuthSessionLike, documentId: string): Promise<boolean> {
  return canAccessDocument(session, documentId);
}
