import "server-only";

import {
  DocumentStatus,
  EmailEventType,
  ProcessStatus,
  ProcessStepSource,
  type Prisma,
} from "@prisma/client";
import type { Db } from "@/lib/auth/access";
import { USER_TYPE, type UserTypeCode } from "@/lib/auth/roles";
import { canUserUpload } from "@/lib/workflow/eligibility";
import { WorkflowError } from "@/lib/workflow/errors";
import type { WorkflowEffects } from "@/lib/workflow/engine";

/**
 * A process is a tree of document nodes (ProcessStep rows linked by parentStepId):
 *  - the root node is the document whose upload STARTS a run, automatically;
 *  - the children of a node are optional "next document" choices; the person who uploads the next document
 *    picks one, and the run follows that child's path until a node with no children is approved;
 *  - a run remembers the last approved node in ProcessInstance.currentStepId; its children are the open choices.
 * Nothing here is started or linked by hand: documents only enter a run by being uploaded.
 */

type Scope = { documentTypeId: string; documentSubtypeId: string | null };

/** A node asks for a document of its type, and of its sub type when it names one (no sub type = any). */
export function nodeMatches(node: Scope, doc: Scope): boolean {
  return node.documentTypeId === doc.documentTypeId && (!node.documentSubtypeId || node.documentSubtypeId === doc.documentSubtypeId);
}

/** Two nodes could ask for the same document (used to keep roots unique and sibling choices distinct). */
export function nodesOverlap(a: Scope, b: Scope): boolean {
  return a.documentTypeId === b.documentTypeId && (!a.documentSubtypeId || !b.documentSubtypeId || a.documentSubtypeId === b.documentSubtypeId);
}

type RuleNode = Scope & { id: string; parentStepId: string | null; processDefinitionId: string };

/**
 * The nodes that decide what an upload means:
 *  - the CURRENT version of every active process that is a proper tree (exactly one root): roots start runs;
 *  - later nodes of any version that a run in progress still follows (even if the process was edited or
 *    deactivated since), so those runs are not opened to standalone uploads.
 * Legacy linear processes (several roots) are ignored.
 */
async function loadActiveNodes(db: Db): Promise<RuleNode[]> {
  const select = { id: true, parentStepId: true, versionNumber: true, documentTypeId: true, documentSubtypeId: true } as const;
  const [active, running] = await Promise.all([
    db.processDefinition.findMany({
      where: { isActive: true },
      select: { id: true, currentVersion: true, steps: { select } },
    }),
    db.processInstance.findMany({
      where: { status: ProcessStatus.IN_PROGRESS },
      distinct: ["processDefinitionId", "stepVersion"],
      select: { processDefinitionId: true, stepVersion: true, processDefinition: { select: { steps: { select } } } },
    }),
  ]);

  const nodes = new Map<string, RuleNode>();
  for (const definition of active) {
    const current = definition.steps.filter((step) => step.versionNumber === definition.currentVersion);
    if (current.filter((step) => step.parentStepId === null).length !== 1) continue;
    for (const step of current) nodes.set(step.id, { ...step, processDefinitionId: definition.id });
  }
  for (const run of running) {
    for (const step of run.processDefinition.steps) {
      if (step.versionNumber === run.stepVersion && step.parentStepId !== null) {
        nodes.set(step.id, { ...step, processDefinitionId: run.processDefinitionId });
      }
    }
  }
  return [...nodes.values()];
}

export type UploadKind =
  | { kind: "root"; processDefinitionId: string; rootStepId: string }
  | { kind: "task-only" }
  | { kind: "standalone" };

function classify(nodes: RuleNode[], doc: Scope): UploadKind {
  const roots = nodes.filter((node) => node.parentStepId === null && nodeMatches(node, doc));
  if (roots.length > 0) {
    // Roots of active processes never overlap (checked when a process is saved); prefer the sub type match if they do.
    const best = roots.find((node) => node.documentSubtypeId) ?? roots[0];
    return { kind: "root", processDefinitionId: best.processDefinitionId, rootStepId: best.id };
  }
  if (nodes.some((node) => node.parentStepId !== null && nodeMatches(node, doc))) return { kind: "task-only" };
  return { kind: "standalone" };
}

