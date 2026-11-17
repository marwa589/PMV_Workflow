import "server-only";

import { ApprovalActionType, ApproverType, DocumentStatus, type Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ASSIGNMENT_SCOPE_SELECT, assignmentMatchesScope, buildDocumentVisibilityWhere } from "@/lib/auth/access";
import { USER_TYPE, type UserTypeCode } from "@/lib/auth/roles";
import { createEligibilityChecker } from "@/lib/workflow/eligibility";
import { getDocumentStatusDisplay, levelWaitingFor } from "@/lib/document-status";
import { getProcessStatusLabel } from "@/lib/process-status";

// One row shape for every list screen. Document type, sub type and project are data now,
// and "who it is waiting for" is read from the approval levels copied onto the document.
const documentListSelect = {
  id: true,
  documentNumber: true,
  title: true,
  status: true,
  currentVersion: true,
  currentWorkflowStep: true,
  currentApproverAssignedAt: true,
  createdAt: true,
  updatedAt: true,
  approvedAt: true,
  receivedAt: true,
  downloadedAt: true,
  createdById: true,
  projectId: true,
  documentTypeId: true,
  documentSubtypeId: true,
  createdBy: { select: { name: true } },
  documentType: { select: { id: true, code: true, name: true, receiptConfirmationRequired: true } },
  documentSubtype: { select: { id: true, code: true, name: true, receiptConfirmationRequired: true } },
  project: { select: { id: true, code: true, name: true, locationId: true, companyId: true, location: { select: { name: true } } } },
  approvalSteps: {
    orderBy: { levelNumber: "asc" },
    select: {
      levelNumber: true,
      name: true,
      signatureRequired: true,
      awaitingProjectDirector: true,
      awaitingProjectManager: true,
      approvers: {
        select: {
          approverType: true,
          userId: true,
          userTypeId: true,
          viaProjectDirector: true,
          viaProjectManager: true,
          user: { select: { name: true } },
          userType: { select: { name: true } },
        },
      },
    },
  },
  // Recent history, newest first: the latest rejection and the latest comment are both read from it.
  approvals: {
    orderBy: { performedAt: "desc" },
    take: 30,
    select: { action: true, comments: true, levelNumber: true, performedById: true, performedBy: { select: { name: true } } },
  },
  // A few, newest first: a document that other runs follow (a comparison sheet followed by MRs) is also linked into
  // those follow-up runs, which must not decide its own status; see processInstance below.
  processLinks: {
    orderBy: { linkedAt: "desc" },
    take: 10,
    select: {
      processInstance: {
        select: {
          followedDocumentId: true,
          status: true,
          currentStepId: true,
          processDefinition: {
            select: {
              steps: {
                select: {
                  id: true,
                  parentStepId: true,
                  delayHours: true,
                  documentType: { select: { code: true } },
                  documentSubtype: { select: { code: true } },
                },
              },
            },
          },
          stepDocuments: {
            where: { isCurrent: true },
            select: { processStepId: true, isCurrent: true, document: { select: { status: true, approvedAt: true } } },
          },
        },
      },
    },
  },
} satisfies Prisma.DocumentSelect;

type RawDocument = Prisma.DocumentGetPayload<{ select: typeof documentListSelect }>;

// What is needed to work out WHO can act at the level a document waits at (see withEligibleApprovers).
export type ApproverResolution = {
  entries: Array<{
    approverType: ApproverType;
    userId: string | null;
    userTypeId: string | null;
    viaProjectDirector?: boolean;
    viaProjectManager?: boolean;
    userName: string | null;
    userTypeName: string | null;
  }>;
  scope: { projectId: string | null; locationId: string | null; companyId?: string | null; documentTypeId: string; documentSubtypeId: string | null };
};

const FINAL_STATUSES: DocumentStatus[] = [DocumentStatus.APPROVED, DocumentStatus.CANCELLED, DocumentStatus.ARCHIVED];

