// src/app/api/admin/processes/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { prismaErrorResponse, readJsonBody, requireApiPermission, str } from "@/lib/admin-api";

export const runtime = "nodejs";

const MAX_STEPS = 10;

const processSelect = {
  id: true,
  name: true,
  description: true,
  isActive: true,
  createdAt: true,
  steps: {
    orderBy: { stepNumber: "asc" },
    select: {
      id: true,
      stepNumber: true,
      name: true,
      documentTypeId: true,
      documentSubtypeId: true,
      documentType: { select: { id: true, code: true, name: true } },
      documentSubtype: { select: { id: true, code: true, name: true } },
    },
  },
  _count: { select: { instances: true } },
} as const;

type ParsedStep = { stepNumber: number; name: string; documentTypeId: string; documentSubtypeId: string | null };

/** Steps run 1, 2, 3 ... up to 10. Each step asks for one document of a type, or of a specific sub type. */
async function parseSteps(raw: unknown): Promise<{ steps?: ParsedStep[]; error?: string }> {
  if (!Array.isArray(raw) || raw.length === 0) return { error: "A process needs at least one step." };
  if (raw.length > MAX_STEPS) return { error: `A process can have at most ${MAX_STEPS} steps.` };

  const steps: ParsedStep[] = [];
  for (const [index, item] of raw.entries()) {
    const record = (item ?? {}) as Record<string, unknown>;
    const documentTypeId = str(record.documentTypeId);
    const documentSubtypeId = str(record.documentSubtypeId) || null;
    const name = str(record.name);
    if (!name || !documentTypeId) return { error: `Step ${index + 1} needs a name and a document type.` };

    const type = await prisma.documentType.findUnique({ where: { id: documentTypeId }, select: { id: true } });
    if (!type) return { error: `Step ${index + 1}: the document type does not exist.` };
    if (documentSubtypeId && !(await prisma.documentSubtype.findFirst({ where: { id: documentSubtypeId, documentTypeId }, select: { id: true } }))) {
      return { error: `Step ${index + 1}: the sub type does not belong to the document type.` };
    }
    steps.push({ stepNumber: index + 1, name, documentTypeId, documentSubtypeId });
  }
  return { steps };
}

export async function GET(request: Request) {
  const auth = await requireApiPermission(request, "processes.manage");
  if (auth.response) return auth.response;

  const [processes, documentTypes] = await Promise.all([
    prisma.processDefinition.findMany({ select: processSelect, orderBy: { name: "asc" } }),
    prisma.documentType.findMany({
      where: { isActive: true },
      select: { id: true, code: true, name: true, subtypes: { where: { isActive: true }, select: { id: true, code: true, name: true } } },
      orderBy: { name: "asc" },
    }),
  ]);
  return NextResponse.json({ processes, documentTypes });
}

export async function POST(request: Request) {
  const auth = await requireApiPermission(request, "processes.manage");
  if (auth.response) return auth.response;

  const body = await readJsonBody(request);
  const name = str(body?.name);
  if (!name) return NextResponse.json({ message: "Process name is required." }, { status: 400 });

  const parsed = await parseSteps(body?.steps);
  if (parsed.error || !parsed.steps) return NextResponse.json({ message: parsed.error }, { status: 400 });

  try {
    const process = await prisma.processDefinition.create({
      data: {
        name,
        description: str(body?.description) || null,
        isActive: body?.isActive === undefined ? true : Boolean(body.isActive),
        steps: { create: parsed.steps },
      },
      select: processSelect,
    });
    return NextResponse.json({ process }, { status: 201 });
  } catch (error) {
    return prismaErrorResponse(error, { duplicate: "A process with this name already exists." })
      ?? NextResponse.json({ message: "Unable to create the process." }, { status: 500 });
  }
}

// The steps of a process that already has runs cannot change; name, description and active state still can.
export async function PATCH(request: Request) {
  const auth = await requireApiPermission(request, "processes.manage");
  if (auth.response) return auth.response;

  const body = await readJsonBody(request);
  const id = str(body?.id);
  const name = str(body?.name);
  if (!id || !name) return NextResponse.json({ message: "Process id and name are required." }, { status: 400 });

  const runs = await prisma.processInstance.count({ where: { processDefinitionId: id } });
  let steps: ParsedStep[] | undefined;
  if (body?.steps !== undefined) {
    if (runs > 0) return NextResponse.json({ message: "This process already has runs, so its steps cannot be changed. Create a new process instead." }, { status: 409 });
    const parsed = await parseSteps(body.steps);
    if (parsed.error || !parsed.steps) return NextResponse.json({ message: parsed.error }, { status: 400 });
    steps = parsed.steps;
  }

  try {
    const process = await prisma.$transaction(async (tx) => {
      if (steps) await tx.processStep.deleteMany({ where: { processDefinitionId: id } });
      return tx.processDefinition.update({
        where: { id },
        data: {
          name,
          description: str(body?.description) || null,
          ...(typeof body?.isActive === "boolean" ? { isActive: body.isActive } : {}),
          ...(steps ? { steps: { create: steps } } : {}),
        },
        select: processSelect,
      });
    });
    return NextResponse.json({ process });
  } catch (error) {
    return prismaErrorResponse(error, { duplicate: "A process with this name already exists." })
      ?? NextResponse.json({ message: "Unable to update the process." }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  const auth = await requireApiPermission(request, "processes.manage");
  if (auth.response) return auth.response;

  const id = str((await readJsonBody(request))?.id);
  if (!id) return NextResponse.json({ message: "Process id is required." }, { status: 400 });

  try {
    await prisma.processDefinition.delete({ where: { id } });
    return NextResponse.json({ message: "Process deleted." });
  } catch (error) {
    return prismaErrorResponse(error, { reference: "This process already has runs. Deactivate it instead." })
      ?? NextResponse.json({ message: "Unable to delete the process." }, { status: 500 });
  }
}
