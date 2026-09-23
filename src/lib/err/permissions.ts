import "server-only";
import { ErrAccessRole, UserRole } from "@prisma/client";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";
import { getModuleVisibility } from "@/lib/auth/module-visibility";
import { isErrUploaderAccount } from "@/lib/err/uploader-access";

export async function getErrAccess() {
  const session = await getSession();

  if (!session) {
    return null;
  }

  const user = await prisma.user.findUnique({
    where: {
      id: session.userId,
    },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      errAccess: {
        where: {
          isActive: true,
        },
        select: {
          role: true,
          projectId: true,
        },
      },
    },
  });

  if (!user) {
    return null;
  }

  const accessEntries = user.errAccess;
  const roles = accessEntries.map((entry) => entry.role);
  const moduleVisibility = getModuleVisibility(user.name, user.role);

  const isAdmin = user.role === UserRole.ADMIN;
  const isPmvManager = user.role === UserRole.APPROVER_3;
  const isNamedUploader = isErrUploaderAccount(user.name, user.role);
  const isUploader = roles.includes(ErrAccessRole.UPLOADER) || isNamedUploader;

  const isProjectManager = roles.includes(ErrAccessRole.PROJECT_MANAGER);

  const projectManagerProjectIds = accessEntries
  .filter((entry) => entry.role === ErrAccessRole.PROJECT_MANAGER && entry.projectId)
  .map((entry) => entry.projectId as string);

  const projectDirectorProjectIds = accessEntries
    .filter((e) => e.role === ErrAccessRole.PROJECT_DIRECTOR && e.projectId)
    .map((e) => e.projectId as string);

  const uploaderProjectIds = accessEntries
    .filter((e) => e.role === ErrAccessRole.UPLOADER && e.projectId)
    .map((e) => e.projectId as string);

  const viewerProjectIds = accessEntries
    .filter((e) => e.role === ErrAccessRole.VIEWER && e.projectId)
    .map((e) => e.projectId as string);

  const isGlobalUploader =
    accessEntries.some((e) => e.role === ErrAccessRole.UPLOADER && !e.projectId) ||
    isNamedUploader ||
    isAdmin;

  const isGlobalViewer = accessEntries.some(
    (e) => e.role === ErrAccessRole.VIEWER && !e.projectId,
  );

  return {
    userId: user.id,
    name: user.name,
    email: user.email,
    role: user.role,

    isAdmin,
    isPmvManager,

    isUploader,
    isGlobalUploader,
    uploaderProjectIds,

    isProjectDirector: roles.includes(ErrAccessRole.PROJECT_DIRECTOR),
    projectDirectorProjectIds,

    isProjectManager,
    projectManagerProjectIds,

    isActingCeo: roles.includes(ErrAccessRole.ACTING_CEO),
    isCeo: roles.includes(ErrAccessRole.CEO),

    isViewer: roles.includes(ErrAccessRole.VIEWER),
    isGlobalViewer,
    viewerProjectIds,

    canAccessErrModule:
      moduleVisibility !== "DOCUMENTS_ONLY" &&
      (isAdmin || isPmvManager || roles.length > 0 || isUploader),
  };
}

export type ErrAccess = NonNullable<
  Awaited<ReturnType<typeof getErrAccess>>
>;

export function canViewErrQuotation(access: ErrAccess): boolean {
  return !access.isProjectDirector && !access.isProjectManager;
}

