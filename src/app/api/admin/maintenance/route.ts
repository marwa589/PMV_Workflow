import { ApproverType, Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { prismaErrorResponse, readJsonBody, requireApiPermission, str } from "@/lib/admin-api";
import { SUBMIT_LEVEL } from "@/lib/maintenance/access";

export const runtime = "nodejs";

const workflowInclude = {
  levels: { orderBy: { levelNumber: "asc" as const }, include: { approvers: { include: { user: { select: { id: true, name: true, email: true } }, userType: { select: { id: true, name: true } } } } } },
  _count: { select: { assignments: true } },
} satisfies Prisma.MaintenanceWorkflowInclude;

type ParsedApprover = { approverType: ApproverType; userId?: string; userTypeId?: string };
type ParsedLevel = { levelNumber: number; name: string; approvers: ParsedApprover[] };

function parseApprovers(raw: unknown): ParsedApprover[] {
  const result: ParsedApprover[] = [];
  const seen = new Set<string>();
  for (const entry of Array.isArray(raw) ? raw : []) {
    const item = (entry ?? {}) as Record<string, unknown>;
    const parsed: ParsedApprover | null =
      item.type === "USER" && str(item.userId) ? { approverType: ApproverType.USER, userId: str(item.userId) }
      : item.type === "USER_TYPE" && str(item.userTypeId) ? { approverType: ApproverType.USER_TYPE, userTypeId: str(item.userTypeId) }
      : null;
    if (!parsed) continue;
    const key = `${parsed.approverType}:${parsed.userId ?? parsed.userTypeId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(parsed);
  }
  return result;
}

/** Body shape: { name, description, submitters: [...], levels: [{ name, approvers: [...] }] }. Level 0 is built from `submitters`. */
async function parseWorkflowBody(body: Record<string, unknown>): Promise<{ error: string } | { name: string; description: string | null; levels: ParsedLevel[] }> {
  const name = str(body.name);
  const description = str(body.description) || null;
  const submitters = parseApprovers(body.submitters);
  const rawLevels = Array.isArray(body.levels) ? body.levels : [];
  if (!name) return { error: "Enter a workflow name." };
  if (submitters.length === 0) return { error: "Choose at least one person or user type who can submit tickets." };
  if (rawLevels.length === 0 || rawLevels.length > 10) return { error: "A workflow needs between 1 and 10 follow-up levels." };

  const levels: ParsedLevel[] = [{ levelNumber: SUBMIT_LEVEL, name: "Submit ticket", approvers: submitters }];
  for (const [index, rawLevel] of rawLevels.entries()) {
    const level = (rawLevel ?? {}) as Record<string, unknown>;
    const approvers = parseApprovers(level.approvers);
    if (approvers.length === 0) return { error: `Follow-up level ${index + 1} needs at least one named user or user type.` };
    levels.push({ levelNumber: index + 1, name: str(level.name) || `Level ${index + 1}`, approvers });
  }

  const userIds = [...new Set(levels.flatMap((l) => l.approvers.flatMap((a) => (a.userId ? [a.userId] : []))))];
  const typeIds = [...new Set(levels.flatMap((l) => l.approvers.flatMap((a) => (a.userTypeId ? [a.userTypeId] : []))))];
  const [validUsers, validTypes] = await Promise.all([
    userIds.length ? prisma.user.count({ where: { id: { in: userIds }, isActive: true } }) : 0,
    typeIds.length ? prisma.userType.count({ where: { id: { in: typeIds } } }) : 0,
  ]);
  if (validUsers !== userIds.length || validTypes !== typeIds.length) return { error: "One or more selected users or user types are invalid or inactive." };
  return { name, description, levels };
}

const levelCreate = (levels: ParsedLevel[]) =>
  levels.map((level) => ({ levelNumber: level.levelNumber, name: level.name, approvers: { create: level.approvers } }));

export async function GET(request: Request) {
  const auth = await requireApiPermission(request, "maintenance.manage");
  if (auth.response) return auth.response;
  const [items, workflows, assignments, projects, users, userTypes] = await Promise.all([
    prisma.maintenanceItem.findMany({ orderBy: { name: "asc" } }),
    prisma.maintenanceWorkflow.findMany({ include: workflowInclude, orderBy: { name: "asc" } }),
    prisma.maintenanceWorkflowAssignment.findMany({
      include: { project: { select: { id: true, code: true, name: true } }, item: { select: { id: true, name: true } }, workflow: { select: { id: true, name: true } } },
      orderBy: [{ project: { code: "asc" } }, { item: { name: "asc" } }],
    }),
    prisma.project.findMany({ where: { isActive: true }, select: { id: true, code: true, name: true }, orderBy: { code: "asc" } }),
    prisma.user.findMany({ where: { isActive: true }, select: { id: true, name: true, email: true, userTypeId: true }, orderBy: { name: "asc" } }),
    prisma.userType.findMany({ select: { id: true, name: true, code: true }, orderBy: { name: "asc" } }),
  ]);
  return NextResponse.json({ items, workflows, assignments, projects, users, userTypes });
}

export async function POST(request: Request) {
  const auth = await requireApiPermission(request, "maintenance.manage");
  if (auth.response) return auth.response;
  const body = await readJsonBody(request);
  if (!body) return NextResponse.json({ message: "Invalid request." }, { status: 400 });
  const action = str(body.action);

  if (action === "item") {
    const name = str(body.name);
    if (!name) return NextResponse.json({ message: "Item name is required." }, { status: 400 });
    try {
      const item = await prisma.maintenanceItem.create({ data: { name } });
      return NextResponse.json({ item }, { status: 201 });
    } catch (error) {
      return prismaErrorResponse(error, { duplicate: "A maintenance item with this name already exists." }) ?? NextResponse.json({ message: "Unable to create item." }, { status: 500 });
    }
  }

  if (action === "workflow") {
    const parsed = await parseWorkflowBody(body);
    if ("error" in parsed) return NextResponse.json({ message: parsed.error }, { status: 400 });
    try {
      const workflow = await prisma.maintenanceWorkflow.create({
        data: { name: parsed.name, description: parsed.description, levels: { create: levelCreate(parsed.levels) } },
        include: workflowInclude,
      });
      return NextResponse.json({ workflow }, { status: 201 });
    } catch (error) {
      return prismaErrorResponse(error, { duplicate: "A maintenance workflow with this name already exists." }) ?? NextResponse.json({ message: "Unable to create workflow." }, { status: 500 });
    }
  }

  if (action === "assignment") {
    // One workflow for several projects and items at once: every project x item combination is saved.
    const asList = (many: unknown, single: unknown) => [...new Set([...(Array.isArray(many) ? many : []), single].map(str).filter(Boolean))];
    const projectIds = asList(body.projectIds, body.projectId);
    const itemIds = asList(body.itemIds, body.itemId);
    const workflowId = str(body.workflowId);
    if (projectIds.length === 0 || itemIds.length === 0 || !workflowId) return NextResponse.json({ message: "Choose at least one project, one item and a workflow." }, { status: 400 });
    if (projectIds.length * itemIds.length > 500) return NextResponse.json({ message: "That is too many combinations at once. Choose fewer projects or items." }, { status: 400 });

    const [projectCount, itemCount, workflow] = await Promise.all([
      prisma.project.count({ where: { id: { in: projectIds }, isActive: true } }),
      prisma.maintenanceItem.count({ where: { id: { in: itemIds }, isActive: true } }),
      prisma.maintenanceWorkflow.findFirst({ where: { id: workflowId, isActive: true }, include: { levels: { select: { levelNumber: true, _count: { select: { approvers: true } } } } } }),
    ]);
    if (projectCount !== projectIds.length || itemCount !== itemIds.length || !workflow) return NextResponse.json({ message: "Choose active projects, active items and an active workflow." }, { status: 400 });
    const hasSubmitters = workflow.levels.some((level) => level.levelNumber === SUBMIT_LEVEL && level._count.approvers > 0);
    const hasFollowUp = workflow.levels.some((level) => level.levelNumber > SUBMIT_LEVEL);
    if (!hasSubmitters || !hasFollowUp) return NextResponse.json({ message: "This workflow is incomplete. Edit it to add submitters and at least one follow-up level first." }, { status: 400 });

    try {
      await prisma.$transaction(
        projectIds.flatMap((projectId) =>
          itemIds.map((itemId) => prisma.maintenanceWorkflowAssignment.upsert({ where: { projectId_itemId: { projectId, itemId } }, update: { workflowId }, create: { projectId, itemId, workflowId } })),
        ),
      );
      return NextResponse.json({ saved: projectIds.length * itemIds.length }, { status: 201 });
    } catch (error) {
      return prismaErrorResponse(error) ?? NextResponse.json({ message: "Unable to save workflow assignment." }, { status: 500 });
    }
  }

  return NextResponse.json({ message: "Unknown maintenance setup action." }, { status: 400 });
}

export async function PATCH(request: Request) {
  const auth = await requireApiPermission(request, "maintenance.manage");
  if (auth.response) return auth.response;
  const body = await readJsonBody(request);
  if (!body) return NextResponse.json({ message: "Invalid request." }, { status: 400 });
  const action = str(body.action);
  const id = str(body.id);
  if (!id) return NextResponse.json({ message: "Record id is required." }, { status: 400 });
  try {
    if (action === "item") {
      const name = str(body.name);
      if (!name) return NextResponse.json({ message: "Item name is required." }, { status: 400 });
      const item = await prisma.maintenanceItem.update({ where: { id }, data: { name, ...(typeof body.isActive === "boolean" ? { isActive: body.isActive } : {}) } });
      return NextResponse.json({ item });
    }
    if (action === "workflow") {
      // Sending levels replaces the whole definition. Tickets already submitted keep their own copy of the levels.
      if (Array.isArray(body.levels) || Array.isArray(body.submitters)) {
        const parsed = await parseWorkflowBody(body);
        if ("error" in parsed) return NextResponse.json({ message: parsed.error }, { status: 400 });
        const workflow = await prisma.$transaction(async (tx) => {
          await tx.maintenanceWorkflowLevel.deleteMany({ where: { workflowId: id } });
          return tx.maintenanceWorkflow.update({
            where: { id },
            data: { name: parsed.name, description: parsed.description, ...(typeof body.isActive === "boolean" ? { isActive: body.isActive } : {}), levels: { create: levelCreate(parsed.levels) } },
            include: workflowInclude,
          });
        });
        return NextResponse.json({ workflow });
      }
      const workflow = await prisma.maintenanceWorkflow.update({
        where: { id },
        data: { ...(typeof body.isActive === "boolean" ? { isActive: body.isActive } : {}), ...(str(body.name) ? { name: str(body.name) } : {}) },
      });
      return NextResponse.json({ workflow });
    }
    return NextResponse.json({ message: "Unknown maintenance setup action." }, { status: 400 });
  } catch (error) {
    return prismaErrorResponse(error, { duplicate: "That name is already in use." }) ?? NextResponse.json({ message: "Unable to update maintenance setup." }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  const auth = await requireApiPermission(request, "maintenance.manage");
  if (auth.response) return auth.response;
  const body = await readJsonBody(request);
  const id = str(body?.id);
  if (!id) return NextResponse.json({ message: "Record id is required." }, { status: 400 });
  if (str(body?.action) !== "assignment") return NextResponse.json({ message: "Unknown maintenance setup action." }, { status: 400 });
  try {
    await prisma.maintenanceWorkflowAssignment.delete({ where: { id } });
    return NextResponse.json({ deleted: true });
  } catch (error) {
    return prismaErrorResponse(error) ?? NextResponse.json({ message: "Unable to remove the assignment." }, { status: 500 });
  }
}
