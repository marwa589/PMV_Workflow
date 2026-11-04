// src/app/api/processes/route.ts
import { DocumentStatus, ProcessStatus, ProcessStepSource } from "@prisma/client";
import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { buildProcessVisibilityWhere } from "@/lib/auth/access";
import { prisma } from "@/lib/prisma";
import { getProcessStatusLabel } from "@/lib/process-status";
import { USER_TYPE } from "@/lib/auth/roles";
import { validateCsrf } from "@/lib/csrf";
import { dispatchWorkflowEffects } from "@/lib/workflow/effects";
import { WorkflowError } from "@/lib/workflow/errors";
import type { WorkflowEffects } from "@/lib/workflow/engine";
import { getStartableProcesses, linkDocumentToStep, nodeMatches, startProcessRun } from "@/lib/workflow/processes";

export const runtime = "nodejs";

const runSelect = {
  id: true,
  reference: true,
  status: true,
  currentStepId: true,
  startedAt: true,
  completedAt: true,
  processDefinition: {
    select: {
      id: true,
      name: true,
      steps: {
        orderBy: { stepNumber: "asc" },
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
  project: { select: { id: true, code: true, name: true } },
  startedBy: { select: { id: true, name: true } },
  parentInstance: { select: { id: true, reference: true } },
  followedDocument: { select: { id: true, documentNumber: true } },
  _count: { select: { followUps: true } },
} as const;

// Process runs the person may see. A run starts when the root document of a process is uploaded (an Admin user can
// also start one on purpose from the Process Runs page, see `startable`).
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });

  const visibility = await buildProcessVisibilityWhere(session);
  const runs = await prisma.processInstance.findMany({ where: visibility, select: runSelect, orderBy: { startedAt: "desc" }, take: 200 });

  const startable = session.userType === USER_TYPE.ADMIN ? await getStartableProcesses(prisma) : [];

  return NextResponse.json({
    startable,
    runs: runs.map((run) => ({
      id: run.id,
      reference: run.reference,
      status: run.status,
      statusLabel: getProcessStatusLabel(run, run.processDefinition.steps, run.stepDocuments),
      processDefinition: { id: run.processDefinition.id, name: run.processDefinition.name },
      project: run.project,
      startedBy: run.startedBy,
      startedAt: run.startedAt.toISOString(),
      completedAt: run.completedAt?.toISOString() ?? null,
      follows: run.parentInstance ? { runId: run.parentInstance.id, reference: run.parentInstance.reference, documentNumber: run.followedDocument?.documentNumber ?? null } : null,
      followUpCount: run._count.followUps,
    })),
  });
}

// Admin only: start a run on purpose with a document that is ALREADY in the system and approved.
// (A new file for the first document goes through POST /api/documents with startProcessDefinitionId.)
export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  if (session.userType !== USER_TYPE.ADMIN) return NextResponse.json({ message: "Only an Admin user can start a process by hand." }, { status: 403 });
  if (!validateCsrf(request)) return NextResponse.json({ message: "Invalid CSRF token." }, { status: 403 });

  const body = (await request.json().catch(() => null)) as { processDefinitionId?: unknown; documentId?: unknown; notify?: unknown } | null;
  const processDefinitionId = typeof body?.processDefinitionId === "string" ? body.processDefinitionId.trim() : "";
  const documentId = typeof body?.documentId === "string" ? body.documentId.trim() : "";
  if (!processDefinitionId || !documentId) return NextResponse.json({ message: "Choose a process and a document." }, { status: 400 });

  try {
    const process = (await getStartableProcesses(prisma)).find((candidate) => candidate.id === processDefinitionId);
    if (!process) throw new WorkflowError("This process cannot be started.", 404);

    const document = await prisma.document.findUnique({
      where: { id: documentId },
      select: { id: true, documentNumber: true, status: true, isReference: true, projectId: true, documentTypeId: true, documentSubtypeId: true },
    });
    if (!document || document.isReference) throw new WorkflowError("Document not found.", 404);
    if (document.status !== DocumentStatus.APPROVED) throw new WorkflowError("Only an approved document can start a process this way.", 400);
    if (!nodeMatches({ documentTypeId: process.documentTypeId, documentSubtypeId: process.documentSubtypeId }, document)) {
      throw new WorkflowError("This document is not the type that starts this process.", 400);
    }
    const used = await prisma.processStepDocument.count({
      where: { documentId, isCurrent: true, processInstance: { status: { not: ProcessStatus.CANCELLED } } },
    });
    if (used > 0) throw new WorkflowError("This document is already used in a process run.", 409);

    const effects: WorkflowEffects = { notifications: [], emailEvents: [] };
    const run = await prisma.$transaction(async (tx) => {
      // The run is named after the document and belongs to the document's project.
      const created = await startProcessRun(tx, {
        rootStepId: process.rootStepId,
        processDefinitionId: process.id,
        projectId: document.projectId,
        reference: document.documentNumber,
        startedById: session.userId,
      });
      await linkDocumentToStep(tx, {
        processInstanceId: created.id,
        stepId: process.rootStepId,
        documentId: document.id,
        source: ProcessStepSource.EXISTING,
        linkedById: session.userId,
      }, effects);
      return created;
    });
    if (body?.notify === true) await dispatchWorkflowEffects(effects);

    return NextResponse.json({ message: "Process started.", processRunId: run.id }, { status: 201 });
  } catch (error) {
    if (error instanceof WorkflowError) return NextResponse.json({ message: error.message }, { status: error.status });
    return NextResponse.json({ message: "Unable to start the process." }, { status: 500 });
  }
}
