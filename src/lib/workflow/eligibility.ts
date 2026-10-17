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
import { resolveFlow, type FlowStepEntry } from "@/lib/workflow/resolve-flow";

export type DocScope = {
  projectId: string | null;
  locationId: string | null;
  documentTypeId: string;
  documentSubtypeId: string | null;
};

export async function loadDocScope(
  db: Db,
  doc: { projectId: string | null; documentTypeId: string; documentSubtypeId: string | null },
): Promise<DocScope> {
  const project = doc.projectId
    ? await db.project.findUnique({ where: { id: doc.projectId }, select: { locationId: true } })
    : null;

  return {
    projectId: doc.projectId,
    locationId: project?.locationId ?? null,
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
 * assignment, and anyone their tasks are delegated to. Admin users are never notified.
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

  return db.user.findMany({
    where: { id: { in: allIds }, isActive: true, userType: { code: { not: USER_TYPE.ADMIN } } },
    select: { id: true, email: true, name: true },
  });
}

/**
 * May this person upload a document of this type / sub type / project?
 *  - Admin: any flow.
 *  - A flow exists: they must be named by its uploader step (level 0), by name or by user type + matching assignment.
 *  - No flow (auto-approve): any Clerk with an assignment covering the document.
 */
export async function canUserUpload(
  db: Db,
  actor: { id: string; userType: UserTypeCode },
  doc: { documentTypeId: string; documentSubtypeId: string | null; projectId: string | null },
): Promise<boolean> {
  if (actor.userType === USER_TYPE.ADMIN) return true;

  const scope = await loadDocScope(db, doc);
  const flow = await resolveFlow(db, doc);

  const uploaderEntries =
    flow.kind === "flow"
      ? (flow.template.steps.find((step) => step.stepNumber === 0)?.approvers ?? [])
      : [];

  if (flow.kind === "flow" && uploaderEntries.length > 0) {
    const result = await resolveActorEligibility(db, actor.id, uploaderEntries, scope, false);
    return result.allowed;
  }

  if (actor.userType !== USER_TYPE.CLERK) return false;

  const candidate = await loadCandidate(db, actor.id);
  return !!candidate && candidate.assignments.some((assignment) => assignmentMatchesScope(assignment, scope));
}

/**
 * Should this person see "New document" at all? Admin always. Otherwise: a Clerk with at least one assignment,
 * or anyone a flow names at its uploader step (by name or by their user type).
 */
export async function canUserUploadAnything(db: Db, user: { id: string; userType: UserTypeCode }): Promise<boolean> {
  if (user.userType === USER_TYPE.ADMIN) return true;

  const record = await db.user.findUnique({
    where: { id: user.id },
    select: { userTypeId: true, _count: { select: { assignments: true } } },
  });
  if (!record) return false;

  if (user.userType === USER_TYPE.CLERK && record._count.assignments > 0) return true;

  const named = await db.documentWorkflowStepApprover.count({
    where: { step: { stepNumber: 0 }, OR: [{ userId: user.id }, { userTypeId: record.userTypeId }] },
  });
  return named > 0;
}
