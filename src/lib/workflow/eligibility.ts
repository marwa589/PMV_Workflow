import "server-only";

import { ApproverType } from "@prisma/client";
import {
  ASSIGNMENT_SCOPE_SELECT,
  assignmentMatchesScope,
  getDelegatorIds,
  type AssignmentScope,
  type Db,
  type ScopeContext,
} from "@/lib/auth/access";
import { USER_TYPE, type UserTypeCode } from "@/lib/auth/roles";
const UPLOAD_PERMISSION = "documents.upload";

import { PROJECT_ROLE_HOLDER_SELECT, expandProjectRoles, holdersOf, resolveFlow, type FlowStepEntry } from "@/lib/workflow/resolve-flow";

export type DocScope = {
  projectId: string | null;
  locationId: string | null;
  companyId: string | null;
  documentTypeId: string;
  documentSubtypeId: string | null;
};

export async function loadDocScope(
  db: Db,
  doc: { projectId: string | null; documentTypeId: string; documentSubtypeId: string | null },
): Promise<DocScope> {
  const project = doc.projectId
    ? await db.project.findUnique({ where: { id: doc.projectId }, select: { locationId: true, companyId: true } })
    : null;

  return {
    projectId: doc.projectId,
    locationId: project?.locationId ?? null,
    companyId: project?.companyId ?? null,
    documentTypeId: doc.documentTypeId,
    documentSubtypeId: doc.documentSubtypeId,
  };
}

type Candidate = { id: string; userTypeId: string; assignments: AssignmentScope[] };

async function loadCandidate(db: Db, userId: string): Promise<Candidate | null> {
  return db.user.findUnique({
    where: { id: userId },
    select: { id: true, userTypeId: true, assignments: { select: ASSIGNMENT_SCOPE_SELECT } },
  });
}

/**
 * Rule (confirmed):
 *  - A flow entry that names a USER works for that user, wherever they are assigned.
 *  - A flow entry that names a USER TYPE works for a user of that type only if the user also holds
 *    an assignment covering the document's scope (project, location, type, sub type).
 */
function candidateMatchesEntries(candidate: Candidate, entries: FlowStepEntry[], scope: ScopeContext): boolean {
  return entries.some((entry) => {
    if (entry.approverType === ApproverType.USER) return entry.userId === candidate.id;
    return (
      entry.userTypeId === candidate.userTypeId &&
      candidate.assignments.some((assignment) => assignmentMatchesScope(assignment, scope))
    );
  });
}

/**
 * Can this person act on a level? They may act for themselves or (when allowDelegation) for a user
 * whose tasks an admin delegated to them. Returns who they are acting on behalf of, if anyone.
 */
export async function resolveActorEligibility(
  db: Db,
  actorId: string,
  entries: FlowStepEntry[],
  scope: ScopeContext,
  allowDelegation = true,
): Promise<{ allowed: boolean; onBehalfOfUserId: string | null }> {
  const ids = [actorId, ...(allowDelegation ? await getDelegatorIds(db, actorId) : [])];

  for (const id of ids) {
    const candidate = await loadCandidate(db, id);
    if (candidate && candidateMatchesEntries(candidate, entries, scope)) {
      return { allowed: true, onBehalfOfUserId: id === actorId ? null : id };
    }
  }

  return { allowed: false, onBehalfOfUserId: null };
}

/**
 * Loads the user (and anyone whose tasks were delegated to them) once, then answers "may I act on these
 * entries for this document?" in memory. Use it to filter many documents without a query per document.
 */
export async function createEligibilityChecker(db: Db, userId: string) {
  const ids = [userId, ...(await getDelegatorIds(db, userId))];
  const candidates = await db.user.findMany({
    where: { id: { in: ids } },
    select: { id: true, userTypeId: true, assignments: { select: ASSIGNMENT_SCOPE_SELECT } },
  });

  return (entries: FlowStepEntry[], scope: ScopeContext): boolean =>
    candidates.some((candidate) => candidateMatchesEntries(candidate, entries, scope));
}

/**
 * Everyone who should be notified for a level: named users, users of a named type who hold a matching
 * assignment, and anyone their tasks are delegated to. Admin users are notified only when the level names them
 * (by name, or as the Project Director); a user type or a delegation never brings in an Admin user.
 */
