// src/app/api/admin/companies/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { deactivationConfirmationResponse, optionalId, prismaErrorResponse, readJsonBody, requireApiPermission, str } from "@/lib/admin-api";

export const runtime = "nodejs";

const companySelect = { id: true, name: true, locationId: true, isActive: true, createdAt: true, location: { select: { id: true, name: true } } } as const;

async function locationExists(locationId: string | null): Promise<boolean> {
  return !locationId || Boolean(await prisma.location.findUnique({ where: { id: locationId }, select: { id: true } }));
}

export async function GET(request: Request) {
  const auth = await requireApiPermission(request, "projects.manage");
  if (auth.response) return auth.response;

  const companies = await prisma.company.findMany({ select: companySelect, orderBy: { name: "asc" } });
  return NextResponse.json({ companies });
}

export async function POST(request: Request) {
  const auth = await requireApiPermission(request, "projects.manage");
  if (auth.response) return auth.response;

  const body = await readJsonBody(request);
  const name = str(body?.name);
  const locationId = optionalId(body?.locationId);
  if (!name) return NextResponse.json({ message: "Company name is required." }, { status: 400 });
  if (!(await locationExists(locationId))) return NextResponse.json({ message: "Selected location does not exist." }, { status: 400 });

  try {
    const company = await prisma.company.create({ data: { name, locationId, isActive: body?.isActive === undefined ? true : Boolean(body.isActive) }, select: companySelect });
    return NextResponse.json({ company }, { status: 201 });
  } catch (error) {
    return prismaErrorResponse(error) ?? NextResponse.json({ message: "Unable to create the company." }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  const auth = await requireApiPermission(request, "projects.manage");
  if (auth.response) return auth.response;

  const body = await readJsonBody(request);
  const id = str(body?.id);
  const name = str(body?.name);
  const locationId = optionalId(body?.locationId);
  if (!id || !name) return NextResponse.json({ message: "Company id and name are required." }, { status: 400 });
  if (!(await locationExists(locationId))) return NextResponse.json({ message: "Selected location does not exist." }, { status: 400 });

  try {
    if (body?.isActive === false) {
      const usage = await prisma.company.findUnique({
        where: { id },
        select: { isActive: true, _count: { select: { scopedAssignments: true } } },
      });
      if (usage?.isActive) {
        const confirmation = deactivationConfirmationResponse(body, "This company", [
          { label: "role assignment(s)", count: usage._count.scopedAssignments },
        ]);
        if (confirmation) return confirmation;
      }
    }

    const company = await prisma.company.update({
      where: { id },
      data: { name, locationId, ...(typeof body?.isActive === "boolean" ? { isActive: body.isActive } : {}) },
      select: companySelect,
    });
    return NextResponse.json({ company });
  } catch (error) {
    return prismaErrorResponse(error) ?? NextResponse.json({ message: "Unable to update the company." }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  const auth = await requireApiPermission(request, "projects.manage");
  if (auth.response) return auth.response;

  const id = str((await readJsonBody(request))?.id);
  if (!id) return NextResponse.json({ message: "Company id is required." }, { status: 400 });

  const assignments = await prisma.userAssignment.count({ where: { companyId: id } });
  if (assignments > 0) return NextResponse.json({ message: `This company is used by ${assignments} role assignment(s).` }, { status: 409 });

  try {
    await prisma.company.delete({ where: { id } });
    return NextResponse.json({ message: "Company deleted." });
  } catch (error) {
    return prismaErrorResponse(error) ?? NextResponse.json({ message: "Unable to delete the company." }, { status: 500 });
  }
}
