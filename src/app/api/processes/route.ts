// src/app/api/processes/route.ts
import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { buildProcessVisibilityWhere } from "@/lib/auth/access";
import { prisma } from "@/lib/prisma";
import { getProcessStatusLabel } from "@/lib/process-status";

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
} as const;

// Process runs the person may see. Runs are never started by hand: uploading the root document of a process starts one.
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });

  const visibility = await buildProcessVisibilityWhere(session);
  const runs = await prisma.processInstance.findMany({ where: visibility, select: runSelect, orderBy: { startedAt: "desc" }, take: 200 });

  return NextResponse.json({
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
    })),
  });
}
