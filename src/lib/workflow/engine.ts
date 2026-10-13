import "server-only";

import {
  ApprovalActionType,
  DocumentStatus,
  EmailEventType,
  StepStatus,
  type Prisma,
} from "@prisma/client";
import type { NotificationKind } from "@/lib/notifications";
import { USER_TYPE, type UserTypeCode } from "@/lib/auth/roles";
import { resolveFlow } from "@/lib/workflow/resolve-flow";
import { getEligibleRecipients, loadDocScope, resolveActorEligibility } from "@/lib/workflow/eligibility";
import { advanceProcessesForApprovedDocument } from "@/lib/workflow/processes";
import { WorkflowError } from "@/lib/workflow/errors";

type Tx = Prisma.TransactionClient;

export type WorkflowActor = { id: string; userType: UserTypeCode };

export type NotificationEffect = {
  userId: string;
  type: NotificationKind;
  title: string;
  message: string;
  documentId: string;
};

export type EmailEffect = { recipientId: string; type: EmailEventType; documentId: string };

/** Side effects to send AFTER the transaction commits (see dispatchWorkflowEffects). */
export type WorkflowEffects = { notifications: NotificationEffect[]; emailEvents: EmailEffect[] };

export type WorkflowResult = {
  documentId: string;
  status: DocumentStatus;
  currentWorkflowStep: number | null;
  effects: WorkflowEffects;
};

export type WorkflowActionInput =
  | { action: "APPROVE"; comment?: string | null; versionId?: string | null; outputVersionId?: string | null }
  | { action: "REJECT"; comment?: string | null; versionId?: string | null }
  | { action: "REQUEST_REVISION"; comment: string; targetLevel: number; versionId?: string | null }
  | { action: "HOLD"; comment?: string | null }
  | { action: "RESUME"; comment?: string | null }
  | { action: "RESUBMIT"; comment?: string | null; versionId?: string | null };

const documentInclude = {
  approvalSteps: {
    orderBy: { levelNumber: "asc" },
    include: { approvers: true },
  },
} satisfies Prisma.DocumentInclude;

type LoadedDocument = Prisma.DocumentGetPayload<{ include: typeof documentInclude }>;

async function loadDocument(tx: Tx, documentId: string): Promise<LoadedDocument> {
  const document = await tx.document.findUnique({ where: { id: documentId }, include: documentInclude });
  if (!document) throw new WorkflowError("Document not found.", 404);
  return document;
}

// Optimistic lock: two people acting on the same level at once can never both succeed.
async function saveDocument(tx: Tx, document: { id: string; lockVersion: number }, data: Prisma.DocumentUncheckedUpdateManyInput) {
  const result = await tx.document.updateMany({
    where: { id: document.id, lockVersion: document.lockVersion },
    data: { ...data, lockVersion: { increment: 1 } },
  });
  if (result.count === 0) {
    throw new WorkflowError("This document was changed by someone else. Reload and try again.", 409);
  }
}

async function addHistory(
  tx: Tx,
  entry: {
    documentId: string;
    action: ApprovalActionType;
    actorId: string;
    onBehalfOfUserId?: string | null;
    comments?: string | null;
    levelNumber?: number | null;
    fromStatus?: DocumentStatus | null;
    toStatus?: DocumentStatus | null;
    revisionTargetLevel?: number | null;
    versionId?: string | null;
    outputVersionId?: string | null;
    revisionNumber: number;
  },
) {
  await tx.approvalHistory.create({
    data: {
      documentId: entry.documentId,
      action: entry.action,
      performedById: entry.actorId,
      onBehalfOfUserId: entry.onBehalfOfUserId ?? null,
      comments: entry.comments?.trim() || null,
      levelNumber: entry.levelNumber ?? null,
      fromStatus: entry.fromStatus ?? null,
      toStatus: entry.toStatus ?? null,
      revisionTargetLevel: entry.revisionTargetLevel ?? null,
      versionId: entry.versionId ?? null,
      outputVersionId: entry.outputVersionId ?? null,
      revisionNumber: entry.revisionNumber,
    },
  });
}

function emptyEffects(): WorkflowEffects {
  return { notifications: [], emailEvents: [] };
}

