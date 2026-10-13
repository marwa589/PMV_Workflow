// src/app/api/admin/document-types/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { prismaErrorResponse, readJsonBody, requireApiPermission, str } from "@/lib/admin-api";
import { validateNamingPattern } from "@/lib/workflow/numbering";

export const runtime = "nodejs";

const DEFAULT_PATTERN = "{TYPE}-{PROJECT}-{YYYY}-{SEQ:4}";

const typeSelect = {
  id: true,
  code: true,
  name: true,
  description: true,
  namingPattern: true,
  supportsLineItems: true,
  isActive: true,
  createdAt: true,
  subtypes: { select: { id: true, code: true, name: true, isActive: true }, orderBy: { name: "asc" } },
  _count: { select: { fieldDefinitions: true, documents: true } },
} as const;

function validCode(code: string): boolean {
  return /^[A-Za-z0-9_-]{1,20}$/.test(code);
}

// Document types: Comp Sheet, Material Req, Purchase Order, and anything added later.
export async function GET(request: Request) {
  const auth = await requireApiPermission(request, "types.manage");
  if (auth.response) return auth.response;

  const types = await prisma.documentType.findMany({ select: typeSelect, orderBy: { name: "asc" } });
  return NextResponse.json({ documentTypes: types });
}

export async function POST(request: Request) {
  const auth = await requireApiPermission(request, "types.manage");
  if (auth.response) return auth.response;

  const body = await readJsonBody(request);
  const code = str(body?.code).toUpperCase();
  const name = str(body?.name);
  const namingPattern = str(body?.namingPattern) || DEFAULT_PATTERN;

  if (!name || !validCode(code)) {
    return NextResponse.json({ message: "A name and a short code (letters, numbers, - or _, up to 20 characters) are required." }, { status: 400 });
  }
  const patternProblem = validateNamingPattern(namingPattern);
  if (patternProblem) return NextResponse.json({ message: patternProblem }, { status: 400 });

  try {
    const documentType = await prisma.documentType.create({
      data: {
        code,
        name,
        description: str(body?.description) || null,
        namingPattern,
        supportsLineItems: body?.supportsLineItems === true,
        isActive: body?.isActive === undefined ? true : Boolean(body.isActive),
      },
      select: typeSelect,
    });
    return NextResponse.json({ documentType }, { status: 201 });
  } catch (error) {
    return prismaErrorResponse(error, { duplicate: "A document type with this code or name already exists." })
      ?? NextResponse.json({ message: "Unable to create the document type." }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  const auth = await requireApiPermission(request, "types.manage");
  if (auth.response) return auth.response;

  const body = await readJsonBody(request);
  const id = str(body?.id);
  const code = str(body?.code).toUpperCase();
  const name = str(body?.name);
  const namingPattern = str(body?.namingPattern);

  if (!id || !name || !validCode(code)) {
    return NextResponse.json({ message: "Id, name and a valid short code are required." }, { status: 400 });
  }
  if (namingPattern) {
    const patternProblem = validateNamingPattern(namingPattern);
    if (patternProblem) return NextResponse.json({ message: patternProblem }, { status: 400 });
  }

  try {
    const documentType = await prisma.documentType.update({
      where: { id },
      data: {
        code,
        name,
        description: str(body?.description) || null,
        ...(namingPattern ? { namingPattern } : {}),
        ...(typeof body?.supportsLineItems === "boolean" ? { supportsLineItems: body.supportsLineItems } : {}),
        ...(typeof body?.isActive === "boolean" ? { isActive: body.isActive } : {}),
      },
      select: typeSelect,
    });
    return NextResponse.json({ documentType });
  } catch (error) {
    return prismaErrorResponse(error, { duplicate: "A document type with this code or name already exists." })
      ?? NextResponse.json({ message: "Unable to update the document type." }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  const auth = await requireApiPermission(request, "types.manage");
  if (auth.response) return auth.response;

  const id = str((await readJsonBody(request))?.id);
  if (!id) return NextResponse.json({ message: "Document type id is required." }, { status: 400 });

  try {
    await prisma.documentType.delete({ where: { id } });
    return NextResponse.json({ message: "Document type deleted." });
  } catch (error) {
    return prismaErrorResponse(error, { reference: "Documents or process steps use this type. Deactivate it instead." })
      ?? NextResponse.json({ message: "Unable to delete the document type." }, { status: 500 });
  }
}
