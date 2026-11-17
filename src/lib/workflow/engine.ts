import "server-only";

import {
  ApprovalActionType,
  ApproverType,
  DocumentStatus,
  EmailEventType,
  StepStatus,
  type Prisma,
} from "@prisma/client";
import type { NotificationKind } from "@/lib/notifications";
import { USER_TYPE, type UserTypeCode } from "@/lib/auth/roles";
import { resolveFlow } from "@/lib/workflow/resolve-flow";
import { getEligibleRecipients, loadDocScope, resolveActorEligibility } from "@/lib/workflow/eligibility";
import { getWatchRecipients } from "@/lib/workflow/mailing-list";
import { notifyProcessFollowers } from "@/lib/workflow/mail-follow";
import { WATCH_KIND_FOR_EVENT, type MailEvent, type MailKind } from "@/lib/mailing-list-config";
import { advanceProcessesForApprovedDocument, handleProcessDocumentRejected } from "@/lib/workflow/processes";
import { WorkflowError } from "@/lib/workflow/errors";
import { userHasPermissionForDocument } from "@/lib/auth/access";
import { SEND_FOR_APPROVAL_PERMISSION, UNIQUE_TRACK_PERMISSION, nextSideApprovalLevel, previousLevel, trackLevelNumber } from "@/lib/workflow/tracks";

type Tx = Prisma.TransactionClient;

export type WorkflowActor = { id: string; userType: UserTypeCode };

export type NotificationEffect = {
  userId: string;
  type: NotificationKind;
  title: string;
  message: string;
  documentId: string;
};

// kind: which kind of email this is on the Mailing List page. Left out, it follows from the type (approval pending =
// "awaiting review", approved = "my document approved", ...). Only the "any document" emails set it themselves.
export type EmailEffect = { recipientId: string; type: EmailEventType; documentId: string; kind?: MailKind; delivery?: "OFF" | "DIGEST" | "INSTANT" };

/** Side effects to send AFTER the transaction commits (see dispatchWorkflowEffects). */
export type WorkflowEffects = { notifications: NotificationEffect[]; emailEvents: EmailEffect[] };

export type WorkflowResult = {
  documentId: string;
  status: DocumentStatus;
  currentWorkflowStep: number | null;
  effects: WorkflowEffects;
  // Set by actions that need their own entry in the audit log (the route falls back to its default names otherwise).
  auditAction?: string;
  // Upload only: the uploader is the approver of the first level, which needs their signature, so they should be
  // taken straight to the review page to sign it.
  uploaderShouldSign?: boolean;
  auditDetails?: Record<string, unknown>;
};

export type WorkflowActionInput =
  // trackId: send the document down one of the unique tracks of the current level instead of the normal next step.
  | { action: "APPROVE"; comment?: string | null; versionId?: string | null; outputVersionId?: string | null; trackId?: string | null }
  | { action: "REJECT"; comment?: string | null; versionId?: string | null }
  | { action: "REQUEST_REVISION"; comment: string; targetLevel?: number | null; versionId?: string | null }
  | { action: "HOLD"; comment?: string | null }
  | { action: "RESUME"; comment?: string | null }
  | { action: "RESUBMIT"; comment?: string | null; versionId?: string | null }
  // Send the document at the current level to one chosen user. When they approve, it comes back to the sender.
  | { action: "SEND_FOR_APPROVAL"; recipientUserId: string; signatureRequired?: boolean; comment?: string | null; versionId?: string | null };

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

const MAIL_EVENT_EFFECTS: Record<MailEvent, { email: EmailEventType; notification: NotificationKind; title: string }> = {
  APPROVED: { email: EmailEventType.WORKFLOW_APPROVED, notification: "DOCUMENT_APPROVED", title: "Document approved" },
  REJECTED: { email: EmailEventType.WORKFLOW_REJECTED, notification: "DOCUMENT_REJECTED", title: "Document rejected" },
  REVISION: { email: EmailEventType.WORKFLOW_REVISION_REQUESTED, notification: "DOCUMENT_REVISED", title: "Revision requested" },
};

/**
 * Also tell everyone who follows this kind of event on the Mailing List page. Whether and how they get an email
 * (instant, in the summary, or not at all) is decided when the email events are queued: a person gets ONE email per
 * document, from the first of their kinds that is not Off. So the uploader who is also on an "Any document ..." list
 * still gets that email when their own "My document ..." email is Off. Nobody gets a second in-app notification.
 */