function label(document: { documentNumber: string; title: string }) {
  return `${document.documentNumber} - ${document.title}`;
}

/** Everyone who should hear that a level is waiting: all eligible approvers except admin users. */
async function notifyLevel(
  tx: Tx,
  document: LoadedDocument,
  levelNumber: number,
  effects: WorkflowEffects,
  titleOverride?: { type: NotificationKind; title: string },
) {
  const step = document.approvalSteps.find((candidate) => candidate.levelNumber === levelNumber);
  if (!step) return;

  const scope = await loadDocScope(tx, document);
  const recipients = await getEligibleRecipients(tx, step.approvers, scope);

  for (const recipient of recipients) {
    effects.notifications.push({
      userId: recipient.id,
      type: titleOverride?.type ?? "PENDING_APPROVAL",
      title: titleOverride?.title ?? "Approval required",
      message: label(document),
      documentId: document.id,
    });
    effects.emailEvents.push({ recipientId: recipient.id, type: EmailEventType.APPROVAL_PENDING, documentId: document.id });
  }
}

function notifyCreator(document: LoadedDocument, effects: WorkflowEffects, type: NotificationKind, title: string) {
  effects.notifications.push({ userId: document.createdById, type, title, message: label(document), documentId: document.id });
}

/** Finish a document that needs no (more) approval and let any waiting process runs move on. */
async function markApproved(tx: Tx, document: LoadedDocument) {
  await saveDocument(tx, document, {
    status: DocumentStatus.APPROVED,
    approvedAt: new Date(),
    currentWorkflowStep: null,
    currentApproverAssignedAt: null,
  });
  await advanceProcessesForApprovedDocument(tx, document.id);
}

/**
 * Called right after a document row (and its first file version) is created.
 * Copies the flow onto the document and starts level 1, or approves it at once if no flow applies.
 * Upload permission must already have been checked with canUserUpload().
 */
export async function startApproval(
  tx: Tx,
  input: { documentId: string; actor: WorkflowActor; versionId?: string | null },
): Promise<WorkflowResult> {
  const document = await loadDocument(tx, input.documentId);
  const effects = emptyEffects();

  const flow = await resolveFlow(tx, document);
  const approvalLevels = flow.kind === "flow" ? flow.template.steps.filter((step) => step.stepNumber > 0) : [];

  if (flow.kind === "auto" || approvalLevels.length === 0) {
    await markApproved(tx, document);
    await addHistory(tx, {
      documentId: document.id,
      action: ApprovalActionType.AUTO_APPROVED,
      actorId: input.actor.id,
      levelNumber: 0,
      toStatus: DocumentStatus.APPROVED,
      versionId: input.versionId,
      revisionNumber: document.revisionNumber,
    });
    return { documentId: document.id, status: DocumentStatus.APPROVED, currentWorkflowStep: null, effects };
  }

  const firstLevel = approvalLevels[0].stepNumber;
  const now = new Date();

  for (const step of flow.template.steps) {
    const status =
      step.stepNumber === 0 ? StepStatus.APPROVED : step.stepNumber === firstLevel ? StepStatus.PENDING : StepStatus.WAITING;

    await tx.documentApprovalStep.create({
      data: {
        documentId: document.id,
        levelNumber: step.stepNumber,
        name: step.name,
        status,
        actedById: step.stepNumber === 0 ? input.actor.id : null,
        actedAt: step.stepNumber === 0 ? now : null,
        approvers: {
          create: step.approvers.map((entry) => ({
            approverType: entry.approverType,
            userId: entry.userId,
            userTypeId: entry.userTypeId,
          })),
        },
      },
    });
  }

  await saveDocument(tx, document, {
    workflowTemplateId: flow.template.id,
    status: DocumentStatus.PENDING,
    currentWorkflowStep: firstLevel,
    currentApproverAssignedAt: now,
  });

  await addHistory(tx, {
    documentId: document.id,
    action: ApprovalActionType.SUBMITTED,
    actorId: input.actor.id,
    levelNumber: 0,
    toStatus: DocumentStatus.PENDING,
    versionId: input.versionId,
    revisionNumber: document.revisionNumber,
  });

  const refreshed = await loadDocument(tx, document.id);
  await notifyLevel(tx, refreshed, firstLevel, effects);

  return { documentId: document.id, status: DocumentStatus.PENDING, currentWorkflowStep: firstLevel, effects };
}

