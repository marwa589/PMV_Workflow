// src/app/api/admin/projects/route.ts
import { ApproverType, DocumentStatus, EmailEventType, StepStatus } from "@prisma/client";
import { dispatchWorkflowEffects } from "@/lib/workflow/effects";
import type { WorkflowEffects } from "@/lib/workflow/engine";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { deactivationConfirmationResponse, optionalId, prismaErrorResponse, readJsonBody, requireApiPermission, str } from "@/lib/admin-api";

export const runtime = "nodejs";

const projectSelect = {
  id: true,
  code: true,
  name: true,
  locationId: true,
  directorId: true,
  managerId: true,
  companyId: true,
  isActive: true,
  createdAt: true,
  location: { select: { id: true, name: true } },
  company: { select: { id: true, name: true, isActive: true } },
  director: { select: { id: true, name: true, email: true, isActive: true } },
  manager: { select: { id: true, name: true, email: true, isActive: true } },
  _count: { select: { documents: true } },
} as const;

function validCode(code: string): boolean {
  return /^[A-Za-z0-9_-]{1,20}$/.test(code);
}

// The director / manager must be an active user. `undefined` means "not sent" (leave as is), null means "nobody".
async function readPersonId(body: Record<string, unknown> | null, field: "directorId" | "managerId", roleName: string): Promise<{ value?: string | null; error?: string }> {
  if (!body || body[field] === undefined) return {};
  const userId = optionalId(body[field]);
  if (!userId) return { value: null };
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { isActive: true } });
  if (!user || !user.isActive) return { error: `The selected ${roleName} does not exist or is inactive.` };
  return { value: userId };
}

// The company the project belongs to (optional). `undefined` = not sent (leave as is), null = no company.
async function readCompanyId(body: Record<string, unknown> | null): Promise<{ value?: string | null; error?: string }> {
  if (!body || body.companyId === undefined) return {};
  const companyId = optionalId(body.companyId);
  if (!companyId) return { value: null };
  const company = await prisma.company.findUnique({ where: { id: companyId }, select: { id: true } });
  if (!company) return { error: "The selected company does not exist." };
  return { value: companyId };
}

// Levels of documents still in progress that were sent to the old director (or manager) move to the new one. Levels
// already acted on keep who acted. Clearing the person changes nothing for documents already in progress.
const OPEN_DOCUMENT_STATUSES = [DocumentStatus.PENDING, DocumentStatus.ON_HOLD, DocumentStatus.REVISION_REQUIRED];
const OPEN_STEP_STATUSES = [StepStatus.WAITING, StepStatus.PENDING, StepStatus.ON_HOLD, StepStatus.REVISION];

async function moveOpenLevels(projectId: string, userId: string, flag: "viaProjectDirector" | "viaProjectManager"): Promise<number> {
  const openStep = {
    actedAt: null,
    status: { in: OPEN_STEP_STATUSES },
    document: { projectId, status: { in: OPEN_DOCUMENT_STATUSES } },
  };
  const marked = flag === "viaProjectDirector" ? { viaProjectDirector: true } : { viaProjectManager: true };
  return prisma.$transaction(async (tx) => {
    // Where the new person already holds this role's entry on the same level, the old one is simply removed.
    await tx.documentApprovalStepApprover.deleteMany({
      where: { ...marked, userId: { not: userId }, step: { ...openStep, approvers: { some: { userId, ...marked } } } },
    });
    const moved = await tx.documentApprovalStepApprover.updateMany({
      where: { ...marked, userId: { not: userId }, step: openStep },
      data: { userId },
    });
    return moved.count;
  });
}

