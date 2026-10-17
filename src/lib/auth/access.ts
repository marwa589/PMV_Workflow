import "server-only";

import { ApproverType, type Prisma, type PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { USER_TYPE, type UserTypeCode } from "@/lib/auth/roles";

export type Db = PrismaClient | Prisma.TransactionClient;

// What a permission or an approver entry is being checked against.
// A column left out (null/undefined) means "not part of this check".
export type ScopeContext = {
  projectId?: string | null;
  locationId?: string | null;
  documentTypeId?: string | null;
  documentSubtypeId?: string | null;
  processDefinitionId?: string | null;
};

export type AssignmentScope = {
  companyId: string | null;
  projectId: string | null;
  locationId: string | null;
  documentTypeId: string | null;
  documentSubtypeId: string | null;
  processDefinitionId: string | null;
  projectScopes?: Array<{ projectId: string }>;
  documentTypeScopes?: Array<{
    documentTypeId: string;
    allSubtypes: boolean;
    subtypes: Array<{ documentSubtypeId: string }>;
  }>;
  processScopes?: Array<{ processDefinitionId: string }>;
};

export const ASSIGNMENT_SCOPE_SELECT = {
  companyId: true,
  projectId: true,
  locationId: true,
  documentTypeId: true,
  documentSubtypeId: true,
  processDefinitionId: true,
  projectScopes: { select: { projectId: true } },
  documentTypeScopes: {
    select: {
      documentTypeId: true,
      allSubtypes: true,
      subtypes: { select: { documentSubtypeId: true } },
    },
  },
  processScopes: { select: { processDefinitionId: true } },
} as const;

/**
 * An assignment covers a context when every scope column it sets equals the context value.
 * An empty column means "no restriction on that item" (PDF).
 * A company-scoped assignment never matches: projects and documents do not belong to a company.
 */
export function assignmentMatchesScope(assignment: AssignmentScope, ctx: ScopeContext): boolean {
  if (assignment.companyId) return false;
  if (assignment.locationId && assignment.locationId !== ctx.locationId) return false;

  const projectIds = [
    ...(assignment.projectId ? [assignment.projectId] : []),
    ...(assignment.projectScopes ?? []).map((scope) => scope.projectId),
  ];
  if (projectIds.length > 0 && (!ctx.projectId || !projectIds.includes(ctx.projectId))) return false;

  if (assignment.documentTypeId && assignment.documentTypeId !== ctx.documentTypeId) return false;
  if (assignment.documentSubtypeId && assignment.documentSubtypeId !== ctx.documentSubtypeId) return false;

  const typeScopes = assignment.documentTypeScopes ?? [];
  if (typeScopes.length > 0) {
    const matchingType = typeScopes.find((scope) => scope.documentTypeId === ctx.documentTypeId);
    if (!matchingType) return false;
    if (
      !matchingType.allSubtypes &&
      (!ctx.documentSubtypeId || !matchingType.subtypes.some((subtype) => subtype.documentSubtypeId === ctx.documentSubtypeId))
    ) {
      return false;
    }
  }

  const processIds = [
    ...(assignment.processDefinitionId ? [assignment.processDefinitionId] : []),
    ...(assignment.processScopes ?? []).map((scope) => scope.processDefinitionId),
  ];
  return processIds.length === 0 || (!!ctx.processDefinitionId && processIds.includes(ctx.processDefinitionId));
}

/** Does the user hold `permissionCode` through an assignment that covers `scope`? Admin type bypasses scope. */
export async function userHasPermission(
  user: { userId: string; userType: UserTypeCode },
  permissionCode: string,
  scope: ScopeContext = {},
  db: Db = prisma,
): Promise<boolean> {
  if (user.userType === USER_TYPE.ADMIN) return true;

  const assignments = await db.userAssignment.findMany({
    where: {
      userId: user.userId,
      role: { permissions: { some: { permission: { code: permissionCode } } } },
    },
    select: ASSIGNMENT_SCOPE_SELECT,
  });

  return assignments.some((assignment) => assignmentMatchesScope(assignment, scope));
}

/** Users whose approval tasks are currently delegated to `userId`. */
export async function getDelegatorIds(db: Db, userId: string): Promise<string[]> {
  const rows = await db.approvalDelegation.findMany({
    where: {
      delegateUserId: userId,
      OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
    },
    select: { delegatorUserId: true },
  });
  return rows.map((row) => row.delegatorUserId);
}

/** Converts an assignment's scope into a Document filter. Null = this assignment cannot grant document access. */
export function scopeToDocumentWhere(scope: AssignmentScope): Prisma.DocumentWhereInput | null {
  if (scope.companyId || scope.processDefinitionId || (scope.processScopes?.length ?? 0) > 0) return null;

  const and: Prisma.DocumentWhereInput[] = [];
  const projectIds = [
    ...(scope.projectId ? [scope.projectId] : []),
    ...(scope.projectScopes ?? []).map((project) => project.projectId),
  ];
  if (projectIds.length === 1) and.push({ projectId: projectIds[0] });
  else if (projectIds.length > 1) and.push({ projectId: { in: projectIds } });
  if (scope.locationId) and.push({ project: { locationId: scope.locationId } });

  if (scope.documentTypeId) {
    and.push({ documentTypeId: scope.documentTypeId });
    if (scope.documentSubtypeId) and.push({ documentSubtypeId: scope.documentSubtypeId });
  }
  if (scope.documentTypeScopes?.length) {
    and.push({
      OR: scope.documentTypeScopes.map((typeScope) =>
        typeScope.allSubtypes
          ? { documentTypeId: typeScope.documentTypeId }
          : {
              documentTypeId: typeScope.documentTypeId,
              documentSubtypeId: { in: typeScope.subtypes.map((subtype) => subtype.documentSubtypeId) },
            },
      ),
    });
  }

  return and.length > 0 ? { AND: and } : {};
}

/**
 * Which documents a user may see (PDF "Who sees what"):
 *  - Admin: everything.
 *  - Documents they created, and documents they acted on (their own history).
 *  - Documents where a flow names them, or names a user of their type and they hold an
 *    assignment covering the document (also applies to people whose tasks were delegated to them).
 *  - Documents inside the scope of any assignment whose role has documents.view.
 */
export async function buildDocumentVisibilityWhere(
  user: { userId: string; userType: UserTypeCode },
  db: Db = prisma,
  // Which permission a scope-based assignment must carry (documents.view, documents.download, documents.print).
  // Involvement (creator, history, named in the flow) always counts, so approvers can open what they must sign.
  permissionCode = "documents.view",
): Promise<Prisma.DocumentWhereInput> {
  if (user.userType === USER_TYPE.ADMIN) return {};

  const delegatorIds = await getDelegatorIds(db, user.userId);
  const namedIds = [user.userId, ...delegatorIds];

  const candidates = await db.user.findMany({
    where: { id: { in: namedIds } },
    select: { id: true, userTypeId: true, assignments: { select: ASSIGNMENT_SCOPE_SELECT } },
  });

  const clauses: Prisma.DocumentWhereInput[] = [
    { createdById: user.userId },
    { approvals: { some: { performedById: user.userId } } },
    {
      approvalSteps: {
        some: { approvers: { some: { approverType: ApproverType.USER, userId: { in: namedIds } } } },
      },
    },
  ];

  for (const candidate of candidates) {
    const scopeFilters = candidate.assignments
      .map((assignment) => scopeToDocumentWhere(assignment))
      .filter((filter): filter is Prisma.DocumentWhereInput => filter !== null);

    if (scopeFilters.length > 0) {
      clauses.push({
        AND: [
          {
            approvalSteps: {
              some: {
                approvers: { some: { approverType: ApproverType.USER_TYPE, userTypeId: candidate.userTypeId } },
              },
            },
          },
          { OR: scopeFilters },
        ],
      });
    }
  }

  const viewAssignments = await db.userAssignment.findMany({
    where: {
      userId: user.userId,
      role: { permissions: { some: { permission: { code: permissionCode } } } },
    },
    select: ASSIGNMENT_SCOPE_SELECT,
  });

  for (const assignment of viewAssignments) {
    const filter = scopeToDocumentWhere(assignment);
    if (filter) clauses.push(filter);
  }

  return { OR: clauses };
}

/** May this user open (or download / print, via permissionCode) this one document? */
export async function canAccessDocument(
  user: { userId: string; userType: UserTypeCode },
  documentId: string,
  permissionCode = "documents.view",
  db: Db = prisma,
): Promise<boolean> {
  const visibility = await buildDocumentVisibilityWhere(user, db, permissionCode);
  const count = await db.document.count({ where: { AND: [{ id: documentId }, visibility] } });
  return count > 0;
}

/** Permission check scoped to one document (its project, the project's location, type and sub type). */
export async function userHasPermissionForDocument(
  user: { userId: string; userType: UserTypeCode },
  permissionCode: string,
  document: { projectId: string | null; documentTypeId: string; documentSubtypeId: string | null; project?: { locationId: string | null } | null },
  db: Db = prisma,
): Promise<boolean> {
  if (user.userType === USER_TYPE.ADMIN) return true;

  const locationId =
    document.project !== undefined
      ? (document.project?.locationId ?? null)
      : document.projectId
        ? ((await db.project.findUnique({ where: { id: document.projectId }, select: { locationId: true } }))?.locationId ?? null)
        : null;

  return userHasPermission(
    user,
    permissionCode,
    {
      projectId: document.projectId,
      locationId,
      documentTypeId: document.documentTypeId,
      documentSubtypeId: document.documentSubtypeId,
    },
    db,
  );
}

/**
 * Which process runs a user may see: Admin sees all; otherwise runs they started, runs holding a document they
 * can see, and runs inside the scope of an assignment whose role has processes.view (process, project, location).
 */
export async function buildProcessVisibilityWhere(
  user: { userId: string; userType: UserTypeCode },
  db: Db = prisma,
): Promise<Prisma.ProcessInstanceWhereInput> {
  if (user.userType === USER_TYPE.ADMIN) return {};

  const documentVisibility = await buildDocumentVisibilityWhere(user, db);
  const clauses: Prisma.ProcessInstanceWhereInput[] = [
    { startedById: user.userId },
    { stepDocuments: { some: { document: documentVisibility } } },
  ];

  const assignments = await db.userAssignment.findMany({
    where: { userId: user.userId, role: { permissions: { some: { permission: { code: "processes.view" } } } } },
    select: ASSIGNMENT_SCOPE_SELECT,
  });

  for (const assignment of assignments) {
    // Company, document type and sub type scopes cannot be matched against a process run.
    if (assignment.companyId || assignment.documentTypeId || assignment.documentSubtypeId || (assignment.documentTypeScopes?.length ?? 0) > 0) continue;

    const and: Prisma.ProcessInstanceWhereInput[] = [];
    const processIds = [
      ...(assignment.processDefinitionId ? [assignment.processDefinitionId] : []),
      ...(assignment.processScopes ?? []).map((scope) => scope.processDefinitionId),
    ];
    const projectIds = [
      ...(assignment.projectId ? [assignment.projectId] : []),
      ...(assignment.projectScopes ?? []).map((scope) => scope.projectId),
    ];
    if (processIds.length === 1) and.push({ processDefinitionId: processIds[0] });
    else if (processIds.length > 1) and.push({ processDefinitionId: { in: processIds } });
    if (projectIds.length === 1) and.push({ projectId: projectIds[0] });
    else if (projectIds.length > 1) and.push({ projectId: { in: projectIds } });
    if (assignment.locationId) and.push({ project: { locationId: assignment.locationId } });
    clauses.push(and.length > 0 ? { AND: and } : {});
  }

  return { OR: clauses };
}

/**
 * Permission codes the user holds everywhere (through assignments with no scope set).
 * Used to decide which administration screens to show. Admin holds every permission.
 */
export async function getGlobalPermissionCodes(
  user: { userId: string; userType: UserTypeCode },
  db: Db = prisma,
): Promise<string[]> {
  if (user.userType === USER_TYPE.ADMIN) {
    return (await db.permission.findMany({ select: { code: true } })).map((permission) => permission.code);
  }

  const assignments = await db.userAssignment.findMany({
    where: {
      userId: user.userId,
      companyId: null,
      projectId: null,
      locationId: null,
      documentTypeId: null,
      documentSubtypeId: null,
      processDefinitionId: null,
      projectScopes: { none: {} },
      documentTypeScopes: { none: {} },
      processScopes: { none: {} },
    },
    select: { role: { select: { permissions: { select: { permission: { select: { code: true } } } } } } },
  });

  return [...new Set(assignments.flatMap((assignment) => assignment.role.permissions.map((entry) => entry.permission.code)))];
}
