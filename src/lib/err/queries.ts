import "server-only";

import type { Prisma, ErrStage } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  getErrVisibilityWhere,
  type ErrAccess,
} from "@/lib/err/permissions";

export type ErrView =
  | "all"
  | "pending"
  | "on-hold"
  | "approved"
  | "rejected"
  | "revision-required";

export function getErrViewWhere(
  access: ErrAccess,
  view: ErrView,
): Prisma.ErrWhereInput {
  const visibility = getErrVisibilityWhere(access);

  // These users track the document's overall status.
  const tracksAll = access.isAdmin || access.isWorkshopManager|| access.isGlobalUploader || access.isGlobalViewer || access.isUploader;

  let filter: Prisma.ErrWhereInput = {};

  if (tracksAll) {
    switch (view) {
      case "pending":
        filter = { status: "PENDING" };
        break;
      case "on-hold":
        filter = { status: "ON_HOLD" };
        break;
      case "approved":
        filter = { status: "APPROVED" };
        break;
      case "rejected":
        filter = { status: "REJECTED" };
        break;
      case "revision-required":
        filter = { status: "REVISION_REQUIRED" };
        break;
    }
  } else {
    const stages: ErrStage[] = [];

    if (access.isProjectDirector) stages.push("PROJECT_DIRECTOR" as const);
    if (access.isProjectManager && !access.isProjectDirector) {
      stages.push("PROJECT_DIRECTOR" as const);
    }
    if (access.isPmvManager) stages.push("PMV_MANAGER" as const);
    if (access.isActingCeo) stages.push("ACTING_CEO" as const);
    if (access.isCeo) stages.push("CEO" as const);

    switch (view) {
      case "pending":
        filter = {
          status: "PENDING",
          currentApproverId: access.userId,
          currentStage: { in: stages },
        };
        break;

      case "on-hold":
        filter = {
          status: "ON_HOLD",
          currentApproverId: access.userId,
          currentStage: { in: stages },
        };
        break;

      case "approved":
        filter = {
          approvalHistory: {
            some: {
              performedById: access.userId,
              stage: { in: stages },
              action: "APPROVED",
            },
          },
        };
        break;

      case "rejected":
        filter = {
          approvalHistory: {
            some: {
              performedById: access.userId,
              stage: { in: stages },
              action: "REJECTED",
            },
          },
        };
        break;

      case "revision-required":
        filter = {
          status: "REVISION_REQUIRED",
          approvalHistory: {
            some: {
              performedById: access.userId,
              stage: { in: stages },
              action: "REQUESTED_REVISION",
            },
          },
        };
        break;
    }
  }

  return {
    AND: [visibility, filter],
  };
}

export async function getErrCounts(access: ErrAccess) {
  const [
    all,
    pending,
    onHold,
    approved,
    rejected,
    revisionRequired,
  ] = await Promise.all([
    prisma.err.count({
      where: getErrViewWhere(access, "all"),
    }),
    prisma.err.count({
      where: getErrViewWhere(access, "pending"),
    }),
    prisma.err.count({
      where: getErrViewWhere(access, "on-hold"),
    }),
    prisma.err.count({
      where: getErrViewWhere(access, "approved"),
    }),
    prisma.err.count({
      where: getErrViewWhere(access, "rejected"),
    }),
    prisma.err.count({
      where: getErrViewWhere(access, "revision-required"),
    }),
  ]);

  return {
    all,
    pending,
    onHold,
    approved,
    rejected,
    revisionRequired,
  };
}