/**
 * What does uploading this kind of document mean?
 *  - root: it is the first document of a process tree, so a run starts automatically;
 *  - task-only: it is a later node of a tree and can only be uploaded from My Tasks, inside a running process;
 *  - standalone: it is in no tree at all and is uploaded on its own, as before.
 */
export async function classifyUpload(db: Db, doc: Scope): Promise<UploadKind> {
  return classify(await loadActiveNodes(db), doc);
}

/** For the New Document form: hides the types / sub types that may only be uploaded as a later step of a running process. */
export async function getTaskOnlyChecker(db: Db): Promise<(doc: Scope) => boolean> {
  const nodes = await loadActiveNodes(db);
  return (doc) => classify(nodes, doc).kind === "task-only";
}

/** Start a run for a root document. The document itself is linked afterwards with linkDocumentToStep. */
export async function startProcessRun(
  tx: Prisma.TransactionClient,
  input: { rootStepId: string; processDefinitionId: string; projectId: string | null; reference: string | null; startedById: string },
) {
  const root = await tx.processStep.findFirst({
    where: { id: input.rootStepId, processDefinitionId: input.processDefinitionId, parentStepId: null },
    select: { stepNumber: true, versionNumber: true },
  });
  if (!root) throw new WorkflowError("This process has no starting document.", 409);

  return tx.processInstance.create({
    data: {
      processDefinitionId: input.processDefinitionId,
      projectId: input.projectId,
      reference: input.reference,
      startedById: input.startedById,
      currentStepNumber: root.stepNumber,
      stepVersion: root.versionNumber,
      currentStepId: null,
    },
  });
}

/** Serialises changes to one run (two people choosing different branches at once, or an approval racing an upload). */
async function lockRun(tx: Prisma.TransactionClient, processInstanceId: string) {
  await tx.$queryRaw`SELECT 1 FROM "ProcessInstance" WHERE "id" = ${processInstanceId} FOR UPDATE`;
}

/**
 * Put an uploaded document into a node of a run.
 *  - first document of a run: the node must be the root;
 *  - later: the node must be a child of the last approved node, and no other child may already hold a document
 *    in progress (the choice is made once; a rejected one is history and the choice opens up again).
 * If the document is already approved (no approval flow), the run moves on at once.
 */
export async function linkDocumentToStep(
  tx: Prisma.TransactionClient,
  input: { processInstanceId: string; stepId: string; documentId: string; source: ProcessStepSource; linkedById: string },
  effects?: WorkflowEffects,
) {
  await lockRun(tx, input.processInstanceId);
  const instance = await tx.processInstance.findUnique({
    where: { id: input.processInstanceId },
    select: { id: true, status: true, processDefinitionId: true, projectId: true, currentStepId: true, stepVersion: true },
  });
  if (!instance) throw new WorkflowError("Process run not found.", 404);
  if (instance.status !== ProcessStatus.IN_PROGRESS) throw new WorkflowError("This process run is not in progress.", 409);

  const step = await tx.processStep.findFirst({
    where: { id: input.stepId, processDefinitionId: instance.processDefinitionId },
    select: { id: true, parentStepId: true, versionNumber: true, documentTypeId: true, documentSubtypeId: true },
  });
  if (!step || step.versionNumber !== instance.stepVersion) throw new WorkflowError("Process step not found.", 404);

  const document = await tx.document.findUnique({
    where: { id: input.documentId },
    select: { id: true, status: true, documentTypeId: true, documentSubtypeId: true, projectId: true },
  });
  if (!document) throw new WorkflowError("Document not found.", 404);

  if (!nodeMatches(step, document)) throw new WorkflowError("This document is not the type this step asks for.", 400);
  if (document.projectId !== instance.projectId) throw new WorkflowError("This document belongs to a different project than the process run.", 400);
  if (document.status === DocumentStatus.CANCELLED || document.status === DocumentStatus.ARCHIVED) {
    throw new WorkflowError("A rejected or archived document cannot fill a step.", 400);
  }

  // The node must be the root of a fresh run, or one of the choices under the last approved node.
  if (step.parentStepId !== instance.currentStepId) {
    throw new WorkflowError("This document is not one of the options for the next step of this process.", 400);
  }

  const inProgress = await tx.processStepDocument.findFirst({
    where: {
      processInstanceId: instance.id,
      isCurrent: true,
      processStep: { parentStepId: step.parentStepId },
    },
    select: { documentId: true },
  });
  if (inProgress) {
    if (inProgress.documentId === document.id) return;
    throw new WorkflowError("This step already has a document in progress.", 409);
  }

  await tx.processStepDocument.create({
    data: {
      processInstanceId: instance.id,
      processStepId: step.id,
      documentId: document.id,
      source: input.source,
      linkedById: input.linkedById,
      isCurrent: true,
    },
  });

  if (document.status === DocumentStatus.APPROVED) {
    await advanceProcessesForApprovedDocument(tx, document.id, effects);
  }
}