// Levels that were waiting because the project had no director (or manager) when the document was uploaded get the
// new person now. Whoever has a level in front of them right now is told, as for any level that reaches them.
async function fillWaitingLevels(projectId: string, userId: string, role: "director" | "manager"): Promise<number> {
  const waiting = role === "director" ? { awaitingProjectDirector: true } : { awaitingProjectManager: true };
  const steps = await prisma.documentApprovalStep.findMany({
    where: { ...waiting, actedAt: null, status: { in: OPEN_STEP_STATUSES }, document: { projectId, status: { in: OPEN_DOCUMENT_STATUSES } } },
    select: {
      id: true,
      levelNumber: true,
      status: true,
      approvers: { select: { userId: true } },
      document: { select: { id: true, documentNumber: true, title: true, status: true, currentWorkflowStep: true } },
    },
  });
  if (steps.length === 0) return 0;

  const effects: WorkflowEffects = { notifications: [], emailEvents: [] };
  for (const step of steps) {
    await prisma.$transaction([
      ...(step.approvers.some((entry) => entry.userId === userId)
        ? []
        : [prisma.documentApprovalStepApprover.create({
            data: {
              stepId: step.id,
              approverType: ApproverType.USER,
              userId,
              userTypeId: null,
              ...(role === "director" ? { viaProjectDirector: true } : { viaProjectManager: true }),
            },
          })]),
      prisma.documentApprovalStep.update({
        where: { id: step.id },
        data: role === "director" ? { awaitingProjectDirector: false } : { awaitingProjectManager: false },
      }),
    ]);
    const isCurrent =
      step.status === StepStatus.PENDING && step.document.status === DocumentStatus.PENDING && step.document.currentWorkflowStep === step.levelNumber;
    if (isCurrent) {
      effects.notifications.push({
        userId,
        type: "PENDING_APPROVAL",
        title: "Document waiting for your approval",
        message: `${step.document.documentNumber} - ${step.document.title}`,
        documentId: step.document.id,
      });
      effects.emailEvents.push({ recipientId: userId, type: EmailEventType.APPROVAL_PENDING, documentId: step.document.id });
    }
  }
  await dispatchWorkflowEffects(effects);
  return steps.length;
}

