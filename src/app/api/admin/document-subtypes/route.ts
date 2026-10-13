// src/app/api/admin/document-subtypes/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { prismaErrorResponse, readJsonBody, requireApiPermission, str } from "@/lib/admin-api";

export const runtime = "nodejs";

const subtypeSelect = { id: true, documentTypeId: true, code: true, name: true, isActive: true, createdAt: true } as const;

function validCode(code: string): boolean {
  return /^[A-Za-z0-9_-]{1,30}$/.test(code);
}

// Sub types of a type, e.g. Cash / Credit / Petty Cash / Advance Payment under Material Req.
export async function POST(request: Request) {
  const auth = await requireApiPermission(request, "types.manage");
  if (auth.response) return auth.response;

  const body = await readJsonBody(request);
  const documentTypeId = str(body?.documentTypeId);
  const code = str(body?.code).toUpperCase();
  const name = str(body?.name);

  if (!documentTypeId || !name || !validCode(code)) {
    return NextResponse.json({ message: "Document type, a name and a short code are required." }, { status: 400 });
  }

  try {
    const documentSubtype = await prisma.documentSubtype.create({
      data: { documentTypeId, code, name, isActive: body?.isActive === undefined ? true : Boolean(body.isActive) },
      select: subtypeSelect,
    });
    return NextResponse.json({ documentSubtype }, { status: 201 });
  } catch (error) {
    return prismaErrorResponse(error, { duplicate: "This document type already has a sub type with this code or name.", reference: "Selected document type does not exist." })
      ?? NextResponse.json({ message: "Unable to create the sub type." }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  const auth = await requireApiPermission(request, "types.manage");
  if (auth.response) return auth.response;

  const body = await readJsonBody(request);
  const id = str(body?.id);
  const code = str(body?.code).toUpperCase();
  const name = str(body?.name);
  if (!id || !name || !validCode(code)) return NextResponse.json({ message: "Id, name and a valid short code are required." }, { status: 400 });

  try {
    const documentSubtype = await prisma.documentSubtype.update({
      where: { id },
      data: { code, name, ...(typeof body?.isActive === "boolean" ? { isActive: body.isActive } : {}) },
      select: subtypeSelect,
    });
    return NextResponse.json({ documentSubtype });
  } catch (error) {
    return prismaErrorResponse(error, { duplicate: "This document type already has a sub type with this code or name." })
      ?? NextResponse.json({ message: "Unable to update the sub type." }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  const auth = await requireApiPermission(request, "types.manage");
  if (auth.response) return auth.response;

  const id = str((await readJsonBody(request))?.id);
  if (!id) return NextResponse.json({ message: "Sub type id is required." }, { status: 400 });

  try {
    await prisma.documentSubtype.delete({ where: { id } });
    return NextResponse.json({ message: "Sub type deleted." });
  } catch (error) {
    return prismaErrorResponse(error, { reference: "Documents or process steps use this sub type. Deactivate it instead." })
      ?? NextResponse.json({ message: "Unable to delete the sub type." }, { status: 500 });
  }
}
