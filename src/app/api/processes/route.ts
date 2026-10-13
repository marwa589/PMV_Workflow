// src/app/api/processes/route.ts
import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { buildProcessVisibilityWhere, userHasPermission } from "@/lib/auth/access";
import { validateCsrf } from "@/lib/csrf";
import { prisma } from "@/lib/prisma";
import { startProcess } from "@/lib/workflow/processes";
import { WorkflowError } from "@/lib/workflow/errors";

export const runtime = "nodejs";

const runSelect = {
  id: true,
  reference: true,
  status: true,
  currentStepNumber: true,
  startedAt: true,
  completedAt: true,
  processDefinition: { select: { id: true, name: true, steps: { select: { id: true } } } },
  project: { select: { id: true, code: true, name: true } },
  startedBy: { select: { id: true, name: true } },
} as const;

// Process runs the person may see, plus the processes they are allowed to start.
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });

  const visibility = await buildProcessVisibilityWhere(session);
  const [runs, definitions] = await Promise.all([
    prisma.processInstance.findMany({ where: visibility, select: runSelect, orderBy: { startedAt: "desc" }, take: 200 }),
    prisma.processDefinition.findMany({ where: { isActive: true }, select: { id: true, name: true, description: true }, orderBy: { name: "asc" } }),
  ]);

  // A person can start a process when they hold processes.start for it (any project they might choose).
  const startable = [];
  for (const definition of definitions) {
    if (await userHasPermission(session, "processes.start", { processDefinitionId: definition.id })) startable.push(definition);
  }

  return NextResponse.json({
    runs: runs.map((run) => ({
      id: run.id,
      reference: run.reference,
      status: run.status,
      currentStepNumber: run.currentStepNumber,
      totalSteps: run.processDefinition.steps.length,
      processDefinition: { id: run.processDefinition.id, name: run.processDefinition.name },
      project: run.project,
      startedBy: run.startedBy,
      startedAt: run.startedAt.toISOString(),
      completedAt: run.completedAt?.toISOString() ?? null,
    })),
    startable,
  });
}

// Start a run. Needs processes.start for this process and project; documents are then added step by step.
export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  if (!validateCsrf(request)) return NextResponse.json({ message: "Invalid CSRF token." }, { status: 403 });

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const processDefinitionId = typeof body?.processDefinitionId === "string" ? body.processDefinitionId.trim() : "";
  const projectId = typeof body?.projectId === "string" && body.projectId.trim() ? body.projectId.trim() : null;
  const reference = typeof body?.reference === "string" && body.reference.trim() ? body.reference.trim().slice(0, 200) : null;

  if (!processDefinitionId) return NextResponse.json({ message: "Choose the process to start." }, { status: 400 });

  const project = projectId
    ? await prisma.project.findFirst({ where: { id: projectId, isActive: true }, select: { locationId: true } })
    : null;
  if (projectId && !project) return NextResponse.json({ message: "This project is not available." }, { status: 400 });

  const allowed = await userHasPermission(session, "processes.start", {
    processDefinitionId,
    projectId,
    locationId: project?.locationId ?? null,
  });
  if (!allowed) return NextResponse.json({ message: "You are not allowed to start this process for this project." }, { status: 403 });

  try {
    const run = await prisma.$transaction((tx) => startProcess(tx, { processDefinitionId, projectId, reference, startedById: session.userId }));
    return NextResponse.json({ run: { id: run.id, currentStepNumber: run.currentStepNumber, status: run.status } }, { status: 201 });
  } catch (error) {
    if (error instanceof WorkflowError) return NextResponse.json({ message: error.message }, { status: error.status });
    return NextResponse.json({ message: "Unable to start the process." }, { status: 500 });
  }
}
