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
  // The company the project belongs to (Projects & Locations), if any.
  companyId?: string | null;
  documentTypeId?: string | null;
  documentSubtypeId?: string | null;
};

export type AssignmentScope = {
  companyId: string | null;
  projectId: string | null;
  locationId: string | null;
  documentTypeId: string | null;
  documentSubtypeId: string | null;
  projectScopes?: Array<{ projectId: string }>;
  documentTypeScopes?: Array<{
    documentTypeId: string;
    allSubtypes: boolean;
    subtypes: Array<{ documentSubtypeId: string }>;
  }>;
};

export const ASSIGNMENT_SCOPE_SELECT = {
  companyId: true,
  projectId: true,
  locationId: true,
  documentTypeId: true,
  documentSubtypeId: true,
  projectScopes: { select: { projectId: true } },
  documentTypeScopes: {
    select: {
      documentTypeId: true,
      allSubtypes: true,
      subtypes: { select: { documentSubtypeId: true } },
    },
  },
} as const;

/**
 * An assignment covers a context when every scope column it sets equals the context value.
 * An empty column means "no restriction on that item" (PDF).
 * A company-scoped assignment covers the projects that belong to that company (Projects & Locations); a company with
 * no projects covers nothing.
 */
export function assignmentMatchesScope(assignment: AssignmentScope, ctx: ScopeContext): boolean {
  if (assignment.companyId && assignment.companyId !== ctx.companyId) return false;
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

  return true;
}

/**
 * "Manage ..." permissions open a configuration screen for the whole system. A scope set on the assignment does not
 * limit them (a "Flow Admin" role given for one project still opens Approval Flows).
 */
