// src/app/api/admin/flows/route.ts
import { ApproverType, type Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { prismaErrorResponse, readJsonBody, requireApiPermission, str } from "@/lib/admin-api";

export const runtime = "nodejs";

const MAX_APPROVAL_LEVEL = 10;

const flowInclude = {
  steps: {
    orderBy: { stepNumber: "asc" },
    include: {
      approvers: {
        include: {
          user: { select: { id: true, name: true, email: true } },
          userType: { select: { id: true, name: true } },
        },
      },
    },
  },
  _count: { select: { assignments: true } },
} satisfies Prisma.DocumentWorkflowTemplateInclude;

type FlowRow = Prisma.DocumentWorkflowTemplateGetPayload<{ include: typeof flowInclude }>;

function serializeFlow(flow: FlowRow) {
  return {
    id: flow.id,
    code: flow.code,
    name: flow.name,
    description: flow.description,
    isActive: flow.isActive,
    createdAt: flow.createdAt.toISOString(),
    assignmentCount: flow._count.assignments,
    steps: flow.steps.map((step) => ({
      id: step.id,
      stepNumber: step.stepNumber,
      name: step.name,
      approvers: step.approvers.map((entry) => ({
        id: entry.id,
        approverType: entry.approverType,
        userId: entry.userId,
        userName: entry.user?.name ?? null,
        userEmail: entry.user?.email ?? null,
        userTypeId: entry.userTypeId,
        userTypeName: entry.userType?.name ?? null,
      })),
    })),
  };
}

type ParsedStep = { stepNumber: number; name: string | null; approvers: Array<{ approverType: ApproverType; userId: string | null; userTypeId: string | null }> };

/**
 * Level 0 is the uploader step (who may upload into the flow); levels 1..N are approvals, N up to 10.
 * Every level needs at least one entry. An entry is a named user OR a user type; any one entry is enough (OR).
 */
function parseSteps(raw: unknown): { steps?: ParsedStep[]; error?: string } {
  if (!Array.isArray(raw) || raw.length === 0) return { error: "A flow needs an uploader step (level 0) and at least one approval level." };

  const steps: ParsedStep[] = [];
  for (const [index, item] of raw.entries()) {
    if (!item || typeof item !== "object") return { error: `Step ${index + 1} is invalid.` };
    const record = item as Record<string, unknown>;
    const stepNumber = record.stepNumber;
    if (typeof stepNumber !== "number" || !Number.isInteger(stepNumber) || stepNumber < 0 || stepNumber > MAX_APPROVAL_LEVEL) {
      return { error: `Step ${index + 1}: level must be a whole number from 0 to ${MAX_APPROVAL_LEVEL}.` };
    }
    const label = stepNumber === 0 ? "Uploader step" : `Level ${stepNumber}`;

    const entries = Array.isArray(record.approvers) ? record.approvers : [];
    if (entries.length === 0) return { error: `${label} needs at least one user or user type.` };

    const approvers: ParsedStep["approvers"] = [];
    const seen = new Set<string>();
    for (const entry of entries) {
      const e = (entry ?? {}) as Record<string, unknown>;
      if (e.approverType === "USER" && typeof e.userId === "string" && e.userId.trim()) {
        const key = `U:${e.userId.trim()}`;
        if (seen.has(key)) return { error: `${label} lists the same user twice.` };
        seen.add(key);
        approvers.push({ approverType: ApproverType.USER, userId: e.userId.trim(), userTypeId: null });
      } else if (e.approverType === "USER_TYPE" && typeof e.userTypeId === "string" && e.userTypeId.trim()) {
        const key = `T:${e.userTypeId.trim()}`;
        if (seen.has(key)) return { error: `${label} lists the same user type twice.` };
        seen.add(key);
        approvers.push({ approverType: ApproverType.USER_TYPE, userId: null, userTypeId: e.userTypeId.trim() });
      } else {
        return { error: `${label} has an entry that is neither a user nor a user type.` };
      }
    }

    steps.push({ stepNumber, name: typeof record.name === "string" && record.name.trim() ? record.name.trim() : null, approvers });
  }

  const numbers = steps.map((step) => step.stepNumber).sort((a, b) => a - b);
  if (new Set(numbers).size !== numbers.length) return { error: "Each level can only appear once." };
  if (numbers[0] !== 0) return { error: "A flow needs an uploader step (level 0)." };
  if (numbers.length < 2) return { error: "A flow needs at least one approval level after the uploader step." };
  if (numbers.some((value, index) => value !== index)) return { error: "Approval levels must run 1, 2, 3 ... without gaps." };

  return { steps: steps.sort((a, b) => a.stepNumber - b.stepNumber) };
}

async function validateEntries(steps: ParsedStep[]): Promise<string | null> {
  const userIds = [...new Set(steps.flatMap((step) => step.approvers.flatMap((entry) => (entry.userId ? [entry.userId] : []))))];
  const typeIds = [...new Set(steps.flatMap((step) => step.approvers.flatMap((entry) => (entry.userTypeId ? [entry.userTypeId] : []))))];

  const [users, types] = await Promise.all([
    userIds.length ? prisma.user.findMany({ where: { id: { in: userIds }, isActive: true }, select: { id: true } }) : [],
    typeIds.length ? prisma.userType.findMany({ where: { id: { in: typeIds } }, select: { id: true } }) : [],
  ]);

  if (users.length !== userIds.length) return "One of the selected users does not exist or is inactive.";
  if (types.length !== typeIds.length) return "One of the selected user types does not exist.";
  return null;
}

function stepCreateData(steps: ParsedStep[]) {
  return steps.map((step) => ({
    stepNumber: step.stepNumber,
    name: step.name,
    approvers: { create: step.approvers },
  }));
}

export async function GET(request: Request) {
  const auth = await requireApiPermission(request, "flows.manage");
  if (auth.response) return auth.response;

  const [flows, users, userTypes] = await Promise.all([
    prisma.documentWorkflowTemplate.findMany({ include: flowInclude, orderBy: [{ code: "asc" }] }),
    prisma.user.findMany({
      where: { isActive: true },
      select: { id: true, name: true, email: true, userType: { select: { code: true, name: true } } },
      orderBy: { name: "asc" },
    }),
    prisma.userType.findMany({ select: { id: true, code: true, name: true }, orderBy: { name: "asc" } }),
  ]);

  return NextResponse.json({ flows: flows.map(serializeFlow), users, userTypes });
}

export async function POST(request: Request) {
  const auth = await requireApiPermission(request, "flows.manage");
  if (auth.response) return auth.response;

  const body = await readJsonBody(request);
  const code = str(body?.code);
  const name = str(body?.name);
  if (!code || !name) return NextResponse.json({ message: "Flow code and name are required." }, { status: 400 });

  const parsed = parseSteps(body?.steps);
  if (parsed.error || !parsed.steps) return NextResponse.json({ message: parsed.error }, { status: 400 });
  const entryProblem = await validateEntries(parsed.steps);
  if (entryProblem) return NextResponse.json({ message: entryProblem }, { status: 400 });

  try {
    const flow = await prisma.documentWorkflowTemplate.create({
      data: {
        code,
        name,
        description: str(body?.description) || null,
        isActive: body?.isActive === undefined ? true : Boolean(body.isActive),
        steps: { create: stepCreateData(parsed.steps) },
      },
      include: flowInclude,
    });
    return NextResponse.json({ flow: serializeFlow(flow) }, { status: 201 });
  } catch (error) {
    return prismaErrorResponse(error, { duplicate: "A flow with this code already exists." })
      ?? NextResponse.json({ message: "Unable to create the flow." }, { status: 500 });
  }
}

// Editing a flow never changes documents already in progress: each document keeps its own copy of the levels.
export async function PATCH(request: Request) {
  const auth = await requireApiPermission(request, "flows.manage");
  if (auth.response) return auth.response;

  const body = await readJsonBody(request);
  const id = str(body?.id);
  const code = str(body?.code);
  const name = str(body?.name);
  if (!id || !code || !name) return NextResponse.json({ message: "Flow id, code and name are required." }, { status: 400 });

  const parsed = parseSteps(body?.steps);
  if (parsed.error || !parsed.steps) return NextResponse.json({ message: parsed.error }, { status: 400 });
  const entryProblem = await validateEntries(parsed.steps);
  if (entryProblem) return NextResponse.json({ message: entryProblem }, { status: 400 });

  try {
    const flow = await prisma.$transaction(async (tx) => {
      await tx.documentWorkflowStep.deleteMany({ where: { templateId: id } });
      return tx.documentWorkflowTemplate.update({
        where: { id },
        data: {
          code,
          name,
          description: str(body?.description) || null,
          ...(typeof body?.isActive === "boolean" ? { isActive: body.isActive } : {}),
          steps: { create: stepCreateData(parsed.steps as ParsedStep[]) },
        },
        include: flowInclude,
      });
    });
    return NextResponse.json({ flow: serializeFlow(flow) });
  } catch (error) {
    return prismaErrorResponse(error, { duplicate: "A flow with this code already exists." })
      ?? NextResponse.json({ message: "Unable to update the flow." }, { status: 500 });
  }
}

// A flow that is still assigned cannot be deleted: those documents would silently become auto-approved.
export async function DELETE(request: Request) {
  const auth = await requireApiPermission(request, "flows.manage");
  if (auth.response) return auth.response;

  const body = await readJsonBody(request);
  const id = str(body?.id);
  if (!id) return NextResponse.json({ message: "Flow id is required." }, { status: 400 });

  const assignments = await prisma.documentWorkflowAssignment.count({ where: { templateId: id } });
  if (assignments > 0) {
    return NextResponse.json({ message: `This flow is used by ${assignments} flow assignment(s). Remove or change those first.` }, { status: 409 });
  }

  try {
    await prisma.documentWorkflowTemplate.delete({ where: { id } });
    return NextResponse.json({ message: "Flow deleted." });
  } catch (error) {
    return prismaErrorResponse(error) ?? NextResponse.json({ message: "Unable to delete the flow." }, { status: 500 });
  }
}
