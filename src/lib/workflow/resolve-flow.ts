import "server-only";

import { ApproverType } from "@prisma/client";
import type { Db } from "@/lib/auth/access";

export type FlowStepEntry = {
  approverType: ApproverType;
  userId: string | null;
  userTypeId: string | null;
  // Set when this USER entry stands for the project's director / manager (resolved from a PROJECT_DIRECTOR /
  // PROJECT_MANAGER flow entry).
  viaProjectDirector?: boolean;
  viaProjectManager?: boolean;
};

export type FlowTrackEntry = {
  name: string;
  receiverUserId: string;
  returnLevel: number | null;
  signatureRequired: boolean;
  sortOrder: number;
};

export type ResolvedFlow =
  | { kind: "auto"; assignmentId: string | null }
  | {
      kind: "flow";
      assignmentId: string;
      template: {
        id: string;
        code: string;
        name: string;
        steps: Array<{
          stepNumber: number;
          name: string | null;
          signatureRequired: boolean;
          approvers: FlowStepEntry[];
          tracks: FlowTrackEntry[];
          // Project roles the level names that nobody (active) holds on the document's project.
          missingRoles: ProjectRoleType[];
        }>;
      };
    };

/**
 * Which approval flow does a document get? Most specific matching assignment wins (confirmed order):
 *   1. project + sub type   2. project + type   3. sub type (all projects)   4. type (all projects)
 * No match, or a matching row with no flow, means the document is auto-approved on upload.
 */
export async function resolveFlow(
  db: Db,
  ctx: { documentTypeId: string; documentSubtypeId: string | null; projectId: string | null },
): Promise<ResolvedFlow> {
  const subtypeFilter = ctx.documentSubtypeId
    ? [{ documentSubtypeId: null }, { documentSubtypeId: ctx.documentSubtypeId }]
    : [{ documentSubtypeId: null }];

  const rows = await db.documentWorkflowAssignment.findMany({
    where: { documentTypeId: ctx.documentTypeId, OR: subtypeFilter },
    select: { id: true, documentSubtypeId: true, projectId: true, templateId: true },
  });

  const matching = rows.filter((row) => row.projectId === null || row.projectId === ctx.projectId);

  const rank = (row: { documentSubtypeId: string | null; projectId: string | null }) => {
    if (row.projectId && row.documentSubtypeId) return 1;
    if (row.projectId) return 2;
    if (row.documentSubtypeId) return 3;
    return 4;
  };

  const best = [...matching].sort((a, b) => rank(a) - rank(b))[0];
  if (!best || !best.templateId) {
    return { kind: "auto", assignmentId: best?.id ?? null };
  }

  const template = await db.documentWorkflowTemplate.findUnique({
    where: { id: best.templateId },
    select: {
      id: true,
      code: true,
      name: true,
      steps: {
        orderBy: { stepNumber: "asc" },
        select: {
          stepNumber: true,
          name: true,
          signatureRequired: true,
          approvers: { select: { approverType: true, userId: true, userTypeId: true } },
          tracks: {
            orderBy: { sortOrder: "asc" },
            select: { name: true, receiverUserId: true, returnLevel: true, signatureRequired: true, sortOrder: true },
          },
        },
      },
    },
  });

  if (!template) return { kind: "auto", assignmentId: best.id };

  // "Project Director" / "Project Manager" entries become that person of this document's project (a named user). With
  // no project, or a project without an active holder of that role, the entry is dropped and the level is flagged.
  const usesRoles = template.steps.some((step) => step.approvers.some((entry) => isProjectRoleType(entry.approverType)));
  const holders = usesRoles ? await loadProjectRoleHolders(db, ctx.projectId) : NO_HOLDERS;

  const steps = template.steps.map((step) => {
    const { approvers, missingRoles } = expandProjectRoles(step.approvers, holders);
    return { ...step, approvers, missingRoles };
  });

  return { kind: "flow", assignmentId: best.id, template: { ...template, steps } };
}

// ---- Project roles: Project Director and Project Manager -------------------------------------------------------------

export type ProjectRoleType = typeof ApproverType.PROJECT_DIRECTOR | typeof ApproverType.PROJECT_MANAGER;

/** Each project role: the flow entry type, the marker kept on the document's copy, and its name on screen. */
export const PROJECT_ROLES: Array<{ type: ProjectRoleType; flag: "viaProjectDirector" | "viaProjectManager"; label: string }> = [
  { type: ApproverType.PROJECT_DIRECTOR, flag: "viaProjectDirector", label: "Project Director" },
  { type: ApproverType.PROJECT_MANAGER, flag: "viaProjectManager", label: "Project Manager" },
];

export function isProjectRoleType(type: ApproverType): type is ProjectRoleType {
  return type === ApproverType.PROJECT_DIRECTOR || type === ApproverType.PROJECT_MANAGER;
}

export function projectRoleLabel(type: ProjectRoleType): string {
  return PROJECT_ROLES.find((role) => role.type === type)?.label ?? "Project role";
}

/** Who holds each project role on one project (null = nobody, or the person's account is inactive). */
export type ProjectRoleHolders = Record<ProjectRoleType, string | null>;

const NO_HOLDERS: ProjectRoleHolders = { PROJECT_DIRECTOR: null, PROJECT_MANAGER: null };

type HolderRow = { director: { id: string; isActive: boolean } | null; manager: { id: string; isActive: boolean } | null };

export function holdersOf(project: HolderRow | null | undefined): ProjectRoleHolders {
  if (!project) return NO_HOLDERS;
  return {
    PROJECT_DIRECTOR: project.director?.isActive ? project.director.id : null,
    PROJECT_MANAGER: project.manager?.isActive ? project.manager.id : null,
  };
}

export const PROJECT_ROLE_HOLDER_SELECT = {
  director: { select: { id: true, isActive: true } },
  manager: { select: { id: true, isActive: true } },
} as const;

export async function loadProjectRoleHolders(db: Db, projectId: string | null): Promise<ProjectRoleHolders> {
  if (!projectId) return NO_HOLDERS;
  const project = await db.project.findUnique({ where: { id: projectId }, select: PROJECT_ROLE_HOLDER_SELECT });
  return holdersOf(project);
}

/**
 * Turns project-role entries into named USER entries for the people holding those roles, each marked with its role.
 * Every role keeps its own entry (even when the same person is also named on the level, or holds both roles), so a
 * later change of director or manager can move exactly that entry. `missingRoles`: roles the level names but nobody
 * holds on this project.
 */
export function expandProjectRoles<T extends FlowStepEntry>(entries: T[], holders: ProjectRoleHolders): { approvers: FlowStepEntry[]; missingRoles: ProjectRoleType[] } {
  const approvers: FlowStepEntry[] = [];
  const missingRoles: ProjectRoleType[] = [];
  for (const entry of entries) {
    if (!isProjectRoleType(entry.approverType)) {
      approvers.push(entry);
      continue;
    }
    const role = PROJECT_ROLES.find((item) => item.type === entry.approverType)!;
    const holderId = holders[role.type];
    if (!holderId) {
      if (!missingRoles.includes(role.type)) missingRoles.push(role.type);
      continue;
    }
    if (approvers.some((existing) => existing[role.flag] === true)) continue;
    approvers.push({
      approverType: ApproverType.USER,
      userId: holderId,
      userTypeId: null,
      ...(role.flag === "viaProjectDirector" ? { viaProjectDirector: true } : { viaProjectManager: true }),
    });
  }
  return { approvers, missingRoles };
}