/**
 * Called when a document becomes approved: the run that holds it moves on. The node becomes the run's last
 * approved node; if it has no children the path is finished and the run completes.
 */
export async function advanceProcessesForApprovedDocument(tx: Prisma.TransactionClient, documentId: string, effects?: WorkflowEffects) {
  const links = await tx.processStepDocument.findMany({
    where: { documentId, isCurrent: true, processInstance: { status: ProcessStatus.IN_PROGRESS } },
    select: {
      processInstanceId: true,
      processStep: { select: { id: true, parentStepId: true, stepNumber: true, _count: { select: { childSteps: true } } } },
      processInstance: { select: { currentStepId: true } },
    },
  });

  for (const link of links) {
    await lockRun(tx, link.processInstanceId);
    // Only the document filling the next open node moves the run (guards against a stale or duplicate call).
    const fresh = await tx.processInstance.findUnique({ where: { id: link.processInstanceId }, select: { currentStepId: true, status: true } });
    if (!fresh || fresh.status !== ProcessStatus.IN_PROGRESS || link.processStep.parentStepId !== fresh.currentStepId) continue;

    const isEnd = link.processStep._count.childSteps === 0;
    await tx.processInstance.update({
      where: { id: link.processInstanceId },
      data: {
        currentStepId: link.processStep.id,
        currentStepNumber: link.processStep.stepNumber,
        ...(isEnd ? { status: ProcessStatus.COMPLETED, completedAt: new Date() } : {}),
      },
    });
    if (!isEnd && effects) await collectUploadReadyEffects(tx, link.processInstanceId, effects);
  }
}

/**
 * Called when a document is rejected.
 *  - Rejected root: nothing was ever approved, so the run is cancelled (uploading a root again starts a new run).
 *  - Rejected later node: it becomes history and the choice opens up again, so the uploader may upload it
 *    again or switch to a sibling.
 */
export async function handleProcessDocumentRejected(tx: Prisma.TransactionClient, documentId: string, effects?: WorkflowEffects) {
  const links = await tx.processStepDocument.findMany({
    where: { documentId, isCurrent: true, processInstance: { status: ProcessStatus.IN_PROGRESS } },
    select: { id: true, processInstanceId: true, processStep: { select: { parentStepId: true } } },
  });

  for (const link of links) {
    if (link.processStep.parentStepId === null) {
      await tx.processInstance.updateMany({
        where: { id: link.processInstanceId, status: ProcessStatus.IN_PROGRESS },
        data: { status: ProcessStatus.CANCELLED, completedAt: new Date() },
      });
    } else {
      await tx.processStepDocument.update({ where: { id: link.id }, data: { isCurrent: false } });
      // The choice is open again: tell the people who may upload.
      if (effects) await collectUploadReadyEffects(tx, link.processInstanceId, effects);
    }
  }
}

/**
 * The run is waiting for its next document: tell everyone who may upload at least one of the choices
 * (in-app notification now, email through the normal batching). Admin users are never notified, like approvals.
 * Same rule as My Tasks: canUserUpload for the choice's type, sub type and the run's project.
 */