async function notifyMailingList(
  tx: Tx,
  document: LoadedDocument,
  event: MailEvent,
  effects: WorkflowEffects,
  // The person who just acted (and who they acted for) already know; they are not mailed about their own action.
  actedBy: Array<string | null | undefined>,
) {
  const members = await getWatchRecipients(tx, event, {
    id: document.id,
    projectId: document.projectId,
    documentTypeId: document.documentTypeId,
    documentSubtypeId: document.documentSubtypeId,
  });

  const actors = new Set(actedBy.filter((id): id is string => Boolean(id)));
  const notified = new Set(effects.notifications.filter((entry) => entry.documentId === document.id).map((entry) => entry.userId));
  const kind = MAIL_EVENT_EFFECTS[event];

  for (const member of members) {
    if (actors.has(member.id)) continue;
    if (!notified.has(member.id)) {
      effects.notifications.push({ userId: member.id, type: kind.notification, title: kind.title, message: label(document), documentId: document.id });
      notified.add(member.id);
    }
    effects.emailEvents.push({ recipientId: member.id, type: kind.email, documentId: document.id, kind: WATCH_KIND_FOR_EVENT[event] });
  }
}

function notifyCreator(document: LoadedDocument, effects: WorkflowEffects, type: NotificationKind, title: string) {
  effects.notifications.push({ userId: document.createdById, type, title, message: label(document), documentId: document.id });
}

/** Finish a document that needs no (more) approval and let any waiting process runs move on. */
async function markApproved(tx: Tx, document: LoadedDocument, effects: WorkflowEffects) {
  await saveDocument(tx, document, {
    status: DocumentStatus.APPROVED,
    approvedAt: new Date(),
    currentWorkflowStep: null,
    currentApproverAssignedAt: null,
  });
  await advanceProcessesForApprovedDocument(tx, document.id, effects);
}

/** Taking a unique track needs the "Use unique tracks" permission for the document (Admin users always have it). */
async function requireUniqueTrackPermission(
  tx: Tx,
  actor: WorkflowActor,
  document: { projectId: string | null; documentTypeId: string; documentSubtypeId: string | null },
): Promise<void> {
  const allowed = await userHasPermissionForDocument(
    { userId: actor.id, userType: actor.userType },
    UNIQUE_TRACK_PERMISSION,
    { projectId: document.projectId, documentTypeId: document.documentTypeId, documentSubtypeId: document.documentSubtypeId },
    tx,
  );
  if (!allowed) throw new WorkflowError("You do not have permission to use unique tracks for this document.", 403);
}

/**
 * Sends the document down one of the unique tracks of a level (the uploader level included): the level counts as done,
 * the levels the track jumps over are marked skipped, and the track's receiver gets a step of their own. When the
 * receiver approves, the document goes to the track's return level, or counts as fully approved.
 * The caller has already checked that the actor may act at `originLevel` and marked that level done.
 */
