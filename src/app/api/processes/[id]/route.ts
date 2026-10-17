// src/app/api/processes/[id]/route.ts
import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { buildProcessVisibilityWhere, userHasPermission } from "@/lib/auth/access";
import { validateCsrf } from "@/lib/csrf";
import { prisma } from "@/lib/prisma";
import { getDocumentStatusDisplay } from "@/lib/document-status";
import { cancelProcess } from "@/lib/workflow/processes";
import { WorkflowError } from "@/lib/workflow/errors";
import { getProcessStatusLabel } from "@/lib/process-status";

export const runtime = "nodejs";

// One run: its steps in order, the document now filling each step, and the earlier (rejected) ones as history.
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const visibility = await buildProcessVisibilityWhere(session);
  const run = await prisma.processInstance.findFirst({
    where: { AND: [{ id }, visibility] },
    select: {
      id: true,
      reference: true,
      status: true,
      currentStepNumber: true,
      startedAt: true,
      completedAt: true,
      project: { select: { id: true, code: true, name: true } },
      startedBy: { select: { id: true, name: true } },
      processDefinition: {
        select: {
          id: true,
          name: true,
          steps: {
            orderBy: { stepNumber: "asc" },
            select: { id: true, stepNumber: true, name: true, documentType: { select: { id: true, code: true, name: true } }, documentSubtype: { select: { id: true, code: true, name: true } } },
          },
        },
      },
      stepDocuments: {
        orderBy: { linkedAt: "asc" },
        select: {
          id: true,
          processStepId: true,
          isCurrent: true,
          source: true,
          linkedAt: true,
          document: { select: { id: true, documentNumber: true, title: true, status: true, currentWorkflowStep: true } },
        },
      },
    },
  });

  if (!run) return NextResponse.json({ message: "Process run not found." }, { status: 404 });

  return NextResponse.json({
    run: {
      id: run.id,
      reference: run.reference,
      status: run.status,
      statusLabel: getProcessStatusLabel(run.status, run.currentStepNumber, run.processDefinition.steps),
      currentStepNumber: run.currentStepNumber,
      startedAt: run.startedAt.toISOString(),
      completedAt: run.completedAt?.toISOString() ?? null,
      project: run.project,
      startedBy: run.startedBy,
      processDefinition: { id: run.processDefinition.id, name: run.processDefinition.name },
      steps: run.processDefinition.steps.map((step) => {
        const documents = run.stepDocuments
          .filter((link) => link.processStepId === step.id)
          .map((link) => ({
            linkId: link.id,
            isCurrent: link.isCurrent,
            source: link.source,
            linkedAt: link.linkedAt.toISOString(),
            id: link.document.id,
            documentNumber: link.document.documentNumber,
            title: link.document.title,
            status: link.document.status,
            statusLabel: getDocumentStatusDisplay(link.document.status, { levelNumber: link.document.currentWorkflowStep }),
          }));
        return {
          id: step.id,
          stepNumber: step.stepNumber,
          name: step.name,
          documentType: step.documentType,
          documentSubtype: step.documentSubtype,
          currentDocument: documents.find((doc) => doc.isCurrent) ?? null,
          history: documents.filter((doc) => !doc.isCurrent),
        };
      }),
    },
  });
}

// Cancel a run: only the person who started it, or someone who may manage processes.
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  if (!validateCsrf(request)) return NextResponse.json({ message: "Invalid CSRF token." }, { status: 403 });

  const { id } = await params;
  const body = (await request.json().catch(() => null)) as { action?: unknown } | null;
  if (body?.action !== "cancel") return NextResponse.json({ message: "Action must be cancel." }, { status: 400 });

  const run = await prisma.processInstance.findUnique({ where: { id }, select: { startedById: true } });
  if (!run) return NextResponse.json({ message: "Process run not found." }, { status: 404 });

  if (run.startedById !== session.userId && !(await userHasPermission(session, "processes.manage"))) {
    return NextResponse.json({ message: "You are not allowed to cancel this process run." }, { status: 403 });
  }

  try {
    await prisma.$transaction((tx) => cancelProcess(tx, id));
    return NextResponse.json({ message: "Process run cancelled." });
  } catch (error) {
    if (error instanceof WorkflowError) return NextResponse.json({ message: error.message }, { status: error.status });
    return NextResponse.json({ message: "Unable to cancel the process run." }, { status: 500 });
  }
}
