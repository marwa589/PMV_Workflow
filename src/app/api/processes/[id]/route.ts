// src/app/api/processes/[id]/route.ts
import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { buildDocumentVisibilityWhere, buildProcessVisibilityWhere, buildReferenceViewWhere, userHasPermission } from "@/lib/auth/access";
import { stepOpensAt } from "@/lib/process-status";
import { USER_TYPE } from "@/lib/auth/roles";
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
              delayHours: true,
              referenceDocumentType: { select: { id: true, code: true, name: true } },
              referenceDocumentSubtype: { select: { id: true, code: true, name: true } },
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
          referenceDocumentId: true,
          document: { select: { id: true, documentNumber: true, title: true, status: true, approvedAt: true, currentWorkflowStep: true } },
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
    const approvedAtForDelay = run.stepDocuments.find((link) => link.isCurrent && link.processStepId === run.currentStepId)?.document.approvedAt ?? null;
    for (const step of definitionSteps.filter((candidate) => candidate.parentStepId === run.currentStepId)) {
      // A choice in its waiting period cannot be uploaded (Admin users may override it).
      const opensAt = stepOpensAt(approvedAtForDelay, step.delayHours);
      if (opensAt && opensAt.getTime() > Date.now() && session.userType !== USER_TYPE.ADMIN) continue;
      if (await canUserUpload(prisma, actor, { documentTypeId: step.documentType.id, documentSubtypeId: step.documentSubtype?.id ?? null, projectId: run.project?.id ?? null })) {
        canUpload = true;
        break;
      }
    }
  }

  // Reference documents are shown only to people who hold "View reference documents" for them (and can see the document).
  const referenceIds = [...new Set(run.stepDocuments.flatMap((link) => (link.referenceDocumentId ? [link.referenceDocumentId] : [])))];
  let visibleReferences = new Map<string, { id: string; documentNumber: string; title: string }>();
  if (referenceIds.length > 0) {
    const [visibility, referenceView] = await Promise.all([buildDocumentVisibilityWhere(session), buildReferenceViewWhere(session)]);
    const rows = await prisma.document.findMany({
      where: { AND: [{ id: { in: referenceIds } }, visibility, referenceView] },
      select: { id: true, documentNumber: true, title: true },
    });
    visibleReferences = new Map(rows.map((row) => [row.id, row]));
  }
  const lastApprovedAt = run.stepDocuments.find((link) => link.isCurrent && link.processStepId === run.currentStepId)?.document.approvedAt ?? null;
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
            referenceDocument: link.referenceDocumentId ? visibleReferences.get(link.referenceDocumentId) ?? null : null,
          }));
        return {
          id: step.id,
          stepNumber: step.stepNumber,
          name: step.name,
          parentStepId: step.parentStepId,
          documentType: step.documentType,
          documentSubtype: step.documentSubtype,
          delayHours: step.delayHours,
          // Whether this step takes a reference document is configuration; only the document itself is permission-gated.
          referenceType: step.referenceDocumentType
            ? `${step.referenceDocumentType.name}${step.referenceDocumentSubtype ? ` - ${step.referenceDocumentSubtype.name}` : ""}`
            : null,
          // When the waiting period after the previous approval ends (null = no wait, or already over).
          opensAt: (() => {
            const opens = step.parentStepId === run.currentStepId ? stepOpensAt(lastApprovedAt, step.delayHours) : null;
            return opens && opens.getTime() > Date.now() ? opens.toISOString() : null;
          })(),
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