async function enterTrack(
  tx: Tx,
  document: LoadedDocument,
  input: { originLevel: number; trackId?: string | null; trackSortOrder?: number | null; actor: WorkflowActor; onBehalfOfUserId?: string | null; now: Date; versionId?: string | null },
  effects: WorkflowEffects,
) {
  const origin = document.approvalSteps.find((candidate) => candidate.levelNumber === input.originLevel && !candidate.isTrackStep && !candidate.isSideApproval);
  if (!origin) throw new WorkflowError("The level this track belongs to could not be found.", 409);

  const tracks = await tx.documentApprovalTrack.findMany({ where: { stepId: origin.id }, orderBy: { sortOrder: "asc" } });
  const track = input.trackId ? tracks.find((candidate) => candidate.id === input.trackId) : tracks.find((candidate) => candidate.sortOrder === input.trackSortOrder);
  if (!track) throw new WorkflowError("That unique track is not available at this level.", 400);

  const returnStep = track.returnLevel === null ? null : document.approvalSteps.find((candidate) => !candidate.isTrackStep && !candidate.isSideApproval && candidate.levelNumber === track.returnLevel);
  if (track.returnLevel !== null && (!returnStep || returnStep.levelNumber <= origin.levelNumber)) {
    throw new WorkflowError("The stage this track returns to no longer exists.", 409);
  }

  const receiver = await tx.user.findUnique({ where: { id: track.receiverUserId }, select: { name: true, isActive: true } });
  if (!receiver || !receiver.isActive) throw new WorkflowError("The person this track sends the document to is no longer active.", 409);

  // Levels between here and the return stage (or all later levels, for "full approval") are bypassed.
  const bypassed = document.approvalSteps.filter(
    (candidate) =>
      !candidate.isTrackStep &&
      !candidate.isSideApproval &&
      candidate.levelNumber > origin.levelNumber &&
      candidate.status === StepStatus.WAITING &&
      (track.returnLevel === null || candidate.levelNumber < track.returnLevel),
  );
  if (bypassed.length > 0) {
    await tx.documentApprovalStep.updateMany({ where: { id: { in: bypassed.map((candidate) => candidate.id) } }, data: { status: StepStatus.SKIPPED } });
  }

  const trackLevel = trackLevelNumber(origin.levelNumber, track.sortOrder);
  const existing = document.approvalSteps.find((candidate) => candidate.levelNumber === trackLevel);
  if (existing) {
    await tx.documentApprovalStep.update({ where: { id: existing.id }, data: { status: StepStatus.PENDING, actedById: null, actedAt: null, comment: null } });
  } else {
    await tx.documentApprovalStep.create({
      data: {
        documentId: document.id,
        levelNumber: trackLevel,
        name: track.name,
        signatureRequired: track.signatureRequired,
        status: StepStatus.PENDING,
        isTrackStep: true,
        originLevel: origin.levelNumber,
        returnLevel: track.returnLevel,
        approvers: { create: [{ approverType: ApproverType.USER, userId: track.receiverUserId, userTypeId: null }] },
      },
    });
  }

  await saveDocument(tx, document, { status: DocumentStatus.PENDING, currentWorkflowStep: trackLevel, currentApproverAssignedAt: input.now });
  const returnLabel = returnStep ? returnStep.name?.trim() || `level ${returnStep.levelNumber}` : "full approval";
  await addHistory(tx, {
    documentId: document.id,
    action: ApprovalActionType.UNIQUE_TRACK,
    actorId: input.actor.id,
    onBehalfOfUserId: input.onBehalfOfUserId,
    levelNumber: origin.levelNumber,
    fromStatus: document.status === DocumentStatus.PENDING ? DocumentStatus.PENDING : null,
    toStatus: DocumentStatus.PENDING,
    comments: `Sent via the unique track "${track.name}" to ${receiver.name}. After approval: ${returnLabel}.`,
    versionId: input.versionId,
    revisionNumber: document.revisionNumber,
  });

  await notifyLevel(tx, await loadDocument(tx, document.id), trackLevel, effects);
  return trackLevel;
}

/**
 * Called right after a document row (and its first file version) is created.
 * Copies the flow onto the document and starts level 1, or approves it at once if no flow applies.
 * With trackSortOrder the uploader sends it down one of the flow's unique tracks of the uploader level instead.
 * Upload permission must already have been checked with canUserUpload().
 */
