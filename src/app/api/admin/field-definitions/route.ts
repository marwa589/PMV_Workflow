// src/app/api/admin/field-definitions/route.ts
import { FieldDataType, FieldGroup } from "@prisma/client";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { optionalId, prismaErrorResponse, readJsonBody, requireApiPermission, str } from "@/lib/admin-api";

export const runtime = "nodejs";

const fieldSelect = {
  id: true,
  documentTypeId: true,
  documentSubtypeId: true,
  fieldGroup: true,
  fieldKey: true,
  label: true,
  dataType: true,
  isRequired: true,
  options: true,
  sortOrder: true,
  isActive: true,
} as const;

const CHOICE_TYPES: FieldDataType[] = [FieldDataType.SELECT, FieldDataType.MULTI_SELECT];

function parseOptions(dataType: FieldDataType, raw: unknown): { options: string[] | null; error?: string } {
  if (!CHOICE_TYPES.includes(dataType)) return { options: null };
  if (!Array.isArray(raw)) return { options: null, error: "Choices are required for a select field." };

  const options = raw.map((value) => String(value ?? "").trim()).filter(Boolean);
  if (options.length === 0) return { options: null, error: "Add at least one choice." };
  if (new Set(options).size !== options.length) return { options: null, error: "Choices must be different from each other." };
  return { options };
}

async function checkTarget(documentTypeId: string, documentSubtypeId: string | null, group: FieldGroup) {
  const type = await prisma.documentType.findUnique({ where: { id: documentTypeId }, select: { supportsLineItems: true } });
  if (!type) return "Selected document type does not exist.";
  if (group === FieldGroup.LINE_ITEM && !type.supportsLineItems) return "This document type does not take line items.";
  if (documentSubtypeId && !(await prisma.documentSubtype.findFirst({ where: { id: documentSubtypeId, documentTypeId }, select: { id: true } }))) {
    return "The sub type does not belong to the selected document type.";
  }
  return null;
}

// Custom fields a document type (or one sub type) collects. A new field needs no code change.
export async function GET(request: Request) {
  const auth = await requireApiPermission(request, "types.manage");
  if (auth.response) return auth.response;

  const documentTypeId = new URL(request.url).searchParams.get("documentTypeId")?.trim();
  const fields = await prisma.fieldDefinition.findMany({
    where: documentTypeId ? { documentTypeId } : {},
    select: fieldSelect,
    orderBy: [{ documentTypeId: "asc" }, { sortOrder: "asc" }, { label: "asc" }],
  });
  return NextResponse.json({ fields });
}

export async function POST(request: Request) {
  const auth = await requireApiPermission(request, "types.manage");
  if (auth.response) return auth.response;

  const body = await readJsonBody(request);
  const documentTypeId = str(body?.documentTypeId);
  const documentSubtypeId = optionalId(body?.documentSubtypeId);
  const fieldGroup = body?.fieldGroup === "LINE_ITEM" ? FieldGroup.LINE_ITEM : FieldGroup.HEADER;
  const fieldKey = str(body?.fieldKey);
  const label = str(body?.label);
  const dataType = Object.values(FieldDataType).find((value) => value === body?.dataType);

  if (!documentTypeId || !label || !dataType) return NextResponse.json({ message: "Document type, label and data type are required." }, { status: 400 });
  if (!/^[a-z][a-z0-9_]{0,49}$/.test(fieldKey)) {
    return NextResponse.json({ message: "The field key must start with a lowercase letter and use only lowercase letters, numbers and _." }, { status: 400 });
  }

  const targetProblem = await checkTarget(documentTypeId, documentSubtypeId, fieldGroup);
  if (targetProblem) return NextResponse.json({ message: targetProblem }, { status: 400 });
  const parsed = parseOptions(dataType, body?.options);
  if (parsed.error) return NextResponse.json({ message: parsed.error }, { status: 400 });

  try {
    const field = await prisma.fieldDefinition.create({
      data: {
        documentTypeId,
        documentSubtypeId,
        fieldGroup,
        fieldKey,
        label,
        dataType,
        isRequired: body?.isRequired === true,
        options: parsed.options ?? undefined,
        sortOrder: typeof body?.sortOrder === "number" ? Math.trunc(body.sortOrder) : 0,
        isActive: body?.isActive === undefined ? true : Boolean(body.isActive),
      },
      select: fieldSelect,
    });
    return NextResponse.json({ field }, { status: 201 });
  } catch (error) {
    return prismaErrorResponse(error, { duplicate: "A field with this key already exists for this type, sub type and group." })
      ?? NextResponse.json({ message: "Unable to create the field." }, { status: 500 });
  }
}

// Label, required, choices, order and active state can change at any time.
// Key, data type, group and target are fixed once documents hold values for the field.
export async function PATCH(request: Request) {
  const auth = await requireApiPermission(request, "types.manage");
  if (auth.response) return auth.response;

  const body = await readJsonBody(request);
  const id = str(body?.id);
  if (!id) return NextResponse.json({ message: "Field id is required." }, { status: 400 });

  const existing = await prisma.fieldDefinition.findUnique({ where: { id }, select: { ...fieldSelect, _count: { select: { values: true } } } });
  if (!existing) return NextResponse.json({ message: "Field not found." }, { status: 404 });

  const label = str(body?.label) || existing.label;
  const parsed = parseOptions(existing.dataType, body?.options === undefined ? existing.options : body.options);
  if (parsed.error) return NextResponse.json({ message: parsed.error }, { status: 400 });

  const structuralChange =
    (body?.fieldKey !== undefined && str(body.fieldKey) !== existing.fieldKey) ||
    (body?.dataType !== undefined && body.dataType !== existing.dataType) ||
    (body?.fieldGroup !== undefined && body.fieldGroup !== existing.fieldGroup);
  if (structuralChange) {
    return NextResponse.json({ message: "A field's key, data type and group cannot change. Create a new field instead." }, { status: 400 });
  }

  try {
    const field = await prisma.fieldDefinition.update({
      where: { id },
      data: {
        label,
        isRequired: typeof body?.isRequired === "boolean" ? body.isRequired : existing.isRequired,
        options: parsed.options ?? undefined,
        sortOrder: typeof body?.sortOrder === "number" ? Math.trunc(body.sortOrder) : existing.sortOrder,
        isActive: typeof body?.isActive === "boolean" ? body.isActive : existing.isActive,
      },
      select: fieldSelect,
    });
    return NextResponse.json({ field });
  } catch (error) {
    return prismaErrorResponse(error) ?? NextResponse.json({ message: "Unable to update the field." }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  const auth = await requireApiPermission(request, "types.manage");
  if (auth.response) return auth.response;

  const id = str((await readJsonBody(request))?.id);
  if (!id) return NextResponse.json({ message: "Field id is required." }, { status: 400 });

  try {
    await prisma.fieldDefinition.delete({ where: { id } });
    return NextResponse.json({ message: "Field deleted." });
  } catch (error) {
    return prismaErrorResponse(error, { reference: "Documents already hold values for this field. Deactivate it instead." })
      ?? NextResponse.json({ message: "Unable to delete the field." }, { status: 500 });
  }
}
