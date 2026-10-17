import "server-only";

import { ApprovalActionType, ApproverType, DocumentStatus, type Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { buildDocumentVisibilityWhere } from "@/lib/auth/access";
import { USER_TYPE, type UserTypeCode } from "@/lib/auth/roles";
import { createEligibilityChecker } from "@/lib/workflow/eligibility";
import { getDocumentStatusDisplay } from "@/lib/document-status";
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
  documentType: { select: { id: true, code: true, name: true } },
  documentSubtype: { select: { id: true, code: true, name: true } },
  project: { select: { id: true, code: true, name: true, locationId: true, location: { select: { name: true } } } },
  approvalSteps: {
    orderBy: { levelNumber: "asc" },
    select: {
      levelNumber: true,
      name: true,
      approvers: {
        select: {
          approverType: true,
          userId: true,
          userTypeId: true,
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
  processLinks: {
    orderBy: { linkedAt: "desc" },
    take: 1,
    select: {
      processInstance: {
        select: {
          status: true,
          currentStepNumber: true,
          processDefinition: {
            select: {
              steps: {
                select: {
                  stepNumber: true,
                  documentType: { select: { code: true } },
                  documentSubtype: { select: { code: true } },
                },
              },
            },
          },
        },
      },
    },
  },
} satisfies Prisma.DocumentSelect;

type RawDocument = Prisma.DocumentGetPayload<{ select: typeof documentListSelect }>;

export type DocumentRow = {
  id: string;
  documentNumber: string;
  title: string;
  status: DocumentStatus;
  statusLabel: string;
  documentType: { id: string; code: string; name: string };
  documentSubtype: { id: string; code: string; name: string } | null;
  project: { id: string; code: string; name: string; locationName: string | null } | null;
  currentVersion: number;
  currentWorkflowStep: number | null;
  currentLevelName: string | null;
  // When the current level started waiting (used for aging).
  waitingSince: Date | null;
  createdAt: Date;
  updatedAt: Date;
  approvedAt: Date | null;
  receivedAt: Date | null;
  latestComment: string | null;
  downloadedAt: Date | null;
  createdBy: { name: string };
  // Who the document is waiting for: named users and user types at the current level.
  currentApprover: { name: string } | null;
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
  const processInstance = document.processLinks[0]?.processInstance ?? null;

  return {
    id: document.id,
    documentNumber: document.documentNumber,
    title: document.title,
    status: document.status,
    statusLabel: getDocumentStatusDisplay(document.status, { levelNumber, name: currentStep?.name }),
    documentType: document.documentType,
    documentSubtype: document.documentSubtype,
    project: document.project
      ? {
          id: document.project.id,
          code: document.project.code,
          name: document.project.name,
          locationName: document.project.location?.name ?? null,
        }
      : null,
    currentVersion: document.currentVersion,
    currentWorkflowStep: levelNumber,
    currentLevelName: currentStep?.name ?? null,
    waitingSince: document.currentApproverAssignedAt,
    createdAt: document.createdAt,
    updatedAt: document.updatedAt,
    approvedAt: document.approvedAt,
    receivedAt: document.receivedAt,
    latestComment,
    downloadedAt: document.downloadedAt,
    createdBy: { name: document.createdBy.name },
    currentApprover: names.length > 0 ? { name: names.join(", ") } : null,
    rejection: rejection
      ? { comments: rejection.comments, levelNumber: rejection.levelNumber, performedByName: rejection.performedBy.name }
      : null,
    processStatus: processInstance?.status ?? null,
    processStatusLabel: processInstance
      ? getProcessStatusLabel(processInstance.status, processInstance.currentStepNumber, processInstance.processDefinition.steps)
      : null,
  };
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
      if (
        document.status === DocumentStatus.PENDING &&
        document.approvals[0]?.action === ApprovalActionType.RESUBMITTED &&
        document.approvals.find((entry) => entry.action === ApprovalActionType.REQUESTED_REVISION)?.performedById !== user.userId
      ) return false;
      if (document.status === DocumentStatus.REVISION_REQUIRED && level === 0 && document.createdById === user.userId) return true;

      const step = document.approvalSteps.find((candidate) => candidate.levelNumber === level);
      if (!step) return false;

      return canAct(step.approvers, {
        projectId: document.projectId,
        locationId: document.project?.locationId ?? null,
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
    listDocuments({ approvals: { some: { performedById: userId, action: { in: [ApprovalActionType.APPROVED, ApprovalActionType.DELEGATED_APPROVED] } } } }),
    listDocuments({ approvals: { some: { performedById: userId, action: ApprovalActionType.REJECTED } } }),
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