export async function startApproval(
  tx: Tx,
  input: { documentId: string; actor: WorkflowActor; versionId?: string | null; trackSortOrder?: number | null },
): Promise<WorkflowResult> {
  const document = await loadDocument(tx, input.documentId);
  const effects = emptyEffects();

  const flow = await resolveFlow(tx, document);
  const approvalLevels = flow.kind === "flow" ? flow.template.steps.filter((step) => step.stepNumber > 0) : [];
  const wantsTrack = input.trackSortOrder !== null && input.trackSortOrder !== undefined;

  if (flow.kind === "auto" || approvalLevels.length === 0) {
    if (wantsTrack) throw new WorkflowError("This document has no approval flow, so there is no unique track to take.", 400);
    await markApproved(tx, document, effects);
    await addHistory(tx, {
      documentId: document.id,
      action: ApprovalActionType.AUTO_APPROVED,
      actorId: input.actor.id,
      levelNumber: 0,
      toStatus: DocumentStatus.APPROVED,
      versionId: input.versionId,
      revisionNumber: document.revisionNumber,
    });
    // No approval needed: it is fully approved now, so the "Any document fully approved" lists hear about it like any
    // other approval. Reference documents are never announced. (Follow-up rules are told once the document sits in its
    // process run, by the upload.)
    if (!document.isReference) await notifyMailingList(tx, document, "APPROVED", effects, [input.actor.id]);
    return { documentId: document.id, status: DocumentStatus.APPROVED, currentWorkflowStep: null, effects };
  }

  if (wantsTrack && !flow.template.steps.find((step) => step.stepNumber === 0)?.tracks.some((track) => track.sortOrder === input.trackSortOrder)) {
    throw new WorkflowError("That unique track is not available for this document.", 400);
  }
  if (wantsTrack) await requireUniqueTrackPermission(tx, input.actor, document);

  // A level set to "Project Director" / "Project Manager" whose project has none does not stop the upload: the level is
  // marked as waiting for that person ("Pending Project Director - No PD Assigned"). When the project gets one, they
  // are added to the level (Projects & Locations); an Admin user can also send the level to someone.

  const firstLevel = approvalLevels[0].stepNumber;
  const now = new Date();

  for (const step of flow.template.steps) {
    // With a track the first level is not started: the track decides where the document goes.
    const status =
      step.stepNumber === 0 ? StepStatus.APPROVED : step.stepNumber === firstLevel && !wantsTrack ? StepStatus.PENDING : StepStatus.WAITING;

    await tx.documentApprovalStep.create({
      data: {
        documentId: document.id,
        levelNumber: step.stepNumber,
        name: step.name,
        signatureRequired: step.signatureRequired,
        status,
        actedById: step.stepNumber === 0 ? input.actor.id : null,
        actedAt: step.stepNumber === 0 ? now : null,
        awaitingProjectDirector: step.stepNumber > 0 && step.missingRoles.includes(ApproverType.PROJECT_DIRECTOR),
        awaitingProjectManager: step.stepNumber > 0 && step.missingRoles.includes(ApproverType.PROJECT_MANAGER),
        approvers: {
          create: step.approvers.map((entry) => ({
            approverType: entry.approverType,
            userId: entry.userId,
            userTypeId: entry.userTypeId,
            viaProjectDirector: entry.viaProjectDirector === true,
            viaProjectManager: entry.viaProjectManager === true,
          })),
        },
        tracks: {
          create: step.tracks.map((track) => ({
            name: track.name,
            receiverUserId: track.receiverUserId,
            returnLevel: track.returnLevel,
            signatureRequired: track.signatureRequired,
            sortOrder: track.sortOrder,
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

  if (wantsTrack) {
    const trackLevel = await enterTrack(
      tx,
      await loadDocument(tx, document.id),
      { originLevel: 0, trackSortOrder: input.trackSortOrder, actor: input.actor, now, versionId: input.versionId },
      effects,
    );
    return { documentId: document.id, status: DocumentStatus.PENDING, currentWorkflowStep: trackLevel, effects };
  }

  const refreshed = await loadDocument(tx, document.id);

  // The uploader is also the approver of the first level (named, by user type, or as Project Director / Manager; a
  // delegation does not count). Without a signature the level is approved right away; with one, the uploader is sent
  // straight to the review page to sign (the route tells the browser). Admin users count only where the flow names them.
  const firstStep = refreshed.approvalSteps.find((step) => step.levelNumber === firstLevel);
  const uploaderApproves =
    !!firstStep && firstStep.approvers.length > 0 &&
    (await resolveActorEligibility(tx, input.actor.id, firstStep.approvers, await loadDocScope(tx, refreshed), false)).allowed;
  if (uploaderApproves && firstStep && !firstStep.signatureRequired) {
    return performWorkflowAction(tx, {
      documentId: document.id,
      actor: input.actor,
      input: {
        action: "APPROVE",
        comment: "Approved automatically: the uploader is the approver of this level.",
        versionId: input.versionId ?? null,
      },
    });
  }

  await notifyLevel(tx, refreshed, firstLevel, effects);

  return {
    documentId: document.id,
    status: DocumentStatus.PENDING,
    currentWorkflowStep: firstLevel,
    effects,
    uploaderShouldSign: uploaderApproves && !!firstStep?.signatureRequired,
  };
}

/**
 * An Admin user uploads a document that is ALREADY approved (it was approved outside the system, or before the
 * system was in use). No approval levels are copied and nobody is asked to approve: the document is approved on
 * the spot and the history says who registered it. Linking it to a process step afterwards moves the run on.
 * Called right after the document row (and its first file version) is created, instead of startApproval().
 */
export async function registerApprovedDocument(
  tx: Tx,
  input: { documentId: string; actor: WorkflowActor; versionId?: string | null; approvedAt?: Date | null; comments?: string | null },
): Promise<WorkflowResult> {
  if (input.actor.userType !== USER_TYPE.ADMIN) {
    throw new WorkflowError("Only an Admin user can upload an already approved document.", 403);
  }
  const document = await loadDocument(tx, input.documentId);
  const effects = emptyEffects();

  await saveDocument(tx, document, {
    status: DocumentStatus.APPROVED,
    approvedAt: input.approvedAt ?? new Date(),
    currentWorkflowStep: null,
    currentApproverAssignedAt: null,
  });
  await addHistory(tx, {
    documentId: document.id,
    action: ApprovalActionType.AUTO_APPROVED,
    actorId: input.actor.id,
    levelNumber: 0,
    fromStatus: document.status,
    toStatus: DocumentStatus.APPROVED,
    comments: input.comments ?? "Uploaded by an Admin user as an already approved document.",
    versionId: input.versionId,
    revisionNumber: document.revisionNumber,
  });

  return { documentId: document.id, status: DocumentStatus.APPROVED, currentWorkflowStep: null, effects };
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

  // ---- Resubmit: the document is with the earlier step selected for revision ----
  if (input.action === "RESUBMIT") {
    if (document.status !== DocumentStatus.REVISION_REQUIRED) {
      throw new WorkflowError("Only a document sent back for revision can be resubmitted.", 409);
    }
    const revisionRequest = await tx.approvalHistory.findFirst({
      where: { documentId: document.id, action: ApprovalActionType.REQUESTED_REVISION },
      orderBy: { performedAt: "desc" },
      select: { levelNumber: true, revisionTargetLevel: true, performedById: true },
    });
    if (!revisionRequest) throw new WorkflowError("The revision request could not be found.", 409);
    const targetLevel = revisionRequest?.revisionTargetLevel;
    const requesterLevel = revisionRequest?.levelNumber;
    if (
      targetLevel === null || targetLevel === undefined ||
      requesterLevel === null || requesterLevel === undefined ||
      document.currentWorkflowStep !== targetLevel ||
      requesterLevel === targetLevel
    ) {
      throw new WorkflowError("The revision request is missing a valid return step.", 409);
    }
    const revisionStep = document.approvalSteps.find((step) => step.levelNumber === targetLevel);
    const requesterStep = document.approvalSteps.find((step) => step.levelNumber === requesterLevel);
    if (!revisionStep || !requesterStep) {
      throw new WorkflowError("The revision request refers to a missing workflow step.", 409);
    }
    // Sent back to the uploader (level 0): only the person who uploaded it resubmits. Sent back to a later level: the
    // people of that level.
    const isAllowed =
      actor.userType === USER_TYPE.ADMIN ||
      (targetLevel === 0
        ? actor.id === document.createdById
        : (await resolveActorEligibility(tx, actor.id, revisionStep.approvers, scope, false)).allowed);
    if (!isAllowed) throw new WorkflowError("You cannot resubmit this document.", 403);

    const now = new Date();
    await tx.documentApprovalStep.update({
      where: { id: revisionStep.id },
      data: { status: StepStatus.APPROVED, actedById: actor.id, actedAt: now, comment: input.comment?.trim() || null },
    });
    await tx.documentApprovalStep.update({
      where: { id: requesterStep.id },
      data: { status: StepStatus.PENDING },
    });
    await saveDocument(tx, document, {
      status: DocumentStatus.PENDING,
      currentWorkflowStep: requesterLevel,
      currentApproverAssignedAt: now,
    });
    await addHistory(tx, {
      documentId: document.id,
      action: ApprovalActionType.RESUBMITTED,
      actorId: actor.id,
      comments: input.comment,
      levelNumber: targetLevel,
      fromStatus: DocumentStatus.REVISION_REQUIRED,
      toStatus: DocumentStatus.PENDING,
      versionId: input.versionId,
      revisionNumber: document.revisionNumber,
    });

    effects.notifications.push({
      userId: revisionRequest.performedById,
      type: "PENDING_APPROVAL",
      title: "Revised document ready for review",
      message: label(document),
      documentId: document.id,
    });
    effects.emailEvents.push({
      recipientId: revisionRequest.performedById,
      type: EmailEventType.APPROVAL_PENDING,
      documentId: document.id,
    });
    return { documentId: document.id, status: DocumentStatus.PENDING, currentWorkflowStep: requesterLevel, effects };
  }

  // ---- Every other action happens at the current level ----
  const step = requireCurrentStep(document);
  const level = step.levelNumber;

  const latestHistory = await tx.approvalHistory.findFirst({
    where: { documentId: document.id },
    orderBy: { performedAt: "desc" },
    select: { action: true },
  });
  if (latestHistory?.action === ApprovalActionType.RESUBMITTED && actor.userType !== USER_TYPE.ADMIN) {
    const revisionRequest = await tx.approvalHistory.findFirst({
      where: { documentId: document.id, action: ApprovalActionType.REQUESTED_REVISION },
      orderBy: { performedAt: "desc" },
      select: { performedById: true },
    });
    if (revisionRequest?.performedById !== actor.id) {
      throw new WorkflowError("This revised document must be reviewed by the approver who requested the revision.", 403);
    }
  }

  // Admin users may act at any level of any document; everyone else must be named by (or hold a matching assignment for) the level.
  // A document sent back to the uploader belongs to the person who uploaded it: only they (or an Admin user) may cancel it.
  const eligibility =
    actor.userType === USER_TYPE.ADMIN
      ? { allowed: true, onBehalfOfUserId: null }
      : document.status === DocumentStatus.REVISION_REQUIRED && level === 0
        ? { allowed: actor.id === document.createdById, onBehalfOfUserId: null }
        : await resolveActorEligibility(tx, actor.id, step.approvers, scope);
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

  if (
    document.status !== DocumentStatus.PENDING &&
    !(document.status === DocumentStatus.REVISION_REQUIRED && input.action === "REJECT")
  ) {
    throw new WorkflowError("This document is not waiting for approval.", 409);
  }

  if (input.action === "SEND_FOR_APPROVAL") {
    // Admin users always may; everyone else needs the "Send for approval" permission for this document.
    const mayDelegate = await userHasPermissionForDocument(
      { userId: actor.id, userType: actor.userType },
      SEND_FOR_APPROVAL_PERMISSION,
      { projectId: document.projectId, documentTypeId: document.documentTypeId, documentSubtypeId: document.documentSubtypeId },
      tx,
    );
    if (!mayDelegate) throw new WorkflowError("You do not have permission to send documents for approval.", 403);
    if (document.status !== DocumentStatus.PENDING) throw new WorkflowError("Only a document that is waiting for approval can be sent for approval.", 409);

    const recipientId = String(input.recipientUserId || "").trim();
    if (!recipientId) throw new WorkflowError("Choose the person who should approve this document.", 400);
    if (recipientId === actor.id) throw new WorkflowError("You cannot send a document to yourself for approval.", 400);
    const recipient = await tx.user.findUnique({ where: { id: recipientId }, select: { id: true, name: true, isActive: true } });
    if (!recipient || !recipient.isActive) throw new WorkflowError("The person you chose is not an active user.", 400);

    const signatureRequired = input.signatureRequired !== false;
    const sender = await tx.user.findUnique({ where: { id: actor.id }, select: { name: true } });
    const sideLevel = nextSideApprovalLevel(document.approvalSteps.map((candidate) => candidate.levelNumber));

    // The sender's level waits while the chosen person decides.
    await tx.documentApprovalStep.update({ where: { id: step.id }, data: { status: StepStatus.WAITING } });
    await tx.documentApprovalStep.create({
      data: {
        documentId: document.id,
        levelNumber: sideLevel,
        name: `${recipient.name}'s approval`,
        signatureRequired,
        status: StepStatus.PENDING,
        isSideApproval: true,
        originLevel: level,
        returnLevel: level,
        sentById: actor.id,
        approvers: { create: [{ approverType: ApproverType.USER, userId: recipient.id, userTypeId: null }] },
      },
    });
    await saveDocument(tx, document, { currentWorkflowStep: sideLevel, currentApproverAssignedAt: now });

    const note = input.comment?.trim();
    await addHistory(tx, {
      documentId: document.id, action: ApprovalActionType.SENT_FOR_APPROVAL, actorId: actor.id, onBehalfOfUserId,
      comments: `Sent to ${recipient.name} for approval (${signatureRequired ? "signature required" : "no signature required"}). It returns to ${sender?.name ?? "the sender"} afterwards.${note ? ` Comment: ${note}` : ""}`,
      levelNumber: level, fromStatus: DocumentStatus.PENDING, toStatus: DocumentStatus.PENDING,
      versionId: input.versionId, revisionNumber: document.revisionNumber,
    });

    // The chosen person is told even when they are an Admin user (who are normally left out of level notices).
    await notifyLevel(tx, await loadDocument(tx, document.id), sideLevel, effects, { type: "PENDING_APPROVAL", title: `Approval requested by ${sender?.name ?? "a colleague"}` });
    if (!effects.notifications.some((entry) => entry.userId === recipient.id && entry.documentId === document.id)) {
      effects.notifications.push({ userId: recipient.id, type: "PENDING_APPROVAL", title: `Approval requested by ${sender?.name ?? "a colleague"}`, message: label(document), documentId: document.id });
      effects.emailEvents.push({ recipientId: recipient.id, type: EmailEventType.APPROVAL_PENDING, documentId: document.id });
    }

    return {
      documentId: document.id, status: DocumentStatus.PENDING, currentWorkflowStep: sideLevel, effects,
      auditAction: "DOCUMENT_SENT_FOR_APPROVAL",
      auditDetails: { recipientId: recipient.id, recipientName: recipient.name, signatureRequired, fromLevel: level, sideLevel },
    };
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
    // A rejected document reopens its choice in the process tree (or cancels the run when it was the root).
    await handleProcessDocumentRejected(tx, document.id, effects);
    await addHistory(tx, {
      documentId: document.id, action: ApprovalActionType.REJECTED, actorId: actor.id, onBehalfOfUserId,
      comments: input.comment, levelNumber: level, fromStatus: document.status, toStatus: DocumentStatus.CANCELLED,
      versionId: input.versionId, revisionNumber: document.revisionNumber,
    });
    notifyCreator(document, effects, "DOCUMENT_REJECTED", "Document rejected");
    effects.emailEvents.push({ recipientId: document.createdById, type: EmailEventType.WORKFLOW_REJECTED, documentId: document.id });
    await notifyMailingList(tx, document, "REJECTED", effects, [actor.id, onBehalfOfUserId]);
    return { documentId: document.id, status: DocumentStatus.CANCELLED, currentWorkflowStep: level, effects };
  }

  if (input.action === "REQUEST_REVISION") {
    const comment = input.comment?.trim();
    if (!comment) throw new WorkflowError("A comment is required when requesting a revision.", 400);
    // A revision always goes back to the previous level on the document's path; nobody picks it (any targetLevel sent
    // by a client is ignored). Levels a unique track jumped over are passed over; a step created by "Send for
    // approval" goes back to the level it was sent from.
    const targetStep = previousLevel(document.approvalSteps, level);
    const target = targetStep?.levelNumber;
    if (target === undefined || !targetStep) {
      throw new WorkflowError("There is no earlier step to send the document back to.", 400);
    }

    await tx.documentApprovalStep.update({
      where: { id: targetStep.id },
      data: { status: StepStatus.REVISION, actedById: null, actedAt: null, comment: null },
    });
    await tx.documentApprovalStep.update({
      where: { id: step.id },
      data: { status: StepStatus.WAITING },
    });

    await saveDocument(tx, document, {
      status: DocumentStatus.REVISION_REQUIRED,
      currentWorkflowStep: target,
      currentApproverAssignedAt: now,
      revisionNumber: { increment: 1 },
    });
    await addHistory(tx, {
      documentId: document.id, action: ApprovalActionType.REQUESTED_REVISION, actorId: actor.id, onBehalfOfUserId,
      comments: comment, levelNumber: level, fromStatus: DocumentStatus.PENDING, toStatus: DocumentStatus.REVISION_REQUIRED,
      revisionTargetLevel: target, versionId: input.versionId, revisionNumber: document.revisionNumber,
    });

    if (step.isSideApproval) {
      // The person who sent the document for approval hears about it; the rest of their level and the mailing list do not.
      if (step.sentById) {
        effects.notifications.push({ userId: step.sentById, type: "DOCUMENT_REVISED", title: "Revision required", message: label(document), documentId: document.id });
        effects.emailEvents.push({ recipientId: step.sentById, type: EmailEventType.APPROVAL_PENDING, documentId: document.id });
      }
      return {
        documentId: document.id, status: DocumentStatus.REVISION_REQUIRED, currentWorkflowStep: target, effects,
        auditDetails: { sentForApproval: true, returnedToLevel: target, sentById: step.sentById },
      };
    }
    if (target === 0) {
      notifyCreator(document, effects, "DOCUMENT_REVISED", "Revision required");
      effects.emailEvents.push({ recipientId: document.createdById, type: EmailEventType.APPROVAL_PENDING, documentId: document.id });
    } else {
      await notifyLevel(tx, await loadDocument(tx, document.id), target, effects, { type: "DOCUMENT_REVISED", title: "Revision required" });
      // The uploader is not the one who has to act now, but may still want to know their document was sent back.
      effects.emailEvents.push({ recipientId: document.createdById, type: EmailEventType.WORKFLOW_REVISION_REQUESTED, documentId: document.id, kind: "OWN_REVISION" });
    }
    await notifyMailingList(tx, document, "REVISION", effects, [actor.id, onBehalfOfUserId]);
    return { documentId: document.id, status: DocumentStatus.REVISION_REQUIRED, currentWorkflowStep: target, effects };
  }

  // ---- APPROVE ----
  await tx.documentApprovalStep.update({
    where: { id: step.id },
    data: { status: StepStatus.APPROVED, actedById: actor.id, actedAt: now, comment: input.comment?.trim() || null },
  });

  const action = onBehalfOfUserId ? ApprovalActionType.DELEGATED_APPROVED : ApprovalActionType.APPROVED;

  // A step created by "Send for approval": the chosen person approved, so the document goes back to the level (and the
  // person) that sent it. That level has not decided yet; it continues exactly where it stopped.
  if (step.isSideApproval) {
    if (input.trackId) throw new WorkflowError("A unique track cannot be taken from a step that was sent for approval.", 400);
    const origin = document.approvalSteps.find((candidate) => candidate.levelNumber === step.originLevel);
    if (!origin) throw new WorkflowError("The level this document was sent from no longer exists.", 409);
    const sender = step.sentById ? await tx.user.findUnique({ where: { id: step.sentById }, select: { id: true, name: true, isActive: true } }) : null;

    await tx.documentApprovalStep.update({ where: { id: origin.id }, data: { status: StepStatus.PENDING, actedById: null, actedAt: null, comment: null } });
    await saveDocument(tx, document, { currentWorkflowStep: origin.levelNumber, currentApproverAssignedAt: now });
    const note = input.comment?.trim();
    await addHistory(tx, {
      documentId: document.id, action, actorId: actor.id, onBehalfOfUserId,
      comments: `Approved on request and returned to ${sender?.name ?? "the sender"}.${note ? ` Comment: ${note}` : ""}`,
      levelNumber: level, fromStatus: DocumentStatus.PENDING, toStatus: DocumentStatus.PENDING,
      versionId: input.versionId, outputVersionId: input.outputVersionId, revisionNumber: document.revisionNumber,
    });

    if (sender?.isActive) {
      effects.notifications.push({ userId: sender.id, type: "PENDING_APPROVAL", title: "Approved and returned to you", message: label(document), documentId: document.id });
      effects.emailEvents.push({ recipientId: sender.id, type: EmailEventType.APPROVAL_PENDING, documentId: document.id });
    }
    return {
      documentId: document.id, status: DocumentStatus.PENDING, currentWorkflowStep: origin.levelNumber, effects,
      auditAction: "DOCUMENT_APPROVAL_RETURNED",
      auditDetails: { sentForApproval: true, returnedToLevel: origin.levelNumber, returnedToUserId: step.sentById },
    };
  }

  // A unique track was ticked: the level is done and the document goes straight to the track's receiver.
  if (input.trackId) {
    if (step.isTrackStep) throw new WorkflowError("A unique track cannot be taken from inside another track.", 400);
    await requireUniqueTrackPermission(tx, actor, document);
    await addHistory(tx, {
      documentId: document.id, action, actorId: actor.id, onBehalfOfUserId, comments: input.comment,
      levelNumber: level, fromStatus: DocumentStatus.PENDING, toStatus: DocumentStatus.PENDING,
      versionId: input.versionId, outputVersionId: input.outputVersionId, revisionNumber: document.revisionNumber,
    });
    const trackLevel = await enterTrack(
      tx,
      await loadDocument(tx, document.id),
      { originLevel: level, trackId: input.trackId, actor, onBehalfOfUserId, now, versionId: input.outputVersionId ?? input.versionId },
      effects,
    );
    return { documentId: document.id, status: DocumentStatus.PENDING, currentWorkflowStep: trackLevel, effects };
  }

  // Where the document goes next: after a unique track, to the track's return level (none = fully approved);
  // otherwise to the next level of the flow (levels a track skipped, and track steps, are never "next").
  let nextStep: LoadedDocument["approvalSteps"][number] | undefined;
  if (step.isTrackStep) {
    if (step.returnLevel !== null) {
      nextStep = document.approvalSteps.find((candidate) => !candidate.isTrackStep && !candidate.isSideApproval && candidate.levelNumber === step.returnLevel);
      if (!nextStep) throw new WorkflowError("The stage this track returns to no longer exists.", 409);
    }
  } else {
    nextStep = document.approvalSteps.find((candidate) => !candidate.isTrackStep && !candidate.isSideApproval && candidate.status !== StepStatus.SKIPPED && candidate.levelNumber > level);
  }

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

  await markApproved(tx, document, effects);
  await addHistory(tx, {
    documentId: document.id, action, actorId: actor.id, onBehalfOfUserId, comments: input.comment,
    levelNumber: level, fromStatus: DocumentStatus.PENDING, toStatus: DocumentStatus.APPROVED,
    versionId: input.versionId, outputVersionId: input.outputVersionId, revisionNumber: document.revisionNumber,
  });
  notifyCreator(document, effects, "DOCUMENT_APPROVED", "Document approved");
  effects.emailEvents.push({ recipientId: document.createdById, type: EmailEventType.WORKFLOW_APPROVED, documentId: document.id });
  await notifyMailingList(tx, document, "APPROVED", effects, [actor.id, onBehalfOfUserId]);
  await notifyProcessFollowers(tx, document.id, "APPROVED", effects, [actor.id, onBehalfOfUserId]);
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
