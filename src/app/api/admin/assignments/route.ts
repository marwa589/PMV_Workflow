// src/app/api/admin/assignments/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { optionalId, prismaErrorResponse, readJsonBody, requireApiPermission, str } from "@/lib/admin-api";

export const runtime = "nodejs";

const assignmentSelect = {
  id: true,
  userId: true,
  roleId: true,
  companyId: true,
  projectId: true,
  locationId: true,
  documentTypeId: true,
  documentSubtypeId: true,
  processDefinitionId: true,
  createdAt: true,
  user: { select: { id: true, name: true, email: true } },
  role: { select: { id: true, name: true } },
  company: { select: { id: true, name: true } },
  project: { select: { id: true, code: true, name: true } },
  location: { select: { id: true, name: true } },
  documentType: { select: { id: true, code: true, name: true } },
  documentSubtype: { select: { id: true, code: true, name: true } },
  processDefinition: { select: { id: true, name: true } },
} as const;

/**
 * One row: this user holds this role, limited to the scope columns that are set.
 * An empty scope column means no restriction on that item.
 */
export async function GET(request: Request) {
  const auth = await requireApiPermission(request, "assignments.manage");
  if (auth.response) return auth.response;

  const userId = new URL(request.url).searchParams.get("userId")?.trim();

  const [assignments, users, roles, companies, projects, locations, documentTypes, processes] = await Promise.all([
    prisma.userAssignment.findMany({ where: userId ? { userId } : {}, select: assignmentSelect, orderBy: [{ user: { name: "asc" } }, { createdAt: "asc" }] }),
    prisma.user.findMany({ where: { isActive: true }, select: { id: true, name: true, email: true, userType: { select: { code: true, name: true } } }, orderBy: { name: "asc" } }),
    prisma.role.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
    prisma.company.findMany({ where: { isActive: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    prisma.project.findMany({ where: { isActive: true }, select: { id: true, code: true, name: true }, orderBy: { code: "asc" } }),
    prisma.location.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
    prisma.documentType.findMany({
      where: { isActive: true },
      select: { id: true, code: true, name: true, subtypes: { where: { isActive: true }, select: { id: true, code: true, name: true } } },
      orderBy: { name: "asc" },
    }),
    prisma.processDefinition.findMany({ where: { isActive: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);

  return NextResponse.json({ assignments, users, roles, companies, projects, locations, documentTypes, processes });
}

export async function POST(request: Request) {
  const auth = await requireApiPermission(request, "assignments.manage");
  if (auth.response) return auth.response;

  const body = await readJsonBody(request);
  const userId = optionalId(body?.userId);
  const roleId = optionalId(body?.roleId);
  const data = {
    companyId: optionalId(body?.companyId),
    projectId: optionalId(body?.projectId),
    locationId: optionalId(body?.locationId),
    documentTypeId: optionalId(body?.documentTypeId),
    documentSubtypeId: optionalId(body?.documentSubtypeId),
    processDefinitionId: optionalId(body?.processDefinitionId),
  };

  if (!userId || !roleId) return NextResponse.json({ message: "User and role are required." }, { status: 400 });

  if (data.documentSubtypeId) {
    const subtype = await prisma.documentSubtype.findUnique({ where: { id: data.documentSubtypeId }, select: { documentTypeId: true } });
    if (!subtype) return NextResponse.json({ message: "Selected sub type does not exist." }, { status: 400 });
    if (!data.documentTypeId) return NextResponse.json({ message: "Choose the document type that the sub type belongs to." }, { status: 400 });
    if (subtype.documentTypeId !== data.documentTypeId) {
      return NextResponse.json({ message: "The sub type does not belong to the selected document type." }, { status: 400 });
    }
  }

  try {
    const assignment = await prisma.userAssignment.create({ data: { userId, roleId, ...data }, select: assignmentSelect });
    return NextResponse.json({ assignment }, { status: 201 });
  } catch (error) {
    return prismaErrorResponse(error, {
      duplicate: "This user already holds this role with exactly this scope.",
      reference: "One of the selected items (user, role or scope) does not exist.",
    }) ?? NextResponse.json({ message: "Unable to save the assignment." }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  const auth = await requireApiPermission(request, "assignments.manage");
  if (auth.response) return auth.response;

  const id = str((await readJsonBody(request))?.id);
  if (!id) return NextResponse.json({ message: "Assignment id is required." }, { status: 400 });

  try {
    await prisma.userAssignment.delete({ where: { id } });
    return NextResponse.json({ message: "Assignment removed." });
  } catch (error) {
    return prismaErrorResponse(error) ?? NextResponse.json({ message: "Unable to remove the assignment." }, { status: 500 });
  }
}