export async function getEligibleRecipients(
  db: Db,
  entries: FlowStepEntry[],
  scope: ScopeContext,
): Promise<Array<{ id: string; email: string; name: string }>> {
  const namedIds = entries
    .filter((entry) => entry.approverType === ApproverType.USER && entry.userId)
    .map((entry) => entry.userId as string);
  const typeIds = entries
    .filter((entry) => entry.approverType === ApproverType.USER_TYPE && entry.userTypeId)
    .map((entry) => entry.userTypeId as string);

  const typedUsers = typeIds.length
    ? await db.user.findMany({
        where: { userTypeId: { in: typeIds }, isActive: true },
        select: { id: true, assignments: { select: ASSIGNMENT_SCOPE_SELECT } },
      })
    : [];

  const typedIds = typedUsers
    .filter((user) => user.assignments.some((assignment) => assignmentMatchesScope(assignment, scope)))
    .map((user) => user.id);

  const baseIds = Array.from(new Set([...namedIds, ...typedIds]));

  const delegations = baseIds.length
    ? await db.approvalDelegation.findMany({
        where: {
          delegatorUserId: { in: baseIds },
          OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
        },
        select: { delegateUserId: true },
      })
    : [];

  const allIds = Array.from(new Set([...baseIds, ...delegations.map((row) => row.delegateUserId)]));
  if (allIds.length === 0) return [];

  const named = new Set(namedIds);
  const users = await db.user.findMany({
    where: { id: { in: allIds }, isActive: true },
    select: { id: true, email: true, name: true, userType: { select: { code: true } } },
  });
  return users
    .filter((user) => user.userType.code !== USER_TYPE.ADMIN || named.has(user.id))
    .map(({ id, email, name }) => ({ id, email, name }));
}

/**
 * May this person upload a document of this type / sub type / project?
 *  - Admin: any flow.
 *  - A flow exists: they must be named by its uploader step (level 0), by name or by user type + matching assignment.
 *  - No flow (auto-approve): only people whose role carries "Upload documents" for that scope (checked first, above).
 *    A Clerk who merely holds some other assignment (for example a view-only role) can NOT upload.
 */
export async function canUserUpload(
  db: Db,
  actor: { id: string; userType: UserTypeCode },
  doc: { documentTypeId: string; documentSubtypeId: string | null; projectId: string | null },
): Promise<boolean> {
  if (actor.userType === USER_TYPE.ADMIN) return true;

  const scope = await loadDocScope(db, doc);

  // The "Upload documents" permission: a role holder may upload in the scope of the assignment that carries it.
  const uploadAssignments = await db.userAssignment.findMany({
    where: { userId: actor.id, role: { permissions: { some: { permission: { code: UPLOAD_PERMISSION } } } } },
    select: ASSIGNMENT_SCOPE_SELECT,
  });
  if (uploadAssignments.some((assignment) => assignmentMatchesScope(assignment, scope))) return true;

  const flow = await resolveFlow(db, doc);

  const uploaderEntries =
    flow.kind === "flow"
      ? (flow.template.steps.find((step) => step.stepNumber === 0)?.approvers ?? [])
      : [];

  if (flow.kind === "flow" && uploaderEntries.length > 0) {
    const result = await resolveActorEligibility(db, actor.id, uploaderEntries, scope, false);
    return result.allowed;
  }

  // No flow, or a flow without an uploader step: the "Upload documents" permission above is the only way in.
  return false;
}

/**
 * Should this person see "New document" at all? Admin always. Otherwise: anyone holding a role with "Upload documents",
 * or anyone a flow names at its uploader step (by name or by their user type).
 */
export async function canUserUploadAnything(db: Db, user: { id: string; userType: UserTypeCode }): Promise<boolean> {
  if (user.userType === USER_TYPE.ADMIN) return true;

  const record = await db.user.findUnique({
    where: { id: user.id },
    select: { userTypeId: true, _count: { select: { assignments: true } } },
  });
  if (!record) return false;

  const withUploadPermission = await db.userAssignment.count({
    where: { userId: user.id, role: { permissions: { some: { permission: { code: UPLOAD_PERMISSION } } } } },
  });
  if (withUploadPermission > 0) return true;

  const named = await db.documentWorkflowStepApprover.count({
    where: { step: { stepNumber: 0 }, OR: [{ userId: user.id }, { userTypeId: record.userTypeId }] },
  });
  if (named > 0) return true;

  // A project director / manager can upload where a flow's uploader step names that role.
  const [directs, manages] = await Promise.all([
    db.project.count({ where: { directorId: user.id, isActive: true } }),
    db.project.count({ where: { managerId: user.id, isActive: true } }),
  ]);
  const roles = [...(directs > 0 ? [ApproverType.PROJECT_DIRECTOR] : []), ...(manages > 0 ? [ApproverType.PROJECT_MANAGER] : [])];
  if (roles.length === 0) return false;
  const roleUploaderSteps = await db.documentWorkflowStepApprover.count({
    where: { step: { stepNumber: 0 }, approverType: { in: roles } },
  });
  return roleUploaderSteps > 0;
}