export type DocumentRow = {
  id: string;
  documentNumber: string;
  title: string;
  status: DocumentStatus;
  statusLabel: string;
  documentType: { id: string; code: string; name: string };
  documentSubtype: { id: string; code: string; name: string } | null;
  receiptConfirmationRequired: boolean;
  project: { id: string; code: string; name: string; locationId: string | null; locationName: string | null } | null;
  currentVersion: number;
  currentWorkflowStep: number | null;
  currentLevelName: string | null;
  // Whether the level the document waits at needs a signature to approve (flow setting).
  signatureRequired: boolean;
  // When the current level started waiting (used for aging).
  waitingSince: Date | null;
  createdAt: Date;
  updatedAt: Date;
  approvedAt: Date | null;
  receivedAt: Date | null;
  latestComment: string | null;
  downloadedAt: Date | null;
  createdBy: { name: string };
  createdById: string;
  // Who the document is waiting for: named users and user types at the current level.
  // `names` lists them one by one; withEligibleApprovers() replaces a user type (for example "Engineer") by the
  // people of that type who can really approve this document.
  currentApprover: { name: string; names?: string[] } | null;
  // Kept so withEligibleApprovers() can resolve the people without reading the document again (server side only).
  approverResolution?: ApproverResolution;
  // The latest rejection, if any (the rejected level stays recorded on the document).
  rejection: { comments: string | null; levelNumber: number | null; performedByName: string } | null;
  processStatus: string | null;
  processStatusLabel: string | null;
};

export type ActionDocumentRow = DocumentRow;

export function toDocumentRow(document: RawDocument): DocumentRow {
  const levelNumber = document.currentWorkflowStep;
  const currentStep = levelNumber === null ? null : document.approvalSteps.find((step) => step.levelNumber === levelNumber) ?? null;

  const names = currentStep
    ? currentStep.approvers
        .map((entry) => (entry.approverType === ApproverType.USER ? entry.user?.name : entry.userType?.name))
        .filter((name): name is string => Boolean(name))
    : [];

  const rejection = document.approvals.find((entry) => entry.action === ApprovalActionType.REJECTED);
  const latestComment = document.approvals.find((entry) => entry.comments)?.comments ?? null;
  const processInstance = document.processLinks.find((link) => link.processInstance.followedDocumentId !== document.id)?.processInstance ?? null;

  return {
    id: document.id,
    documentNumber: document.documentNumber,
    title: document.title,
    status: document.status,
    statusLabel: getDocumentStatusDisplay(document.status, { levelNumber, name: currentStep?.name, waitingFor: levelWaitingFor(currentStep) }),
    documentType: document.documentType,
    documentSubtype: document.documentSubtype,
    receiptConfirmationRequired: document.documentSubtype?.receiptConfirmationRequired ?? document.documentType.receiptConfirmationRequired,
    project: document.project
      ? {
          id: document.project.id,
          code: document.project.code,
          name: document.project.name,
          locationId: document.project.locationId,
          locationName: document.project.location?.name ?? null,
        }
      : null,
    currentVersion: document.currentVersion,
    currentWorkflowStep: levelNumber,
    currentLevelName: currentStep?.name ?? null,
    signatureRequired: currentStep?.signatureRequired ?? true,
    waitingSince: document.currentApproverAssignedAt,
    createdAt: document.createdAt,
    updatedAt: document.updatedAt,
    approvedAt: document.approvedAt,
    receivedAt: document.receivedAt,
    latestComment,
    downloadedAt: document.downloadedAt,
    createdBy: { name: document.createdBy.name },
    createdById: document.createdById,
    currentApprover: names.length > 0 ? { name: names.join(", "), names } : null,
    approverResolution:
      currentStep && !FINAL_STATUSES.includes(document.status)
        ? {
            entries: currentStep.approvers.map((entry) => ({
              approverType: entry.approverType,
              userId: entry.userId,
              userTypeId: entry.userTypeId,
              viaProjectDirector: entry.viaProjectDirector,
              viaProjectManager: entry.viaProjectManager,
              userName: entry.user?.name ?? null,
              userTypeName: entry.userType?.name ?? null,
            })),
            scope: {
              projectId: document.projectId,
              locationId: document.project?.locationId ?? null,
              companyId: document.project?.companyId ?? null,
              documentTypeId: document.documentTypeId,
              documentSubtypeId: document.documentSubtypeId,
            },
          }
        : undefined,
    rejection: rejection
      ? { comments: rejection.comments, levelNumber: rejection.levelNumber, performedByName: rejection.performedBy.name }
      : null,
    processStatus: processInstance?.status ?? null,
    processStatusLabel: processInstance
      ? getProcessStatusLabel(processInstance, processInstance.processDefinition.steps, processInstance.stepDocuments)
      : null,
  };
}