function requireCurrentStep(document: LoadedDocument) {
  if (document.currentWorkflowStep === null) throw new WorkflowError("This document is not waiting at any level.", 409);
  const step = document.approvalSteps.find((candidate) => candidate.levelNumber === document.currentWorkflowStep);
  if (!step) throw new WorkflowError("The current approval level could not be found.", 409);
  return step;
}

/** Approve, reject, request a revision, hold, resume or resubmit. Checks who may act, then moves the document. */
export async function performWorkflowAction(
  tx: Tx,
  params: { documentId: string; actor: WorkflowActor; input: WorkflowActionInput },
): Promise<WorkflowResult> {
  const { actor, input } = params;
  const document = await loadDocument(tx, params.documentId);
  const effects = emptyEffects();
  const scope = await loadDocScope(tx, document);

  // ---- Resubmit: the document is back with the uploader (level 0) ----
  if (input.action === "RESUBMIT") {
    if (document.status !== DocumentStatus.REVISION_REQUIRED) {
      throw new WorkflowError("Only a document sent back to the uploader can be resubmitted.", 409);
    }
    const uploaderStep = document.approvalSteps.find((step) => step.levelNumber === 0);
    const isAllowed =
      actor.userType === USER_TYPE.ADMIN ||
      actor.id === document.createdById ||
      (uploaderStep ? (await resolveActorEligibility(tx, actor.id, uploaderStep.approvers, scope, false)).allowed : false);
    if (!isAllowed) throw new WorkflowError("You cannot resubmit this document.", 403);

    const nextLevel = document.approvalSteps.find((step) => step.levelNumber > 0)?.levelNumber ?? null;
    if (nextLevel === null) throw new WorkflowError("This document has no approval levels.", 409);

    const now = new Date();
    await tx.documentApprovalStep.updateMany({
      where: { documentId: document.id, levelNumber: 0 },
      data: { status: StepStatus.APPROVED, actedById: actor.id, actedAt: now, comment: input.comment?.trim() || null },
    });
    await tx.documentApprovalStep.updateMany({
      where: { documentId: document.id, levelNumber: nextLevel },
      data: { status: StepStatus.PENDING },
    });
    await saveDocument(tx, document, {
      status: DocumentStatus.PENDING,
      currentWorkflowStep: nextLevel,
      currentApproverAssignedAt: now,
    });
    await addHistory(tx, {
      documentId: document.id,
      action: ApprovalActionType.RESUBMITTED,
      actorId: actor.id,
      comments: input.comment,
      levelNumber: 0,
      fromStatus: DocumentStatus.REVISION_REQUIRED,
      toStatus: DocumentStatus.PENDING,
      versionId: input.versionId,
      revisionNumber: document.revisionNumber,
    });

    await notifyLevel(tx, await loadDocument(tx, document.id), nextLevel, effects);
    return { documentId: document.id, status: DocumentStatus.PENDING, currentWorkflowStep: nextLevel, effects };
  }

  // ---- Every other action happens at the current level ----
  const step = requireCurrentStep(document);
  const level = step.levelNumber;

  const eligibility = await resolveActorEligibility(tx, actor.id, step.approvers, scope);
  if (!eligibility.allowed) throw new WorkflowError("You are not an approver for the current level of this document.", 403);
  const onBehalfOfUserId = eligibility.onBehalfOfUserId;
  const now = new Date();

  if (input.action === "RESUME") {
    if (document.status !== DocumentStatus.ON_HOLD) throw new WorkflowError("This document is not on hold.", 409);
    await tx.documentApprovalStep.update({ where: { id: step.id }, data: { status: StepStatus.PENDING } });
    await saveDocument(tx, document, { status: DocumentStatus.PENDING, currentApproverAssignedAt: now });
    await addHistory(tx, {
      documentId: document.id, action: ApprovalActionType.RESUMED, actorId: actor.id, onBehalfOfUserId,
      comments: input.comment, levelNumber: level, fromStatus: DocumentStatus.ON_HOLD, toStatus: DocumentStatus.PENDING,
      revisionNumber: document.revisionNumber,
    });
    notifyCreator(document, effects, "DOCUMENT_RESUMED", "Document resumed");
    return { documentId: document.id, status: DocumentStatus.PENDING, currentWorkflowStep: level, effects };
  }

  if (document.status !== DocumentStatus.PENDING) {
    throw new WorkflowError("This document is not waiting for approval.", 409);
  }

  if (input.action === "HOLD") {
    await tx.documentApprovalStep.update({ where: { id: step.id }, data: { status: StepStatus.ON_HOLD } });
    await saveDocument(tx, document, { status: DocumentStatus.ON_HOLD });
    await addHistory(tx, {
      documentId: document.id, action: ApprovalActionType.PUT_ON_HOLD, actorId: actor.id, onBehalfOfUserId,
      comments: input.comment, levelNumber: level, fromStatus: DocumentStatus.PENDING, toStatus: DocumentStatus.ON_HOLD,
      revisionNumber: document.revisionNumber,
    });
    notifyCreator(document, effects, "DOCUMENT_ON_HOLD", "Document put on hold");
    return { documentId: document.id, status: DocumentStatus.ON_HOLD, currentWorkflowStep: level, effects };
  }

  if (input.action === "REJECT") {
    // The level stays recorded so the journey can show where it was rejected.
    await tx.documentApprovalStep.update({
      where: { id: step.id },
      data: { status: StepStatus.REJECTED, actedById: actor.id, actedAt: now, comment: input.comment?.trim() || null },
    });
    await saveDocument(tx, document, { status: DocumentStatus.CANCELLED, lastActiveStage: DocumentStatus.PENDING });
    await addHistory(tx, {
      documentId: document.id, action: ApprovalActionType.REJECTED, actorId: actor.id, onBehalfOfUserId,
      comments: input.comment, levelNumber: level, fromStatus: DocumentStatus.PENDING, toStatus: DocumentStatus.CANCELLED,
      versionId: input.versionId, revisionNumber: document.revisionNumber,
    });
    notifyCreator(document, effects, "DOCUMENT_REJECTED", "Document rejected");
    effects.emailEvents.push({ recipientId: document.createdById, type: EmailEventType.WORKFLOW_REJECTED, documentId: document.id });
    return { documentId: document.id, status: DocumentStatus.CANCELLED, currentWorkflowStep: level, effects };
  }

  if (input.action === "REQUEST_REVISION") {
    const comment = input.comment?.trim();
    if (!comment) throw new WorkflowError("A comment is required when requesting a revision.", 400);
    const target = input.targetLevel;
    const targetStep = document.approvalSteps.find((candidate) => candidate.levelNumber === target);
    if (!targetStep || target >= level) {
      throw new WorkflowError("Choose an earlier step to send the document back to.", 400);
    }

    // The target step and every step after it run again.
    await tx.documentApprovalStep.updateMany({
      where: { documentId: document.id, levelNumber: { gte: target } },
      data: { status: StepStatus.WAITING, actedById: null, actedAt: null, comment: null },
    });

    const toUploader = target === 0;
    await tx.documentApprovalStep.updateMany({
      where: { documentId: document.id, levelNumber: target },
      data: { status: toUploader ? StepStatus.REVISION : StepStatus.PENDING },
    });

    const newStatus = toUploader ? DocumentStatus.REVISION_REQUIRED : DocumentStatus.PENDING;
    await saveDocument(tx, document, {
      status: newStatus,
      currentWorkflowStep: target,
      currentApproverAssignedAt: now,
      revisionNumber: { increment: 1 },
    });
    await addHistory(tx, {
      documentId: document.id, action: ApprovalActionType.REQUESTED_REVISION, actorId: actor.id, onBehalfOfUserId,
      comments: comment, levelNumber: level, fromStatus: DocumentStatus.PENDING, toStatus: newStatus,
      revisionTargetLevel: target, versionId: input.versionId, revisionNumber: document.revisionNumber,
    });

    notifyCreator(document, effects, "DOCUMENT_REVISED", "Revision requested");
    if (toUploader) {
      effects.emailEvents.push({ recipientId: document.createdById, type: EmailEventType.APPROVAL_PENDING, documentId: document.id });
    }
    if (!toUploader) {
      await notifyLevel(tx, await loadDocument(tx, document.id), target, effects);
    }
    return { documentId: document.id, status: newStatus, currentWorkflowStep: target, effects };
  }

  // ---- APPROVE ----
  await tx.documentApprovalStep.update({
    where: { id: step.id },
    data: { status: StepStatus.APPROVED, actedById: actor.id, actedAt: now, comment: input.comment?.trim() || null },
  });

  const nextStep = document.approvalSteps.find((candidate) => candidate.levelNumber > level);
  const action = onBehalfOfUserId ? ApprovalActionType.DELEGATED_APPROVED : ApprovalActionType.APPROVED;

  if (nextStep) {
    await tx.documentApprovalStep.update({ where: { id: nextStep.id }, data: { status: StepStatus.PENDING } });
    await saveDocument(tx, document, { currentWorkflowStep: nextStep.levelNumber, currentApproverAssignedAt: now });
    await addHistory(tx, {
      documentId: document.id, action, actorId: actor.id, onBehalfOfUserId, comments: input.comment,
      levelNumber: level, fromStatus: DocumentStatus.PENDING, toStatus: DocumentStatus.PENDING,
      versionId: input.versionId, outputVersionId: input.outputVersionId, revisionNumber: document.revisionNumber,
    });
    await notifyLevel(tx, await loadDocument(tx, document.id), nextStep.levelNumber, effects);
    return { documentId: document.id, status: DocumentStatus.PENDING, currentWorkflowStep: nextStep.levelNumber, effects };
  }

  await markApproved(tx, document);
  await addHistory(tx, {
    documentId: document.id, action, actorId: actor.id, onBehalfOfUserId, comments: input.comment,
    levelNumber: level, fromStatus: DocumentStatus.PENDING, toStatus: DocumentStatus.APPROVED,
    versionId: input.versionId, outputVersionId: input.outputVersionId, revisionNumber: document.revisionNumber,
  });
  notifyCreator(document, effects, "DOCUMENT_APPROVED", "Document approved");
  effects.emailEvents.push({ recipientId: document.createdById, type: EmailEventType.WORKFLOW_APPROVED, documentId: document.id });
  return { documentId: document.id, status: DocumentStatus.APPROVED, currentWorkflowStep: null, effects };
}

