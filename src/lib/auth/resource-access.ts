import { UserRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getModuleVisibility } from "@/lib/auth/module-visibility";
import { hasUserRole } from "@/lib/user-capabilities";
import { canViewReadyMixKhobarMrs, isReadyMixKhobarWorkflowDocument } from "@/lib/ready-mix-mr-access";
import { isKsaViewer, KSA_USER_LOCATIONS } from "@/lib/ksa-viewer";
import { isAvkUploaderWorkflowDocument, isRamziDocumentApprover } from "@/lib/mohamed-document-workflow";
import { isAvkMrViewer } from "@/lib/avk-access";

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
    email === "mohamed.mahran@ahmadiah-sa.com";
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
    UserRole.KSA_VIEWER,
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
  const document = await prisma.document.findUnique({
    where: {
      id: documentId,
    },
    select: {
      id: true,
      createdById: true,
      currentApproverId: true,
      documentType: true,
      projectName: true,
      uploaderLocation: true,
      createdBy: { select: { email: true, location: true } },
    },
  });

  if (!document) {
    return false;
  }

  if (
    (document.documentType === "MATERIAL_REQUISITION" || document.documentType === "COMPARISON")
    && (document.uploaderLocation === "AVK" || document.createdBy.location === "AVK")
    && isAvkMrViewer({ email: session.email, location: (await prisma.user.findUnique({ where: { id: session.userId }, select: { location: true } }))?.location, role: session.role })
  ) {
    return true;
  }

  if (
    isRamziDocumentApprover(session.email)
    && document.currentApproverId === session.userId
    && document.documentType === "MATERIAL_REQUISITION"
    && isAvkUploaderWorkflowDocument(document.createdBy.email, document.documentType)
  ) {
    return true;
  }

  if (isKsaViewer(session)) {
    if (document.documentType !== "MATERIAL_REQUISITION" && document.documentType !== "COMPARISON") return false;
    const uploader = await prisma.user.findUnique({
      where: { id: document.createdById },
      select: { location: true },
    });
    return Boolean(uploader?.location && KSA_USER_LOCATIONS.includes(uploader.location as typeof KSA_USER_LOCATIONS[number]));
  }

  if (canViewReadyMixKhobarMrs(session) && isReadyMixKhobarWorkflowDocument(document)) {
    return true;
  }

  if (!canAccessMrModuleForSession(session)) {
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
