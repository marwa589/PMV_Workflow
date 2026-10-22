// src/app/api/processes/[id]/route.ts
import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { buildProcessVisibilityWhere, userHasPermission } from "@/lib/auth/access";
import { validateCsrf } from "@/lib/csrf";
import { prisma } from "@/lib/prisma";
import { getDocumentStatusDisplay } from "@/lib/document-status";
import { cancelProcess } from "@/lib/workflow/processes";
import { canUserUpload } from "@/lib/workflow/eligibility";
import { WorkflowError } from "@/lib/workflow/errors";
import { getProcessStatusLabel } from "@/lib/process-status";

export const runtime = "nodejs";

// One run: the whole tree, the documents that filled it (rejected ones as history) and the choices that are open now.
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
      currentStepId: true,
      stepVersion: true,
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
            select: {
              id: true,
              stepNumber: true,
              name: true,
              parentStepId: true,
              versionNumber: true,
              documentType: { select: { id: true, code: true, name: true } },
              documentSubtype: { select: { id: true, code: true, name: true } },
            },
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

  // The run follows the version of the tree it started with, even if the process was edited since.
  const definitionSteps = run.processDefinition.steps.filter((step) => step.versionNumber === run.stepVersion);
  const currentLinks = run.stepDocuments.filter((link) => link.isCurrent);
  // The node of the choice already made under the last approved node (its document is in approval), if any.
  const chosenLink = currentLinks.find((link) => definitionSteps.find((step) => step.id === link.processStepId)?.parentStepId === run.currentStepId);
  // Nodes on the path taken so far: the chosen node and everything above it.
  const pathIds = new Set<string>();
  for (let cursor = chosenLink?.processStepId ?? run.currentStepId; cursor; ) {
    pathIds.add(cursor);
    cursor = definitionSteps.find((step) => step.id === cursor)?.parentStepId ?? null;
  }

  const awaitingUpload =
    run.status === "IN_PROGRESS" &&
    run.currentStepId !== null &&
    !chosenLink &&
    definitionSteps.some((step) => step.parentStepId === run.currentStepId);

  // Buttons are shown only to people who could use them (same rules as the upload and cancel endpoints).
  let canUpload = false;
  if (awaitingUpload) {
    const actor = { id: session.userId, userType: session.userType };
    for (const step of definitionSteps.filter((candidate) => candidate.parentStepId === run.currentStepId)) {
      if (await canUserUpload(prisma, actor, { documentTypeId: step.documentType.id, documentSubtypeId: step.documentSubtype?.id ?? null, projectId: run.project?.id ?? null })) {
        canUpload = true;
        break;
      }
    }
  }
  const canCancel = run.status === "IN_PROGRESS" && (run.startedBy.id === session.userId || (await userHasPermission(session, "processes.manage")));

  return NextResponse.json({
    run: {
      id: run.id,
      reference: run.reference,
      status: run.status,
      statusLabel: getProcessStatusLabel(run, definitionSteps, run.stepDocuments),
      currentStepId: run.currentStepId,
      startedAt: run.startedAt.toISOString(),
      completedAt: run.completedAt?.toISOString() ?? null,
      project: run.project,
      startedBy: run.startedBy,
      processDefinition: { id: run.processDefinition.id, name: run.processDefinition.name },
      // True while the run waits for someone to upload the next document (the open choices are the children of currentStepId).
      awaitingUpload,
      canUpload,
      canCancel,
      steps: definitionSteps.map((step) => {
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
          parentStepId: step.parentStepId,
          documentType: step.documentType,
          documentSubtype: step.documentSubtype,
          onPath: pathIds.has(step.id),
          // An open choice: a child of the last approved node while the run waits for the next upload.
          isOpenChoice:
            run.status === "IN_PROGRESS" && run.currentStepId !== null && !chosenLink && step.parentStepId === run.currentStepId,
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