/** Archive (approved or rejected documents only) or restore a document. Caller checks documents.archive. */
export async function setDocumentArchived(
  tx: Tx,
  params: { documentId: string; actor: WorkflowActor; archived: boolean },
): Promise<WorkflowResult> {
  const document = await loadDocument(tx, params.documentId);

  if (params.archived) {
    if (document.status !== DocumentStatus.APPROVED && document.status !== DocumentStatus.CANCELLED) {
      throw new WorkflowError("Only approved or rejected documents can be archived.", 409);
    }
    await saveDocument(tx, document, { status: DocumentStatus.ARCHIVED, lastActiveStage: document.status });
    await addHistory(tx, {
      documentId: document.id, action: ApprovalActionType.ARCHIVED, actorId: params.actor.id,
      fromStatus: document.status, toStatus: DocumentStatus.ARCHIVED, revisionNumber: document.revisionNumber,
    });
    return { documentId: document.id, status: DocumentStatus.ARCHIVED, currentWorkflowStep: document.currentWorkflowStep, effects: emptyEffects() };
  }

  if (document.status !== DocumentStatus.ARCHIVED) throw new WorkflowError("This document is not archived.", 409);
  const restored = document.lastActiveStage ?? DocumentStatus.APPROVED;
  await saveDocument(tx, document, { status: restored });
  await addHistory(tx, {
    documentId: document.id, action: ApprovalActionType.ARCHIVED, actorId: params.actor.id,
    comments: "Restored from archive", fromStatus: DocumentStatus.ARCHIVED, toStatus: restored,
    revisionNumber: document.revisionNumber,
  });
  return { documentId: document.id, status: restored, currentWorkflowStep: document.currentWorkflowStep, effects: emptyEffects() };
}

