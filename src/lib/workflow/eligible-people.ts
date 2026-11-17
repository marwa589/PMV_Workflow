import "server-only";

import { ApproverType } from "@prisma/client";
import { assignmentMatchesScope, ASSIGNMENT_SCOPE_SELECT, type AssignmentScope, type Db, type ScopeContext } from "@/lib/auth/access";
import { loadDocScope } from "@/lib/workflow/eligibility";
import { resolveFlow, type FlowStepEntry } from "@/lib/workflow/resolve-flow";
import type { EligiblePerson } from "@/lib/workflow/eligible-people-types";

const UPLOAD_PERMISSION = "documents.upload";

type PoolUser = {
  id: string;
  name: string;
  email: string;
  userTypeId: string;
  userType: { name: string };
  assignments: Array<AssignmentScope & { role: { name: string; permissions: Array<{ permission: { code: string } }> } }>;
};

class Collector {
  private people = new Map<string, EligiblePerson>();

  add(user: Pick<PoolUser, "id" | "name" | "email" | "userType">, reason: string) {
    const existing = this.people.get(user.id);
    if (existing) {
      if (!existing.reasons.includes(reason)) existing.reasons.push(reason);
      return;
    }
    this.people.set(user.id, { id: user.id, name: user.name, email: user.email, userTypeName: user.userType.name, reasons: [reason] });
  }

  has(id: string) {
    return this.people.has(id);
  }

  list(): EligiblePerson[] {
    return [...this.people.values()].sort((a, b) => a.name.localeCompare(b.name));
  }
}

/**
 * Answers "who can do this?" for admins, using the same rules the app enforces when someone really acts:
 *  - upload: canUserUpload (role with "Upload documents" in scope, or named at the flow's uploader step)
 *  - review: resolveActorEligibility / createEligibilityChecker (named user, or user type + matching assignment, plus delegates)
 * Admin users can always act and are not listed. Only active users are returned.
 *
 * Loads the people once, so create one finder per page and reuse it for every row.
 */
export async function createEligiblePeopleFinder(db: Db) {
  const [users, delegations] = await Promise.all([
    db.user.findMany({
      where: { isActive: true },
      select: {
        id: true,
        name: true,
        email: true,
        userTypeId: true,
        userType: { select: { name: true } },
        assignments: {
          select: {
            ...ASSIGNMENT_SCOPE_SELECT,
            role: { select: { name: true, permissions: { select: { permission: { select: { code: true } } } } } },
          },
        },
      },
    }),
    db.approvalDelegation.findMany({
      where: { OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] },
      select: { delegatorUserId: true, delegateUserId: true },
    }),
  ]);

  const byId = new Map<string, PoolUser>(users.map((user) => [user.id, user]));

  /** Reasons this person is covered by the flow entries for this scope (empty = not covered). */
  function entryReasons(user: PoolUser, entries: FlowStepEntry[], scope: ScopeContext): string[] {
    const reasons: string[] = [];
    for (const entry of entries) {
      if (entry.approverType === ApproverType.USER) {
        if (entry.userId === user.id) {
          reasons.push(
            entry.viaProjectDirector ? "Project Director of this project" : entry.viaProjectManager ? "Project Manager of this project" : "Named in the flow",
          );
        }
      } else if (
        entry.userTypeId === user.userTypeId &&
        user.assignments.some((assignment) => assignmentMatchesScope(assignment, scope))
      ) {
        reasons.push(`${user.userType.name} with an assignment covering this document`);
      }
    }
    return reasons;
  }

  return {
    /** Everyone (besides admins) who may upload a document of this type / sub type in this project. */
    async uploaders(doc: { documentTypeId: string; documentSubtypeId: string | null; projectId: string | null }): Promise<EligiblePerson[]> {
      const scope = await loadDocScope(db, doc);
      const found = new Collector();

      for (const user of users) {
        for (const assignment of user.assignments) {
          const grantsUpload = assignment.role.permissions.some((entry) => entry.permission.code === UPLOAD_PERMISSION);
          if (grantsUpload && assignmentMatchesScope(assignment, scope)) {
            found.add(user, `Role "${assignment.role.name}" (Upload documents)`);
          }
        }
      }

      const flow = await resolveFlow(db, doc);
      const uploaderEntries = flow.kind === "flow" ? (flow.template.steps.find((step) => step.stepNumber === 0)?.approvers ?? []) : [];
      if (uploaderEntries.length > 0) {
        for (const user of users) {
          for (const reason of entryReasons(user, uploaderEntries, scope)) {
            found.add(user, reason === "Named in the flow" ? "Named at the flow's uploader step" : `${reason} (flow uploader step)`);
          }
        }
      }

      return found.list();
    },

    /**
     * Everyone (besides admins) who may act on one level of a document's flow, including people covering for them
     * through a delegation. Pass `creator` for the uploader level: the person who uploaded it can also revise it.
     */
    reviewers(entries: FlowStepEntry[], scope: ScopeContext, creator?: { id: string } | null): EligiblePerson[] {
      const found = new Collector();

      for (const user of users) {
        for (const reason of entryReasons(user, entries, scope)) found.add(user, reason);
      }

      const baseIds = new Set(found.list().map((person) => person.id));
      for (const delegation of delegations) {
        if (!baseIds.has(delegation.delegatorUserId)) continue;
        const delegate = byId.get(delegation.delegateUserId);
        const delegator = byId.get(delegation.delegatorUserId);
        if (!delegate || !delegator) continue;
        found.add(delegate, `Covering for ${delegator.name} (delegation)`);
      }

      const creatorUser = creator ? byId.get(creator.id) : null;
      if (creatorUser) found.add(creatorUser, "Uploaded this document (can revise it)");

      return found.list();
    },

    /**
     * Who can act now on a document shown in a list: the people of the level it waits at (the uploader level, plus the
     * person who uploaded it, when it was sent back for revision). Documents that are not waiting (approved, rejected,
     * archived) have nobody to wait for, so the list is empty.
     */
    reviewersForRow(row: {
      status: string;
      createdById: string;
      approverResolution?: { entries: Array<{ approverType: ApproverType; userId: string | null; userTypeId: string | null; viaProjectDirector?: boolean; viaProjectManager?: boolean }>; scope: ScopeContext };
    }): EligiblePerson[] {
      if (!["PENDING", "ON_HOLD", "REVISION_REQUIRED"].includes(row.status) || !row.approverResolution) return [];
      const entries: FlowStepEntry[] = row.approverResolution.entries.map((entry) => ({ approverType: entry.approverType, userId: entry.userId, userTypeId: entry.userTypeId, viaProjectDirector: entry.viaProjectDirector, viaProjectManager: entry.viaProjectManager }));
      return this.reviewers(entries, row.approverResolution.scope, row.status === "REVISION_REQUIRED" ? { id: row.createdById } : null);
    },
  };
}
