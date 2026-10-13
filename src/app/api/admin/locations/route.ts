// src/app/api/admin/locations/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { prismaErrorResponse, readJsonBody, requireApiPermission, str } from "@/lib/admin-api";

export const runtime = "nodejs";

// Locations are generally countries. A flat list; companies and projects are attached to them.
export async function GET(request: Request) {
  const auth = await requireApiPermission(request, "projects.manage");
  if (auth.response) return auth.response;

  const locations = await prisma.location.findMany({
    select: { id: true, name: true, createdAt: true, _count: { select: { projects: true, companies: true } } },
    orderBy: { name: "asc" },
  });
  return NextResponse.json({ locations });
}

export async function POST(request: Request) {
  const auth = await requireApiPermission(request, "projects.manage");
  if (auth.response) return auth.response;

  const name = str((await readJsonBody(request))?.name);
  if (!name) return NextResponse.json({ message: "Location name is required." }, { status: 400 });

  try {
    const location = await prisma.location.create({ data: { name }, select: { id: true, name: true } });
    return NextResponse.json({ location }, { status: 201 });
  } catch (error) {
    return prismaErrorResponse(error, { duplicate: "A location with this name already exists." })
      ?? NextResponse.json({ message: "Unable to create the location." }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  const auth = await requireApiPermission(request, "projects.manage");
  if (auth.response) return auth.response;

  const body = await readJsonBody(request);
  const id = str(body?.id);
  const name = str(body?.name);
  if (!id || !name) return NextResponse.json({ message: "Location id and name are required." }, { status: 400 });

  try {
    const location = await prisma.location.update({ where: { id }, data: { name }, select: { id: true, name: true } });
    return NextResponse.json({ location });
  } catch (error) {
    return prismaErrorResponse(error, { duplicate: "A location with this name already exists." })
      ?? NextResponse.json({ message: "Unable to update the location." }, { status: 500 });
  }
}

// A location still used by projects, companies or role assignments cannot be deleted.
export async function DELETE(request: Request) {
  const auth = await requireApiPermission(request, "projects.manage");
  if (auth.response) return auth.response;

  const id = str((await readJsonBody(request))?.id);
  if (!id) return NextResponse.json({ message: "Location id is required." }, { status: 400 });

  const [projects, companies, assignments] = await Promise.all([
    prisma.project.count({ where: { locationId: id } }),
    prisma.company.count({ where: { locationId: id } }),
    prisma.userAssignment.count({ where: { locationId: id } }),
  ]);
  if (projects + companies + assignments > 0) {
    return NextResponse.json({ message: `This location is used by ${projects} project(s), ${companies} company(ies) and ${assignments} role assignment(s).` }, { status: 409 });
  }

  try {
    await prisma.location.delete({ where: { id } });
    return NextResponse.json({ message: "Location deleted." });
  } catch (error) {
    return prismaErrorResponse(error) ?? NextResponse.json({ message: "Unable to delete the location." }, { status: 500 });
  }
}