export function isSystemWidePermission(permissionCode: string): boolean {
  return permissionCode.endsWith(".manage");
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

  if (isSystemWidePermission(permissionCode)) return assignments.length > 0;
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
  const and: Prisma.DocumentWhereInput[] = [];
  if (scope.companyId) and.push({ project: { companyId: scope.companyId } });
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
 * Which documents the user may see AS reference documents: Admin all; otherwise those inside the scope of an
 * assignment whose role has documents.view_reference. Nothing when they hold no such assignment.
 */
export async function buildReferenceViewWhere(
  user: { userId: string; userType: UserTypeCode },
  db: Db = prisma,
): Promise<Prisma.DocumentWhereInput> {
  if (user.userType === USER_TYPE.ADMIN) return {};

  const filters = await getViewReferenceFilters(user, db);
  // An id that can never exist keeps the "no permission" case a valid, empty filter.
  return filters.length > 0 ? { OR: filters } : { id: "__no_reference_access__" };
}

/** The scope (as document filters) of every assignment of this user whose role has documents.view_reference. */
async function getViewReferenceFilters(
  user: { userId: string },
  db: Db = prisma,
): Promise<Prisma.DocumentWhereInput[]> {
  const assignments = await db.userAssignment.findMany({
    where: { userId: user.userId, role: { permissions: { some: { permission: { code: "documents.view_reference" } } } } },
    select: ASSIGNMENT_SCOPE_SELECT,
  });
  return assignments
    .map((assignment) => scopeToDocumentWhere(assignment))
    .filter((filter): filter is Prisma.DocumentWhereInput => filter !== null);
}

/**
 * May this user open this REFERENCE document because of the document it is attached to?
 * A reference (a quotation, say) has its own document type, so an assignment scoped to the type of the document
 * it belongs to (a material request, say) never covers it directly. This lets "View reference documents" count
 * when it covers the document the reference is attached to AND the user may see that document.
 */
async function canAccessReferenceThroughParent(
  user: { userId: string; userType: UserTypeCode },
  documentId: string,
  permissionCode: string,
  db: Db,
): Promise<boolean> {
  const target = await db.document.findUnique({ where: { id: documentId }, select: { isReference: true } });
  if (!target?.isReference) return false;

  const filters = await getViewReferenceFilters(user, db);
  if (filters.length === 0) return false;

  const links = await db.processStepReference.findMany({ where: { documentId }, select: { processStepDocument: { select: { documentId: true } } } });
  const parentIds = [...new Set(links.map((link) => link.processStepDocument.documentId))];
  if (parentIds.length === 0) return false;

  const parentVisibility = await buildDocumentVisibilityWhere(user, db, permissionCode);
  const count = await db.document.count({
    where: { AND: [{ id: { in: parentIds } }, { isReference: false }, parentVisibility, { OR: filters }] },
  });
  return count > 0;
}

/** Can this person see reference documents at all (Admin, or a "View reference documents" assignment)? Decides whether the reference column is shown. */
export async function userCanViewReferences(user: { userId: string; userType: UserTypeCode }, db: Db = prisma): Promise<boolean> {
  if (user.userType === USER_TYPE.ADMIN) return true;
  return (await getViewReferenceFilters(user, db)).length > 0;
}

export type ReferenceSummary = Array<{ typeName: string; count: number }>;

/**
 * For a list of documents: the reference documents attached to each one that this user may see, grouped by the type of
 * the reference ("Quotation x 2"). The same rule as getVisibleReferenceDocuments, worked out for the whole list at once.
 * A document without a visible reference has no entry in the map.
 */
export async function getVisibleReferenceSummaries(
  user: { userId: string; userType: UserTypeCode },
  parentDocumentIds: string[],
  db: Db = prisma,
): Promise<Map<string, ReferenceSummary>> {
  const result = new Map<string, ReferenceSummary>();
  if (parentDocumentIds.length === 0) return result;

  const isAdmin = user.userType === USER_TYPE.ADMIN;
  const filters = isAdmin ? [] : await getViewReferenceFilters(user, db);
  if (!isAdmin && filters.length === 0) return result;

  const links = await db.processStepReference.findMany({
    where: { processStepDocument: { documentId: { in: parentDocumentIds } } },
    select: { documentId: true, processStepDocument: { select: { documentId: true } } },
  });
  if (links.length === 0) return result;

  const referenceIds = [...new Set(links.map((link) => link.documentId))];
  const referenceRows = await db.document.findMany({
    where: { id: { in: referenceIds } },
    select: { id: true, isReference: true, documentType: { select: { name: true } } },
  });
  const referenceById = new Map(referenceRows.map((row) => [row.id, row]));

  let parentCovered = new Set<string>();
  let referenceCovered = new Set<string>();
  let referenceVisible = new Set<string>();
  if (!isAdmin) {
    const visibility = await buildDocumentVisibilityWhere(user, db);
    const [coveredParents, coveredReferences, visibleReferences] = await Promise.all([
      db.document.findMany({ where: { AND: [{ id: { in: parentDocumentIds } }, { OR: filters }] }, select: { id: true } }),
      db.document.findMany({ where: { AND: [{ id: { in: referenceIds } }, { OR: filters }] }, select: { id: true } }),
      db.document.findMany({ where: { AND: [{ id: { in: referenceIds } }, visibility] }, select: { id: true } }),
    ]);
    parentCovered = new Set(coveredParents.map((row) => row.id));
    referenceCovered = new Set(coveredReferences.map((row) => row.id));
    referenceVisible = new Set(visibleReferences.map((row) => row.id));
  }

  const seen = new Set<string>();
  const counts = new Map<string, Map<string, number>>();
  for (const link of links) {
    const parentId = link.processStepDocument.documentId;
    const reference = referenceById.get(link.documentId);
    if (!reference) continue;
    const pairKey = `${parentId}|${reference.id}`;
    if (seen.has(pairKey)) continue;

    if (!isAdmin) {
      const covered = parentCovered.has(parentId) || referenceCovered.has(reference.id);
      // A reference document of its own: the permission covers it directly or covers the document it belongs to.
      // An approved document picked as the reference must also be visible the normal way.
      const allowed = reference.isReference ? covered : covered && referenceVisible.has(reference.id);
      if (!allowed) continue;
    }

    seen.add(pairKey);
    const byType = counts.get(parentId) ?? new Map<string, number>();
    byType.set(reference.documentType.name, (byType.get(reference.documentType.name) ?? 0) + 1);
    counts.set(parentId, byType);
  }

  for (const [parentId, byType] of counts) {
    result.set(parentId, [...byType.entries()].map(([typeName, count]) => ({ typeName, count })).sort((a, b) => a.typeName.localeCompare(b.typeName)));
  }
  return result;
}

/**
 * The reference documents attached to one document that this user may see (for the "View referenced ..." buttons).
 * The caller has already checked that the user may open the document itself. Admin sees all of them; others need
 * "View reference documents" covering either the document they are attached to or the reference itself.
 */
export async function getVisibleReferenceDocuments(
  user: { userId: string; userType: UserTypeCode },
  parentDocumentId: string,
  db: Db = prisma,
) {
  const select = { id: true, documentNumber: true, title: true, documentType: { select: { name: true } } } satisfies Prisma.DocumentSelect;
  const links = await db.processStepReference.findMany({ where: { processStepDocument: { documentId: parentDocumentId } }, select: { documentId: true } });
  const ids = [...new Set(links.map((link) => link.documentId))];
  if (ids.length === 0) return [];

  if (user.userType === USER_TYPE.ADMIN) {
    return db.document.findMany({ where: { id: { in: ids } }, select, orderBy: { createdAt: "asc" } });
  }

  const filters = await getViewReferenceFilters(user, db);
  if (filters.length === 0) return [];

  const parentCovered = (await db.document.count({ where: { AND: [{ id: parentDocumentId }, { OR: filters }] } })) > 0;
  const visibility = await buildDocumentVisibilityWhere(user, db);
  return db.document.findMany({
    where: {
      id: { in: ids },
      OR: [
        // A reference document of its own: the permission covers it directly or covers the document it belongs to.
        parentCovered ? { isReference: true } : { isReference: true, AND: [{ OR: filters }] },
        // An approved document that was picked as the reference: it must be visible the normal way too.
        { isReference: false, AND: parentCovered ? [visibility] : [visibility, { OR: filters }] },
      ],
    },
    select,
    orderBy: { createdAt: "asc" },
  });
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
  // Which permission a scope-based assignment must carry (documents.view, documents.download).
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

  // Reference documents are hidden from everyone without documents.view_reference, even from their creator
  // and from approvers. They are never shown in lists, search, downloads or packages.
  const referenceView = await buildReferenceViewWhere(user, db);
  return { AND: [{ OR: clauses }, { OR: [{ isReference: false }, referenceView] }] };
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
  if (count > 0) return true;
  // A reference document may also be opened through the document it is attached to (see above).
  return canAccessReferenceThroughParent(user, documentId, permissionCode, db);
}

/**
 * Of the given approved, not yet received documents: the ids this user may confirm receipt for
 * (documents.confirm_receipt in scope of the document's project, location, type and sub type). One query for the whole list.
 */
export async function getReceiptConfirmableIds(
  user: { userId: string; userType: UserTypeCode },
  documentIds: string[],
  db: Db = prisma,
): Promise<Set<string>> {
  if (documentIds.length === 0) return new Set();
  const isAdmin = user.userType === USER_TYPE.ADMIN;

  const assignments = await db.userAssignment.findMany({
    where: { userId: user.userId, role: { permissions: { some: { permission: { code: "documents.confirm_receipt" } } } } },
    select: ASSIGNMENT_SCOPE_SELECT,
  });
  const filters = assignments
    .map((assignment) => scopeToDocumentWhere(assignment))
    .filter((filter): filter is Prisma.DocumentWhereInput => filter !== null);
  if (!isAdmin && filters.length === 0) return new Set();

  const rows = await db.document.findMany({
    where: {
      id: { in: documentIds },
      AND: [
        ...(isAdmin ? [] : [{ OR: filters }]),
        { OR: [
          { documentSubtype: { is: { receiptConfirmationRequired: true } } },
          { documentSubtype: { is: { receiptConfirmationRequired: null } }, documentType: { is: { receiptConfirmationRequired: true } } },
          { documentSubtypeId: null, documentType: { is: { receiptConfirmationRequired: true } } },
        ] },
      ],
    },
    select: { id: true },
  });
  return new Set(rows.map((row) => row.id));
}

/** Permission check scoped to one document (its project, the project's location, type and sub type). */
export async function userHasPermissionForDocument(
  user: { userId: string; userType: UserTypeCode },
  permissionCode: string,
  // `project` may be passed along; the project's location and company are always read fresh.
  document: { projectId: string | null; documentTypeId: string; documentSubtypeId: string | null; project?: unknown },
  db: Db = prisma,
): Promise<boolean> {
  if (user.userType === USER_TYPE.ADMIN) return true;

  const project = document.projectId
    ? await db.project.findUnique({ where: { id: document.projectId }, select: { locationId: true, companyId: true } })
    : null;

  return userHasPermission(
    user,
    permissionCode,
    {
      projectId: document.projectId,
      locationId: project?.locationId ?? null,
      companyId: project?.companyId ?? null,
      documentTypeId: document.documentTypeId,
      documentSubtypeId: document.documentSubtypeId,
    },
    db,
  );
}

/**
 * Which process runs a user may see. Only Admin sees process runs; everyone else only sees the documents that are
 * linked to the one they are looking at (shown on the document page), so this matches nothing for them.
 */
export async function buildProcessVisibilityWhere(
  user: { userId: string; userType: UserTypeCode },
): Promise<Prisma.ProcessInstanceWhereInput> {
  if (user.userType === USER_TYPE.ADMIN) return {};
  return { id: { in: [] } };
}

/**
 * Permission codes the user holds everywhere: those of assignments with no scope set, plus every "Manage ..."
 * permission they hold at all (those are system-wide, see isSystemWidePermission).
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
    where: { userId: user.userId },
    select: {
      companyId: true,
      projectId: true,
      locationId: true,
      documentTypeId: true,
      documentSubtypeId: true,
      _count: { select: { projectScopes: true, documentTypeScopes: true } },
      role: { select: { permissions: { select: { permission: { select: { code: true } } } } } },
    },
  });

  const codes = new Set<string>();
  for (const assignment of assignments) {
    const unrestricted =
      !assignment.companyId && !assignment.projectId && !assignment.locationId && !assignment.documentTypeId && !assignment.documentSubtypeId &&
      assignment._count.projectScopes === 0 && assignment._count.documentTypeScopes === 0;
    for (const entry of assignment.role.permissions) {
      if (unrestricted || isSystemWidePermission(entry.permission.code)) codes.add(entry.permission.code);
    }
  }
  return [...codes];
}
