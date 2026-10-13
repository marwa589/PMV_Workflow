// src/app/api/admin/projects/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { optionalId, prismaErrorResponse, readJsonBody, requireApiPermission, str } from "@/lib/admin-api";

export const runtime = "nodejs";

const projectSelect = {
  id: true,
  code: true,
  name: true,
  locationId: true,
  isActive: true,
  createdAt: true,
  location: { select: { id: true, name: true } },
  _count: { select: { documents: true } },
} as const;

function validCode(code: string): boolean {
  return /^[A-Za-z0-9_-]{1,20}$/.test(code);
}

// Projects replace the old free-text project name and ERR projects. The short code appears in document numbers.
export async function GET(request: Request) {
  const auth = await requireApiPermission(request, "projects.manage");
  if (auth.response) return auth.response;

  const [projects, locations] = await Promise.all([
    prisma.project.findMany({ select: projectSelect, orderBy: { code: "asc" } }),
    prisma.location.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);
  return NextResponse.json({ projects, locations });
}

export async function POST(request: Request) {
  const auth = await requireApiPermission(request, "projects.manage");
  if (auth.response) return auth.response;

  const body = await readJsonBody(request);
  const code = str(body?.code).toUpperCase();
  const name = str(body?.name);
  const locationId = optionalId(body?.locationId);

  if (!name || !validCode(code)) {
    return NextResponse.json({ message: "A name and a short code (letters, numbers, - or _, up to 20 characters) are required." }, { status: 400 });
  }
  if (locationId && !(await prisma.location.findUnique({ where: { id: locationId }, select: { id: true } }))) {
    return NextResponse.json({ message: "Selected location does not exist." }, { status: 400 });
  }

  try {
    const project = await prisma.project.create({
      data: { code, name, locationId, isActive: body?.isActive === undefined ? true : Boolean(body.isActive) },
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
  if (locationId && !(await prisma.location.findUnique({ where: { id: locationId }, select: { id: true } }))) {
    return NextResponse.json({ message: "Selected location does not exist." }, { status: 400 });
  }

  try {
    const project = await prisma.project.update({
      where: { id },
      data: { code, name, locationId, ...(typeof body?.isActive === "boolean" ? { isActive: body.isActive } : {}) },
      select: projectSelect,
    });
    return NextResponse.json({ project });
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