// Projects replace the old free-text project name and ERR projects. The short code appears in document numbers.
export async function GET(request: Request) {
  const auth = await requireApiPermission(request, "projects.manage");
  if (auth.response) return auth.response;

  const [projects, locations, users, companies] = await Promise.all([
    prisma.project.findMany({ select: projectSelect, orderBy: { code: "asc" } }),
    prisma.location.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
    // Choices for the project director and manager.
    prisma.user.findMany({
      where: { isActive: true },
      select: { id: true, name: true, email: true, userType: { select: { name: true } } },
      orderBy: { name: "asc" },
    }),
    // Choices for the project's company.
    prisma.company.findMany({ where: { isActive: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);
  return NextResponse.json({ projects, locations, users, companies });
}

export async function POST(request: Request) {
  const auth = await requireApiPermission(request, "projects.manage");
  if (auth.response) return auth.response;

  const body = await readJsonBody(request);
  const code = str(body?.code).toUpperCase();
  const name = str(body?.name);
  const locationId = optionalId(body?.locationId);
  const director = await readPersonId(body, "directorId", "project director");
  if (director.error) return NextResponse.json({ message: director.error }, { status: 400 });
  const manager = await readPersonId(body, "managerId", "project manager");
  if (manager.error) return NextResponse.json({ message: manager.error }, { status: 400 });
  const company = await readCompanyId(body);
  if (company.error) return NextResponse.json({ message: company.error }, { status: 400 });

  if (!name || !validCode(code)) {
    return NextResponse.json({ message: "A name and a short code (letters, numbers, - or _, up to 20 characters) are required." }, { status: 400 });
  }
  if (locationId && !(await prisma.location.findUnique({ where: { id: locationId }, select: { id: true } }))) {
    return NextResponse.json({ message: "Selected location does not exist." }, { status: 400 });
  }

  try {
    const project = await prisma.project.create({
      data: { code, name, locationId, directorId: director.value ?? null, managerId: manager.value ?? null, companyId: company.value ?? null, isActive: body?.isActive === undefined ? true : Boolean(body.isActive) },
      select: projectSelect,
    });
    return NextResponse.json({ project }, { status: 201 });
  } catch (error) {
    return prismaErrorResponse(error, { duplicate: "A project with this code already exists." })
      ?? NextResponse.json({ message: "Unable to create the project." }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  const auth = await requireApiPermission(request, "projects.manage");
  if (auth.response) return auth.response;

  const body = await readJsonBody(request);
  const id = str(body?.id);
  const code = str(body?.code).toUpperCase();
  const name = str(body?.name);
  const locationId = optionalId(body?.locationId);

  if (!id || !name || !validCode(code)) return NextResponse.json({ message: "Id, name and a valid short code are required." }, { status: 400 });
  const director = await readPersonId(body, "directorId", "project director");
  if (director.error) return NextResponse.json({ message: director.error }, { status: 400 });
  const manager = await readPersonId(body, "managerId", "project manager");
  if (manager.error) return NextResponse.json({ message: manager.error }, { status: 400 });
  const company = await readCompanyId(body);
  if (company.error) return NextResponse.json({ message: company.error }, { status: 400 });
  if (locationId && !(await prisma.location.findUnique({ where: { id: locationId }, select: { id: true } }))) {
    return NextResponse.json({ message: "Selected location does not exist." }, { status: 400 });
  }

  try {
    if (body?.isActive === false) {
      const usage = await prisma.project.findUnique({
        where: { id },
        select: {
          isActive: true,
          _count: {
            select: { documents: true, processInstances: true, flowAssignments: true, scopedAssignments: true, assignmentScopes: true },
          },
        },
      });
      if (usage?.isActive) {
        const confirmation = deactivationConfirmationResponse(body, "This project", [
          { label: "document(s)", count: usage._count.documents },
          { label: "process run(s)", count: usage._count.processInstances },
          { label: "flow assignment(s)", count: usage._count.flowAssignments },
          { label: "role assignment(s)", count: usage._count.scopedAssignments + usage._count.assignmentScopes },
        ]);
        if (confirmation) return confirmation;
      }
    }

    const before = await prisma.project.findUnique({ where: { id }, select: { directorId: true, managerId: true } });
    const project = await prisma.project.update({
      where: { id },
      data: {
        code,
        name,
        locationId,
        ...(director.value !== undefined ? { directorId: director.value } : {}),
        ...(manager.value !== undefined ? { managerId: manager.value } : {}),
        ...(company.value !== undefined ? { companyId: company.value } : {}),
        ...(typeof body?.isActive === "boolean" ? { isActive: body.isActive } : {}),
      },
      select: projectSelect,
    });
    const directorChanged = !!director.value && !!before && before.directorId !== director.value;
    const managerChanged = !!manager.value && !!before && before.managerId !== manager.value;
    const movedLevels =
      (directorChanged && director.value ? await moveOpenLevels(id, director.value, "viaProjectDirector") + await fillWaitingLevels(id, director.value, "director") : 0) +
      (managerChanged && manager.value ? await moveOpenLevels(id, manager.value, "viaProjectManager") + await fillWaitingLevels(id, manager.value, "manager") : 0);
    return NextResponse.json({ project, movedLevels });
  } catch (error) {
    return prismaErrorResponse(error, { duplicate: "A project with this code already exists." })
      ?? NextResponse.json({ message: "Unable to update the project." }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  const auth = await requireApiPermission(request, "projects.manage");
  if (auth.response) return auth.response;

  const id = str((await readJsonBody(request))?.id);
  if (!id) return NextResponse.json({ message: "Project id is required." }, { status: 400 });

  try {
    await prisma.project.delete({ where: { id } });
    return NextResponse.json({ message: "Project deleted." });
  } catch (error) {
    return prismaErrorResponse(error, { reference: "Documents or process runs use this project. Deactivate it instead." })
      ?? NextResponse.json({ message: "Unable to delete the project." }, { status: 500 });
  }
}