async function collectUploadReadyEffects(tx: Prisma.TransactionClient, processInstanceId: string, effects: WorkflowEffects) {
  const run = await tx.processInstance.findUnique({
    where: { id: processInstanceId },
    select: {
      status: true,
      reference: true,
      projectId: true,
      currentStepId: true,
      processDefinition: { select: { name: true } },
      currentStep: { select: { name: true, childSteps: { select: { documentTypeId: true, documentSubtypeId: true } } } },
      stepDocuments: { where: { isCurrent: true }, select: { documentId: true, processStep: { select: { id: true, parentStepId: true } } } },
    },
  });
  if (!run || run.status !== ProcessStatus.IN_PROGRESS || !run.currentStep || run.currentStep.childSteps.length === 0) return;
  // A choice already holds a document in progress: nothing to upload yet.
  if (run.stepDocuments.some((link) => link.processStep.parentStepId === run.currentStepId)) return;
  const anchorDocumentId = run.stepDocuments.find((link) => link.processStep.id === run.currentStepId)?.documentId;
  if (!anchorDocumentId) return;

  // Only people who could possibly upload are checked: users with an assignment, or named by an uploader step.
  const uploaderTypes = await tx.documentWorkflowStepApprover.findMany({
    where: { step: { stepNumber: 0 }, userTypeId: { not: null } },
    select: { userTypeId: true },
  });
  const uploaderTypeIds = [...new Set(uploaderTypes.flatMap((row) => (row.userTypeId ? [row.userTypeId] : [])))];
  const candidates = await tx.user.findMany({
    where: {
      isActive: true,
      userType: { code: { not: USER_TYPE.ADMIN } },
      OR: [
        { assignments: { some: {} } },
        { workflowStepApprovals: { some: { step: { stepNumber: 0 } } } },
        ...(uploaderTypeIds.length > 0 ? [{ userTypeId: { in: uploaderTypeIds } }] : []),
      ],
    },
    select: { id: true, userType: { select: { code: true } } },
  });

  const label = `${run.processDefinition.name}${run.reference ? ` - ${run.reference}` : ""}`;
  for (const candidate of candidates) {
    const actor = { id: candidate.id, userType: candidate.userType.code as UserTypeCode };
    let allowed = false;
    for (const child of run.currentStep.childSteps) {
      if (await canUserUpload(tx, actor, { documentTypeId: child.documentTypeId, documentSubtypeId: child.documentSubtypeId, projectId: run.projectId })) {
        allowed = true;
        break;
      }
    }
    if (!allowed) continue;
    effects.notifications.push({
      userId: candidate.id,
      type: "PROCESS_UPLOAD_READY",
      title: "Next document ready to upload",
      message: `${label} - after ${run.currentStep.name}`,
      documentId: anchorDocumentId,
    });
    effects.emailEvents.push({ recipientId: candidate.id, type: EmailEventType.PROCESS_UPLOAD_READY, documentId: anchorDocumentId });
  }
}

/** A document is being deleted for good: if it was the root of a run, the run has nothing left to stand on. */
export async function cancelRunsRootedAtDocuments(tx: Prisma.TransactionClient, documentIds: string[]) {
  const rootLinks = await tx.processStepDocument.findMany({
    where: { documentId: { in: documentIds }, processStep: { parentStepId: null } },
    select: { processInstanceId: true },
  });
  if (rootLinks.length === 0) return;
  await tx.processInstance.updateMany({
    where: { id: { in: rootLinks.map((link) => link.processInstanceId) }, status: ProcessStatus.IN_PROGRESS },
    data: { status: ProcessStatus.CANCELLED, completedAt: new Date() },
  });
}

export async function cancelProcess(tx: Prisma.TransactionClient, processInstanceId: string) {
  const result = await tx.processInstance.updateMany({
    where: { id: processInstanceId, status: ProcessStatus.IN_PROGRESS },
    data: { status: ProcessStatus.CANCELLED, completedAt: new Date() },
  });
  if (result.count === 0) throw new WorkflowError("This process run is not in progress.", 409);
}

