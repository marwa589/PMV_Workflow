import "server-only";

import {
  ErrAccessRole,
  ErrStage,
  ErrType,
  UserRole,
} from "@prisma/client";
import type { Prisma } from "@prisma/client";

const RENTAL_STAGES: readonly ErrStage[] = [
  ErrStage.PROJECT_DIRECTOR,
  ErrStage.PMV_MANAGER,
];

const PURCHASE_STAGES: readonly ErrStage[] = [
  ErrStage.PROJECT_DIRECTOR,
  ErrStage.PMV_MANAGER,
  ErrStage.ACTING_CEO,
  ErrStage.CEO,
];

export function getErrStages(type: ErrType): readonly ErrStage[] {
  switch (type) {
    case ErrType.RENTAL_ACTC:
    case ErrType.RENTAL_EXTERNAL:
      return RENTAL_STAGES;

    case ErrType.PURCHASE:
      return PURCHASE_STAGES;

    default:
      throw new Error("Unknown ERR type.");
  }
}

export function getNextErrStage(
  type: ErrType,
  currentStage: ErrStage,
): ErrStage | null {
  const stages = getErrStages(type);
  const currentIndex = stages.indexOf(currentStage);

  if (currentIndex === -1) {
    throw new Error("This approval stage is not valid for this ERR type.");
  }

  return stages[currentIndex + 1] ?? null;
}
export async function resolveErrApprover(
  tx: Prisma.TransactionClient,
  stage: ErrStage,
  projectDirectorId: string,
  projectId?: string | null,
): Promise<string> {
  let where: Prisma.UserWhereInput;

  switch (stage) {
    case ErrStage.PROJECT_DIRECTOR:
      where = {
        id: projectDirectorId,
        errAccess: {
          some: {
            role: ErrAccessRole.PROJECT_DIRECTOR,
            isActive: true,
            ...(projectId ? { OR: [{ projectId }, { projectId: null }] } : {}),
          },
        },
      };
      break;

    case ErrStage.PMV_MANAGER:
      where = {
        role: UserRole.APPROVER_3,
      };
      break;

    case ErrStage.ACTING_CEO:
      where = {
        errAccess: {
          some: {
            role: ErrAccessRole.ACTING_CEO,
            isActive: true,
          },
        },
      };
      break;

    case ErrStage.CEO:
      where = {
        errAccess: {
          some: {
            role: ErrAccessRole.CEO,
            isActive: true,
          },
        },
      };
      break;

    default:
      throw new Error("Unknown ERR approval stage.");
  }

  const users = await tx.user.findMany({
    where,
    select: {
      id: true,
    },
    take: 2,
  });

  if (users.length === 0) {
    throw new Error(
      `No eligible approver is configured for stage ${stage}.`,
    );
  }

  if (users.length > 1) {
    throw new Error(
      `More than one eligible approver is configured for stage ${stage}.`,
    );
  }

  return users[0].id;
}