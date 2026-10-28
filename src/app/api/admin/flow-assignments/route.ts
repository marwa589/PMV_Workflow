// src/app/api/admin/flow-assignments/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { optionalId, prismaErrorResponse, readJsonBody, requireApiPermission, str } from "@/lib/admin-api";

export const runtime = "nodejs";

const assignmentInclude = {
  documentType: { select: { id: true, code: true, name: true } },
  documentSubtype: { select: { id: true, code: true, name: true } },
  project: { select: { id: true, code: true, name: true } },
  template: { select: { id: true, code: true, name: true } },
} as const;

/**
 * Decides which flow a document gets. A row targets a document type, optionally narrowed to a sub type
 * and/or a project; the most specific row wins. An empty templateId means "no approval needed" (auto-approve).
 */
export async function GET(request: Request) {
  const auth = await requireApiPermission(request, "flows.manage");
  if (auth.response) return auth.response;

  const [assignments, documentTypes, projects, flows] = await Promise.all([
    prisma.documentWorkflowAssignment.findMany({
      include: assignmentInclude,
      orderBy: [{ documentType: { code: "asc" } }, { createdAt: "asc" }],
    }),
    prisma.documentType.findMany({
      where: { isActive: true },
      select: { id: true, code: true, name: true, subtypes: { where: { isActive: true }, select: { id: true, code: true, name: true } } },
      orderBy: { name: "asc" },
    }),
    prisma.project.findMany({ where: { isActive: true }, select: { id: true, code: true, name: true }, orderBy: { code: "asc" } }),
    prisma.documentWorkflowTemplate.findMany({ where: { isActive: true }, select: { id: true, code: true, name: true }, orderBy: { code: "asc" } }),
  ]);

  return NextResponse.json({ assignments, documentTypes, projects, flows });
}

async function validateTarget(body: Record<string, unknown> | null) {
  const documentTypeId = optionalId(body?.documentTypeId);
  const documentSubtypeId = optionalId(body?.documentSubtypeId);
  const projectId = optionalId(body?.projectId);
  const templateId = optionalId(body?.templateId); // null = auto-approve

  if (!documentTypeId) return { error: "Document type is required." };

  const type = await prisma.documentType.findUnique({ where: { id: documentTypeId }, select: { id: true } });
  if (!type) return { error: "Selected document type does not exist." };

  if (documentSubtypeId) {
    const subtype = await prisma.documentSubtype.findFirst({ where: { id: documentSubtypeId, documentTypeId }, select: { id: true } });
    if (!subtype) return { error: "The sub type does not belong to the selected document type." };
  }
  if (projectId && !(await prisma.project.findUnique({ where: { id: projectId }, select: { id: true } }))) {
    return { error: "Selected project does not exist." };
  }
  if (templateId && !(await prisma.documentWorkflowTemplate.findUnique({ where: { id: templateId }, select: { id: true } }))) {
    return { error: "Selected flow does not exist." };
  }

  return { value: { documentTypeId, documentSubtypeId, projectId, templateId } };
}

export async function POST(request: Request) {
  const auth = await requireApiPermission(request, "flows.manage");
  if (auth.response) return auth.response;

  const checked = await validateTarget(await readJsonBody(request));
  if (checked.error || !checked.value) return NextResponse.json({ message: checked.error }, { status: 400 });

  // One flow per scope: the same type + sub type + project cannot be assigned twice (not even to a different flow).
  const existing = await prisma.documentWorkflowAssignment.findFirst({
    where: {
      documentTypeId: checked.value.documentTypeId,
      documentSubtypeId: checked.value.documentSubtypeId,
      projectId: checked.value.projectId,
    },
    select: { id: true, template: { select: { name: true } } },
  });
  if (existing) {
    return NextResponse.json(
      {
        message: `This document type, sub type and project already has ${existing.template ? `the flow "${existing.template.name}"` : "an auto-approve assignment"}. Change or delete that assignment instead of adding a second one.`,
      },
      { status: 409 },
    );
  }

  try {
    const assignment = await prisma.documentWorkflowAssignment.create({ data: checked.value, include: assignmentInclude });
    return NextResponse.json({ assignment }, { status: 201 });
  } catch (error) {
    return prismaErrorResponse(error, { duplicate: "There is already a flow assignment for this type, sub type and project." })
      ?? NextResponse.json({ message: "Unable to save the flow assignment." }, { status: 500 });
  }
}

// Change which flow a row points to (or set it to auto-approve). The target (type, sub type, project) stays fixed.
export async function PATCH(request: Request) {
  const auth = await requireApiPermission(request, "flows.manage");
  if (auth.response) return auth.response;

  const body = await readJsonBody(request);
  const id = str(body?.id);
  if (!id) return NextResponse.json({ message: "Assignment id is required." }, { status: 400 });

  const templateId = optionalId(body?.templateId);
  if (templateId && !(await prisma.documentWorkflowTemplate.findUnique({ where: { id: templateId }, select: { id: true } }))) {
    return NextResponse.json({ message: "Selected flow does not exist." }, { status: 400 });
  }

  try {
    const assignment = await prisma.documentWorkflowAssignment.update({ where: { id }, data: { templateId }, include: assignmentInclude });
    return NextResponse.json({ assignment });
  } catch (error) {
    return prismaErrorResponse(error) ?? NextResponse.json({ message: "Unable to update the flow assignment." }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  const auth = await requireApiPermission(request, "flows.manage");
  if (auth.response) return auth.response;

  const id = str((await readJsonBody(request))?.id);
  if (!id) return NextResponse.json({ message: "Assignment id is required." }, { status: 400 });

  try {
    await prisma.documentWorkflowAssignment.delete({ where: { id } });
    return NextResponse.json({ message: "Flow assignment deleted." });
  } catch (error) {
    return prismaErrorResponse(error) ?? NextResponse.json({ message: "Unable to delete the flow assignment." }, { status: 500 });
  }
}