// ---------------------------------------------------------------------------------------------------------
// My Tasks: "Document upload"
// ---------------------------------------------------------------------------------------------------------

export type UploadTaskOption = {
  stepId: string;
  name: string;
  documentTypeId: string;
  documentSubtypeId: string | null;
  typeName: string;
  subtypeName: string | null;
};

export type UploadTask = {
  runId: string;
  processName: string;
  reference: string | null;
  project: { id: string; code: string; name: string } | null;
  afterStepName: string;
  lastDocument: { id: string; documentNumber: string; title: string; approvedAt: Date | null } | null;
  options: UploadTaskOption[];
};

/**
 * Runs that are waiting for their next document: the last approved node has children and none of them holds a
 * document in progress. A person gets the task when they may upload at least one of the choices (same rule as
 * any upload: canUserUpload); they are shown only the choices they may upload.
 */
export async function getUploadTasks(db: Db, user: { userId: string; userType: UserTypeCode }): Promise<UploadTask[]> {
  const runs = await db.processInstance.findMany({
    where: { status: ProcessStatus.IN_PROGRESS, currentStepId: { not: null }, currentStep: { childSteps: { some: {} } } },
    orderBy: { startedAt: "desc" },
    select: {
      id: true,
      reference: true,
      projectId: true,
      currentStepId: true,
      project: { select: { id: true, code: true, name: true } },
      processDefinition: { select: { name: true } },
      currentStep: {
        select: {
          name: true,
          childSteps: {
            orderBy: { stepNumber: "asc" },
            select: {
              id: true,
              name: true,
              documentTypeId: true,
              documentSubtypeId: true,
              documentType: { select: { name: true } },
              documentSubtype: { select: { name: true } },
            },
          },
        },
      },
      stepDocuments: {
        where: { isCurrent: true },
        select: {
          processStep: { select: { id: true, parentStepId: true } },
          document: { select: { id: true, documentNumber: true, title: true, approvedAt: true } },
        },
      },
    },
  });

  const actor = { id: user.userId, userType: user.userType };
  const tasks: UploadTask[] = [];
  // Only runs that are waiting for an upload are loaded (no cut-off), and each type / sub type / project is checked once.
  const allowedCache = new Map<string, boolean>();
  const mayUpload = async (scope: { documentTypeId: string; documentSubtypeId: string | null; projectId: string | null }) => {
    const key = `${scope.documentTypeId}|${scope.documentSubtypeId ?? ""}|${scope.projectId ?? ""}`;
    const cached = allowedCache.get(key);
    if (cached !== undefined) return cached;
    const result = await canUserUpload(db, actor, scope);
    allowedCache.set(key, result);
    return result;
  };

  for (const run of runs) {
    if (!run.currentStep) continue;
    // A choice was already made and its document is in progress: nothing to upload until it is approved or rejected.
    if (run.stepDocuments.some((link) => link.processStep.parentStepId === run.currentStepId)) continue;

    const options: UploadTaskOption[] = [];
    for (const child of run.currentStep.childSteps) {
      const allowed =
        user.userType === USER_TYPE.ADMIN ||
        (await mayUpload({
          documentTypeId: child.documentTypeId,
          documentSubtypeId: child.documentSubtypeId,
          projectId: run.projectId,
        }));
      if (allowed) {
        options.push({
          stepId: child.id,
          name: child.name,
          documentTypeId: child.documentTypeId,
          documentSubtypeId: child.documentSubtypeId,
          typeName: child.documentType.name,
          subtypeName: child.documentSubtype?.name ?? null,
        });
      }
    }
    if (options.length === 0) continue;

    const last = run.stepDocuments.find((link) => link.processStep.id === run.currentStepId)?.document ?? null;
    tasks.push({
      runId: run.id,
      processName: run.processDefinition.name,
      reference: run.reference,
      project: run.project,
      afterStepName: run.currentStep.name,
      lastDocument: last,
      options,
    });
  }

  return tasks;
}