/**
 * "Current approver" for list screens: when the flow names a user TYPE (for example "Engineer"), this shows the
 * people who can really approve the document instead of the type name. It uses the same rule as the workflow:
 *  - a flow entry that names a USER shows that user;
 *  - a flow entry that names a USER TYPE shows the active users of that type who also hold an assignment
 *    covering the document (project, location, type, sub type). When nobody qualifies, the type name is kept
 *    with a note, so a flow nobody can act on is easy to spot.
 * One query for all rows (not one per document). Delegations are not listed.
 */
export async function withEligibleApprovers(rows: DocumentRow[]): Promise<DocumentRow[]> {
  const typeIds = new Set<string>();
  for (const row of rows) {
    for (const entry of row.approverResolution?.entries ?? []) {
      if (entry.approverType === ApproverType.USER_TYPE && entry.userTypeId) typeIds.add(entry.userTypeId);
    }
  }
  if (typeIds.size === 0) return rows;

  const users = await prisma.user.findMany({
    where: { userTypeId: { in: [...typeIds] }, isActive: true },
    select: { id: true, name: true, userTypeId: true, assignments: { select: ASSIGNMENT_SCOPE_SELECT } },
    orderBy: { name: "asc" },
  });
  const usersByType = new Map<string, typeof users>();
  for (const user of users) usersByType.set(user.userTypeId, [...(usersByType.get(user.userTypeId) ?? []), user]);

  return rows.map((row) => {
    const resolution = row.approverResolution;
    if (!resolution || resolution.entries.length === 0) return row;

    const people = new Map<string, string>();
    for (const entry of resolution.entries) {
      if (entry.approverType === ApproverType.USER) {
        if (entry.userId && entry.userName) people.set(`user:${entry.userId}`, entry.userName);
        continue;
      }
      const eligible = (usersByType.get(entry.userTypeId ?? "") ?? []).filter((user) =>
        user.assignments.some((assignment) => assignmentMatchesScope(assignment, resolution.scope)),
      );
      if (eligible.length > 0) {
        for (const user of eligible) people.set(`user:${user.id}`, user.name);
      } else if (entry.userTypeName) {
        people.set(`type:${entry.userTypeId}`, `${entry.userTypeName} (no one assigned)`);
      }
    }

    const names = [...people.values()];
    return names.length > 0 ? { ...row, currentApprover: { name: names.join(", "), names } } : row;
  });
}

async function listDocuments(where: Prisma.DocumentWhereInput, take?: number): Promise<DocumentRow[]> {
  const documents = await prisma.document.findMany({
    where,
    select: documentListSelect,
    orderBy: { createdAt: "desc" },
    ...(take ? { take } : {}),
  });
  return documents.map(toDocumentRow);
}

/** Rows for any filter (optionally limited), for screens that need a slice rather than everything. */
export async function getDocumentRows(where: Prisma.DocumentWhereInput, take?: number): Promise<DocumentRow[]> {
  return listDocuments(where, take);
}

/**
 * Documents that are waiting for this user to act (they may be named by the flow, belong to a named
 * user type with a matching assignment, or hold someone's delegated tasks):
 *  - pending or on hold: the user is eligible at the current level
 *  - sent back for revision: the user created it (level 0) or is eligible at the selected earlier level
 */
export async function getActionableDocuments(
  user: { userId: string; userType: UserTypeCode },
  statuses: DocumentStatus[],
): Promise<DocumentRow[]> {
  const visibility = await buildDocumentVisibilityWhere(user);
  const [candidates, canAct] = await Promise.all([
    prisma.document.findMany({
      where: { AND: [visibility, { status: { in: statuses } }] },
      select: documentListSelect,
      orderBy: { createdAt: "desc" },
    }),
    createEligibilityChecker(prisma, user.userId),
  ]);

  return candidates
    .filter((document) => {
      const level = document.currentWorkflowStep;
      if (level === null) return false;
      // Admin users see everything waiting at any level.
      if (user.userType === USER_TYPE.ADMIN) return true;
      if (
        document.status === DocumentStatus.PENDING &&
        document.approvals[0]?.action === ApprovalActionType.RESUBMITTED &&
        document.approvals.find((entry) => entry.action === ApprovalActionType.REQUESTED_REVISION)?.performedById !== user.userId
      ) return false;
      // Sent back to the uploader: it is the task of the person who uploaded it, nobody else's.
      if (document.status === DocumentStatus.REVISION_REQUIRED && level === 0) return document.createdById === user.userId;

      const step = document.approvalSteps.find((candidate) => candidate.levelNumber === level);
      if (!step) return false;

      return canAct(step.approvers, {
        projectId: document.projectId,
        locationId: document.project?.locationId ?? null,
        companyId: document.project?.companyId ?? null,
        documentTypeId: document.documentTypeId,
        documentSubtypeId: document.documentSubtypeId,
      });
    })
    .map(toDocumentRow);
}

