import { ApproverType, DocumentStatus, EmailEventType, StepStatus } from "@prisma/client";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { readJsonBody, requireApiAdmin, str } from "@/lib/admin-api";
import { writeAuditLog } from "@/lib/audit";
import { dispatchWorkflowEffects } from "@/lib/workflow/effects";
import type { WorkflowEffects } from "@/lib/workflow/engine";

/**
 * Admin only: send the level a document waits at to a chosen person. Used when nobody can act on the level, for example
 * when it goes to the Project Director and the project has none yet. The person is added to that level (for this
 * document only) and told; the level stops waiting for the missing Project Director / Manager.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireApiAdmin(request);
  if (guard.response) return guard.response;
  const { session } = guard;
  const { id } = await params;

  const body = await readJsonBody(request);
  const userId = str(body?.userId);
  if (!userId) return NextResponse.json({ message: "Choose the person to send this level to." }, { status: 400 });

  const [document, user] = await Promise.all([
    prisma.document.findUnique({
      where: { id },
      select: {
        id: true,
        documentNumber: true,
        title: true,
        status: true,
        currentWorkflowStep: true,
        approvalSteps: { select: { id: true, levelNumber: true, name: true, status: true, approvers: { select: { userId: true } } } },
      },
    }),
    prisma.user.findUnique({ where: { id: userId }, select: { id: true, name: true, isActive: true } }),
  ]);
  if (!document) return NextResponse.json({ message: "Document not found." }, { status: 404 });
  if (!user || !user.isActive) return NextResponse.json({ message: "The selected person is not an active user." }, { status: 400 });
  if (document.status !== DocumentStatus.PENDING || document.currentWorkflowStep === null) {
    return NextResponse.json({ message: "Only a document waiting for approval can be sent to someone." }, { status: 409 });
  }
  const step = document.approvalSteps.find((candidate) => candidate.levelNumber === document.currentWorkflowStep);
  if (!step || step.status !== StepStatus.PENDING) {
    return NextResponse.json({ message: "The level this document waits at could not be found." }, { status: 409 });
  }
  if (step.approvers.some((entry) => entry.userId === user.id)) {
    return NextResponse.json({ message: `${user.name} is already an approver of this level.` }, { status: 409 });
  }

  await prisma.$transaction([
    prisma.documentApprovalStepApprover.create({
      data: { stepId: step.id, approverType: ApproverType.USER, userId: user.id, userTypeId: null },
    }),
    prisma.documentApprovalStep.update({
      where: { id: step.id },
      data: { awaitingProjectDirector: false, awaitingProjectManager: false },
    }),
    prisma.document.update({ where: { id: document.id }, data: { currentApproverAssignedAt: new Date() } }),
  ]);

  const levelName = step.name?.trim() || `Level ${step.levelNumber}`;
  const effects: WorkflowEffects = {
    notifications: [
      { userId: user.id, type: "PENDING_APPROVAL", title: "Document waiting for your approval", message: `${document.documentNumber} - ${document.title}`, documentId: document.id },
    ],
    emailEvents: [{ recipientId: user.id, type: EmailEventType.APPROVAL_PENDING, documentId: document.id }],
  };
  await dispatchWorkflowEffects(effects);
  await writeAuditLog({
    documentId: document.id,
    performedById: session.userId,
    action: "DOCUMENT_LEVEL_ASSIGNED",
    details: `${levelName} of ${document.documentNumber} sent to ${user.name} by an admin.`,
  }).catch(() => undefined);

  return NextResponse.json({ message: `${levelName} is now with ${user.name}.` });
}
