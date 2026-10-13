import "server-only";

import {
  DocumentStatus,
  ProcessStatus,
  ProcessStepSource,
  type Prisma,
} from "@prisma/client";
import { WorkflowError } from "@/lib/workflow/errors";

/** Start a run of a process. The run begins at its first step. */
export async function startProcess(
  tx: Prisma.TransactionClient,
  input: { processDefinitionId: string; projectId: string | null; reference?: string | null; startedById: string },
) {
  const definition = await tx.processDefinition.findUnique({
    where: { id: input.processDefinitionId },
    select: { isActive: true, steps: { orderBy: { stepNumber: "asc" }, select: { stepNumber: true } } },
  });

  if (!definition || !definition.isActive) throw new WorkflowError("This process is not available.", 404);
  if (definition.steps.length === 0) throw new WorkflowError("This process has no steps.", 400);

  return tx.processInstance.create({
    data: {
      processDefinitionId: input.processDefinitionId,
      projectId: input.projectId,
      reference: input.reference ?? null,
      startedById: input.startedById,
      currentStepNumber: definition.steps[0].stepNumber,
    },
  });
}

/**
 * Put a document into the current step of a run. The document must match the step's type (and sub type
 * when the step names one). A step holds one current document; a rejected (cancelled) one stays as history
 * and is replaced by the new upload. If the document is already approved, the run moves on immediately.
 */
export async function linkDocumentToCurrentStep(
  tx: Prisma.TransactionClient,
  input: { processInstanceId: string; documentId: string; source: ProcessStepSource; linkedById: string },
) {
  const instance = await tx.processInstance.findUnique({
    where: { id: input.processInstanceId },
    select: {
      id: true,
      status: true,
      currentStepNumber: true,
      processDefinition: { select: { steps: { select: { id: true, stepNumber: true, documentTypeId: true, documentSubtypeId: true } } } },
    },
  });
  if (!instance) throw new WorkflowError("Process run not found.", 404);
  if (instance.status !== ProcessStatus.IN_PROGRESS) throw new WorkflowError("This process run is not in progress.", 409);

  const step = instance.processDefinition.steps.find((candidate) => candidate.stepNumber === instance.currentStepNumber);
  if (!step) throw new WorkflowError("Process step not found.", 404);

  const document = await tx.document.findUnique({
    where: { id: input.documentId },
    select: { id: true, status: true, documentTypeId: true, documentSubtypeId: true },
  });
  if (!document) throw new WorkflowError("Document not found.", 404);

  if (document.documentTypeId !== step.documentTypeId) {
    throw new WorkflowError("This document is not the type this step asks for.", 400);
  }
  if (step.documentSubtypeId && document.documentSubtypeId !== step.documentSubtypeId) {
    throw new WorkflowError("This document is not the sub type this step asks for.", 400);
  }
  if (document.status === DocumentStatus.CANCELLED || document.status === DocumentStatus.ARCHIVED) {
    throw new WorkflowError("A rejected or archived document cannot fill a step.", 400);
  }

  const current = await tx.processStepDocument.findFirst({
    where: { processInstanceId: instance.id, processStepId: step.id, isCurrent: true },
    select: { id: true, document: { select: { id: true, status: true } } },
  });

  if (current) {
    if (current.document.id === document.id) return current;
    if (current.document.status !== DocumentStatus.CANCELLED) {
      throw new WorkflowError("This step already has a document in progress.", 409);
    }
    await tx.processStepDocument.update({ where: { id: current.id }, data: { isCurrent: false } });
  }

  const link = await tx.processStepDocument.create({
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
    await advanceProcessesForApprovedDocument(tx, document.id);
  }

  return link;
}

/** Called when a document becomes approved: every run waiting on it moves to its next step (or completes). */
export async function advanceProcessesForApprovedDocument(tx: Prisma.TransactionClient, documentId: string) {
  const links = await tx.processStepDocument.findMany({
    where: { documentId, isCurrent: true, processInstance: { status: ProcessStatus.IN_PROGRESS } },
    select: {
      processInstanceId: true,
      processStep: { select: { stepNumber: true, processDefinitionId: true } },
      processInstance: { select: { currentStepNumber: true } },
    },
  });

  for (const link of links) {
    if (link.processStep.stepNumber !== link.processInstance.currentStepNumber) continue;

    const nextStep = await tx.processStep.findFirst({
      where: { processDefinitionId: link.processStep.processDefinitionId, stepNumber: { gt: link.processStep.stepNumber } },
      orderBy: { stepNumber: "asc" },
      select: { stepNumber: true },
    });

    await tx.processInstance.update({
      where: { id: link.processInstanceId },
      data: nextStep
        ? { currentStepNumber: nextStep.stepNumber }
        : { status: ProcessStatus.COMPLETED, completedAt: new Date() },
    });
  }
}

export async function cancelProcess(tx: Prisma.TransactionClient, processInstanceId: string) {
  const result = await tx.processInstance.updateMany({
    where: { id: processInstanceId, status: ProcessStatus.IN_PROGRESS },
    data: { status: ProcessStatus.CANCELLED, completedAt: new Date() },
  });
  if (result.count === 0) throw new WorkflowError("This process run is not in progress.", 409);
}