export async function getDocumentsForClerk(userId: string, userType: UserTypeCode = USER_TYPE.CLERK) {
  const visibility = await buildDocumentVisibilityWhere({ userId, userType });

  const [documents, total, pending, approved, rejected] = await Promise.all([
    listDocuments(visibility),
    prisma.document.count({ where: visibility }),
    prisma.document.count({ where: { AND: [visibility, { status: DocumentStatus.PENDING }] } }),
    prisma.document.count({ where: { AND: [visibility, { status: DocumentStatus.APPROVED }] } }),
    prisma.document.count({ where: { AND: [visibility, { status: DocumentStatus.CANCELLED }] } }),
  ]);

  return { documents, total, pending, approved, rejected };
}

export async function getDocumentsForApprover(userId: string, userType: UserTypeCode) {
  const user = { userId, userType };
  const visibility = await buildDocumentVisibilityWhere(user);

  const [
    pendingDocuments,
    onHoldDocuments,
    assignedRevisionDocuments,
    requestedRevisionDocuments,
    approvedDocuments,
    rejectedDocuments,
    myDocuments,
    recentActivity,
  ] = await Promise.all([
    getActionableDocuments(user, [DocumentStatus.PENDING]),
    getActionableDocuments(user, [DocumentStatus.ON_HOLD]),
    getActionableDocuments(user, [DocumentStatus.REVISION_REQUIRED]),
    listDocuments({
      status: DocumentStatus.REVISION_REQUIRED,
      approvals: { some: { performedById: userId, action: ApprovalActionType.REQUESTED_REVISION } },
    }),
    // Every approved / rejected document this person may access, whoever approved or rejected it.
    listDocuments({ AND: [visibility, { status: DocumentStatus.APPROVED }] }),
    listDocuments({ AND: [visibility, { status: DocumentStatus.CANCELLED }] }),
    listDocuments(visibility),
    prisma.approvalHistory.findMany({
      where: { performedById: userId },
      include: { document: { select: { documentNumber: true, title: true } } },
      orderBy: { performedAt: "desc" },
      take: 8,
    }),
  ]);

  return {
    pendingDocuments,
    onHoldDocuments,
    revisionRequiredDocuments: Array.from(
      new Map([...assignedRevisionDocuments, ...requestedRevisionDocuments].map((document) => [document.id, document])).values(),
    ),
    approvedDocuments,
    rejectedDocuments,
    myDocuments,
    recentActivity,
    userType,
  };
}

export async function getDocumentsForAdmin() {
  const [documents, recentActivity, userCounts, userTypes] = await Promise.all([
    listDocuments({}),
    prisma.approvalHistory.findMany({
      include: {
        document: { select: { documentNumber: true, title: true } },
        performedBy: { select: { name: true, email: true } },
      },
      orderBy: { performedAt: "desc" },
      take: 8,
    }),
    prisma.user.groupBy({ by: ["userTypeId"], _count: { _all: true } }),
    prisma.userType.findMany({ select: { id: true, code: true, name: true } }),
  ]);

  const byStatus = (status: DocumentStatus) => documents.filter((document) => document.status === status);

  const typeById = new Map(userTypes.map((type) => [type.id, type]));
  const usersByType = userCounts.map((row) => ({
    code: typeById.get(row.userTypeId)?.code ?? "unknown",
    name: typeById.get(row.userTypeId)?.name ?? "Unknown",
    count: row._count._all,
  }));

  return {
    documents,
    pendingDocuments: byStatus(DocumentStatus.PENDING),
    onHoldDocuments: byStatus(DocumentStatus.ON_HOLD),
    revisionRequiredDocuments: byStatus(DocumentStatus.REVISION_REQUIRED),
    approvedDocuments: byStatus(DocumentStatus.APPROVED),
    rejectedDocuments: byStatus(DocumentStatus.CANCELLED),
    archivedDocuments: byStatus(DocumentStatus.ARCHIVED),
    recentActivity,
    usersByType,
  };
}