export async function requireErrAccess() {
  const access = await getErrAccess();

  if (!access) {
    redirect("/login");
  }

  if (!access.canAccessErrModule) {
    redirect("/unauthorized");
  }

  return access;
}
export function getErrVisibilityWhere(
  access: ErrAccess,
): Prisma.ErrWhereInput {
  if (!access.canAccessErrModule) {
    return {
      id: { in: [] },
    };
  }

  // Administrators, global uploaders, global viewers, and PMV Manager see all ERRs.
  if (access.isAdmin || access.isGlobalUploader || access.isGlobalViewer || access.isPmvManager) {
    return {};
  }

  const conditions: Prisma.ErrWhereInput[] = [];
// project managers retain visibility of ERRs in their assigned projects.
   if (access.isProjectManager && access.projectManagerProjectIds.length > 0) {
  conditions.push({
    projectId: { in: access.projectManagerProjectIds },
  });
}
  // Directors retain visibility of their assigned ERRs or projects they direct.
  if (access.isProjectDirector) {
    const directorConds: Prisma.ErrWhereInput[] = [{ projectDirectorId: access.userId }];
    if (access.projectDirectorProjectIds.length > 0) {
      directorConds.push({ projectId: { in: access.projectDirectorProjectIds } });
    }
    conditions.push({ OR: directorConds });
  }

  // Project-specific uploaders see ERRs in their assigned projects or submitted by them.
  if (access.isUploader) {
    conditions.push({ createdById: access.userId });
    if (access.uploaderProjectIds.length > 0) {
      conditions.push({ projectId: { in: access.uploaderProjectIds } });
    }
  }

  // Project-specific viewers see ERRs in their assigned projects.
  if (access.isViewer && access.viewerProjectIds.length > 0) {
    conditions.push({ projectId: { in: access.viewerProjectIds } });
  }

  // Marc sees ERRs currently assigned to him or previously
  // handled by him at the PMV Manager stage.
  if (access.isPmvManager) {
    conditions.push({
      OR: [
        {
          currentStage: "PMV_MANAGER",
          currentApproverId: access.userId,
        },
        {
          approvalHistory: {
            some: {
              performedById: access.userId,
              stage: "PMV_MANAGER",
            },
          },
        },
      ],
    });
  }

  if (access.isActingCeo) {
    conditions.push({
      OR: [
        {
          currentStage: "ACTING_CEO",
          currentApproverId: access.userId,
        },
        {
          approvalHistory: {
            some: {
              performedById: access.userId,
              stage: "ACTING_CEO",
            },
          },
        },
      ],
    });
  }

  if (access.isCeo) {
    conditions.push({
      OR: [
        {
          currentStage: "CEO",
          currentApproverId: access.userId,
        },
        {
          approvalHistory: {
            some: {
              performedById: access.userId,
              stage: "CEO",
            },
          },
        },
      ],
    });
  }

  return conditions.length > 0
    ? { OR: conditions }
    : { id: { in: [] } };
}
export async function canViewErr(
  access: ErrAccess,
  errId: string,
): Promise<boolean> {
  const err = await prisma.err.findFirst({
    where: {
      AND: [
        { id: errId },
        getErrVisibilityWhere(access),
      ],
    },
    select: {
      id: true,
    },
  });

  return err !== null;
}
export async function canApproveErr(
  access: ErrAccess,
  errId: string,
): Promise<boolean> {
  if (!access.canAccessErrModule) {
    return false;
  }

  const err = await prisma.err.findFirst({
    where: {
      AND: [
        { id: errId },
        getErrVisibilityWhere(access),
      ],
    },
    select: {
      status: true,
      type: true,
      currentStage: true,
      currentApproverId: true,
      projectDirectorId: true,
      projectId: true,
    },
  });

  if (!err) {
    return false;
  }

  if (err.status !== "PENDING" && err.status !== "ON_HOLD") {
    return false;
  }

  if (err.currentApproverId !== access.userId) {
    return false;
  }

  switch (err.currentStage) {
    case "PROJECT_DIRECTOR":
  return (
    (access.isProjectDirector &&
      (err.projectDirectorId === access.userId ||
        (err.projectId
          ? access.projectDirectorProjectIds.includes(err.projectId)
          : false))) ||
    (access.isProjectManager &&
      (err.projectId
        ? access.projectManagerProjectIds.includes(err.projectId)
        : false))
  );

    case "PMV_MANAGER":
      return access.isPmvManager;

    case "ACTING_CEO":
      return access.isActingCeo;

    case "CEO":
      return access.isCeo;

    default:
      return false;
  }
}
export async function getAccessibleErrFile(
  access: ErrAccess,
  fileId: string,
) {
  if (!access.canAccessErrModule) {
    return null;
  }

  const file = await prisma.errFile.findFirst({
    where: {
      id: fileId,
      err: {
        is: getErrVisibilityWhere(access),
      },
    },
    select: {
      id: true,
      errId: true,
      kind: true,
      filePath: true,
      originalName: true,
      mimeType: true,
      fileSize: true,
    },
  });

  if (!file) {
    return null;
  }

  if (
    file.kind === "QUOTATION" &&
    !access.isUploader &&
    !access.isAdmin &&
    !access.isPmvManager
  ) {
    return null;
  }

  return file;
}

export function canUploadErrVoucher(access: ErrAccess, errProjectId?: string | null): boolean {
  if (!access.canAccessErrModule) {
    return false;
  }
  if (access.isGlobalUploader || isErrUploaderAccount(access.name, access.role) || access.isAdmin) {
    return true;
  }
  if (access.isUploader && errProjectId && access.uploaderProjectIds.includes(errProjectId)) {
    return true;
  }
  return access.isUploader;
}