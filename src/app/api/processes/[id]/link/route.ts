// src/app/api/processes/[id]/link/route.ts
import { ProcessStatus, ProcessStepSource } from "@prisma/client";
import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { canAccessDocument } from "@/lib/auth/access";
import { canUserUpload } from "@/lib/workflow/eligibility";
import { USER_TYPE } from "@/lib/auth/roles";
import { validateCsrf } from "@/lib/csrf";
import { prisma } from "@/lib/prisma";
import { linkDocumentToStep, nodeMatches, reconcileProcessRun } from "@/lib/workflow/processes";
import { WorkflowError } from "@/lib/workflow/errors";
import { dispatchWorkflowEffects } from "@/lib/workflow/effects";
import type { WorkflowEffects } from "@/lib/workflow/engine";

export const runtime = "nodejs";

// Put a document that is already in the system into the run's current step.
// (A new upload for the step goes through POST /api/documents with processInstanceId.)
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  if (!validateCsrf(request)) return NextResponse.json({ message: "Invalid CSRF token." }, { status: 403 });

  const { id } = await params;
  const body = (await request.json().catch(() => null)) as { documentId?: unknown; stepId?: unknown; notify?: unknown } | null;
  const documentId = typeof body?.documentId === "string" ? body.documentId.trim() : "";
  const requestedStepId = typeof body?.stepId === "string" ? body.stepId.trim() : "";
  if (!documentId) return NextResponse.json({ message: "Choose a document." }, { status: 400 });

  const run = await prisma.processInstance.findUnique({
    where: { id },
    select: { startedById: true, currentStepId: true, stepVersion: true, processDefinitionId: true, projectId: true },
  });
  if (!run) return NextResponse.json({ message: "Process run not found." }, { status: 404 });

  if (!(await canAccessDocument(session, documentId))) {
    return NextResponse.json({ message: "You cannot use this document." }, { status: 403 });
  }

  const document = await prisma.document.findUnique({
    where: { id: documentId },
    select: { documentTypeId: true, documentSubtypeId: true },
  });
  if (!document) return NextResponse.json({ message: "Document not found." }, { status: 404 });

  // Who may put an existing document into the run: Admin users, the person who started the run, and anyone who may
  // upload this kind of document in the run's project (the same people who could upload it as the next document).
  const mayLink =
    session.userType === USER_TYPE.ADMIN ||
    run.startedById === session.userId ||
    (await canUserUpload(prisma, { id: session.userId, userType: session.userType }, {
      documentTypeId: document.documentTypeId,
      documentSubtypeId: document.documentSubtypeId,
      projectId: run.projectId,
    }));
  if (!mayLink) return NextResponse.json({ message: "You may not add this kind of document to this process run." }, { status: 403 });

  try {
    // linkDocumentToStep needs the step. Use the one the caller named, otherwise the only option that fits the document.
    let stepId = requestedStepId;
    if (!stepId) {
      const options = await prisma.processStep.findMany({
        where: { processDefinitionId: run.processDefinitionId, versionNumber: run.stepVersion, parentStepId: run.currentStepId },
        select: { id: true, documentTypeId: true, documentSubtypeId: true },
      });
      const matching = options.filter((step) => nodeMatches(step, document));
      if (matching.length === 0) return NextResponse.json({ message: "This document is not one of the options for the next step of this process." }, { status: 400 });
      if (matching.length > 1) return NextResponse.json({ message: "More than one step fits this document. Choose the step." }, { status: 400 });
      stepId = matching[0].id;
    }

    // A document fills one step of one run: it cannot already be in another run that is still alive.
    const usedElsewhere = await prisma.processStepDocument.count({
      where: { documentId, isCurrent: true, processInstanceId: { not: id }, processInstance: { status: { not: ProcessStatus.CANCELLED } } },
    });
    if (usedElsewhere > 0) return NextResponse.json({ message: "This document is already used in another process run." }, { status: 409 });

    // Quiet by default: people who may upload the next document are told only when the caller asks for it.
    const effects: WorkflowEffects = { notifications: [], emailEvents: [] };
    await prisma.$transaction(async (tx) => {
      await linkDocumentToStep(
        tx,
        { processInstanceId: id, stepId, documentId, source: ProcessStepSource.EXISTING, linkedById: session.userId, overrideDelay: session.userType === USER_TYPE.ADMIN },
        effects,
      );
      await reconcileProcessRun(tx, id, effects);
    });
    if (body?.notify === true) await dispatchWorkflowEffects(effects);
    return NextResponse.json({ message: "Document added to the process step." }, { status: 201 });
  } catch (error) {
    if (error instanceof WorkflowError) return NextResponse.json({ message: error.message }, { status: error.status });
    return NextResponse.json({ message: "Unable to add the document." }, { status: 500 });
  }
}