/**
 * Every (project, type, sub type) combination this person may upload, worked out in memory with the same rules as
 * canUserUpload (role with "Upload documents" in scope, or named at the flow's uploader step), so the New Document
 * form only offers what the server will accept. `null` means no limit (Admin).
 * Keys look like `${projectId}|${documentTypeId}|${documentSubtypeId}` with an empty string for "no project" / "no sub type".
 */
export async function getUploadableScopeKeys(
  db: Db,
  actor: { id: string; userType: UserTypeCode },
  input: {
    projects: Array<{ id: string }>;
    types: Array<{ id: string; subtypes: Array<{ id: string }> }>;
  },
): Promise<string[] | null> {
  if (actor.userType === USER_TYPE.ADMIN) return null;

  const [projectRows, uploadAssignments, candidate, flowRows] = await Promise.all([
    db.project.findMany({
      where: { id: { in: input.projects.map((project) => project.id) } },
      select: { id: true, locationId: true, companyId: true, ...PROJECT_ROLE_HOLDER_SELECT },
    }),
    db.userAssignment.findMany({
      where: { userId: actor.id, role: { permissions: { some: { permission: { code: UPLOAD_PERMISSION } } } } },
      select: ASSIGNMENT_SCOPE_SELECT,
    }),
    loadCandidate(db, actor.id),
    db.documentWorkflowAssignment.findMany({
      where: { documentTypeId: { in: input.types.map((type) => type.id) } },
      select: { documentTypeId: true, documentSubtypeId: true, projectId: true, templateId: true },
    }),
  ]);

  const templateIds = [...new Set(flowRows.flatMap((row) => (row.templateId ? [row.templateId] : [])))];
  const uploaderStepRows = templateIds.length
    ? await db.documentWorkflowStep.findMany({
        where: { templateId: { in: templateIds }, stepNumber: 0 },
        select: { templateId: true, approvers: { select: { approverType: true, userId: true, userTypeId: true } } },
      })
    : [];
  const uploaderEntriesByTemplate = new Map<string, FlowStepEntry[]>(uploaderStepRows.map((row) => [row.templateId, row.approvers]));

  const locationOf = new Map(projectRows.map((row) => [row.id, row.locationId]));
  const companyOf = new Map(projectRows.map((row) => [row.id, row.companyId]));
  const holdersByProject = new Map(projectRows.map((row) => [row.id, holdersOf(row)]));
  // Same as resolveFlow: a "Project Director" / "Project Manager" entry stands for that person of the project checked.
  const withDirector = (entries: FlowStepEntry[], projectId: string | null): FlowStepEntry[] =>
    expandProjectRoles(entries, (projectId ? holdersByProject.get(projectId) : null) ?? holdersOf(null)).approvers;
  const rank = (row: { documentSubtypeId: string | null; projectId: string | null }) => {
    if (row.projectId && row.documentSubtypeId) return 1;
    if (row.projectId) return 2;
    if (row.documentSubtypeId) return 3;
    return 4;
  };

  const keys: string[] = [];
  const projectChoices: Array<string | null> = [null, ...input.projects.map((project) => project.id)];

  for (const type of input.types) {
    const subtypeChoices: Array<string | null> = type.subtypes.length > 0 ? type.subtypes.map((subtype) => subtype.id) : [null];
    for (const subtypeId of subtypeChoices) {
      for (const projectId of projectChoices) {
        const scope: ScopeContext = {
          projectId,
          locationId: projectId ? locationOf.get(projectId) ?? null : null,
          companyId: projectId ? companyOf.get(projectId) ?? null : null,
          documentTypeId: type.id,
          documentSubtypeId: subtypeId,
        };

        let allowed = uploadAssignments.some((assignment) => assignmentMatchesScope(assignment, scope));

        if (!allowed && candidate) {
          // Same choice resolveFlow makes: the most specific assignment for this type / sub type / project.
          const best = flowRows
            .filter((row) => row.documentTypeId === type.id && (row.documentSubtypeId === null || row.documentSubtypeId === subtypeId) && (row.projectId === null || row.projectId === projectId))
            .sort((a, b) => rank(a) - rank(b))[0];
          const entries = withDirector(best?.templateId ? uploaderEntriesByTemplate.get(best.templateId) ?? [] : [], projectId);
          allowed = entries.length > 0 && candidateMatchesEntries(candidate, entries, scope);
        }

        if (allowed) keys.push(`${projectId ?? ""}|${type.id}|${subtypeId ?? ""}`);
      }
    }
  }
  return keys;
}
