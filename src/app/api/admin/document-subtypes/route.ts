// src/app/api/admin/document-subtypes/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { deactivationConfirmationResponse, prismaErrorResponse, readJsonBody, requireApiPermission, str } from "@/lib/admin-api";
import { renumberSubtypeDocuments } from "@/lib/workflow/numbering";

export const runtime = "nodejs";

const subtypeSelect = { id: true, documentTypeId: true, code: true, numberingCode: true, name: true, isActive: true, createdAt: true } as const;

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
  const numberingCode = str(body?.numberingCode).toUpperCase() || code;
  const name = str(body?.name);

  if (!documentTypeId || !name || !validCode(code) || !validCode(numberingCode)) {
    return NextResponse.json({ message: "Document type, a name and a short code are required." }, { status: 400 });
  }

  try {
    const documentSubtype = await prisma.documentSubtype.create({
      data: { documentTypeId, code, numberingCode, name, isActive: body?.isActive === undefined ? true : Boolean(body.isActive) },
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
  const requestedNumberingCode = body?.numberingCode === undefined ? null : str(body.numberingCode).toUpperCase();
  const name = str(body?.name);
  if (!id || !name || !validCode(code) || (requestedNumberingCode !== null && !validCode(requestedNumberingCode))) return NextResponse.json({ message: "Id, name and valid short codes are required." }, { status: 400 });

  try {
    if (body?.isActive === false) {
      const usage = await prisma.documentSubtype.findUnique({
        where: { id },
        select: { isActive: true, _count: { select: { documents: true, flowAssignments: true, processSteps: true, scopedAssignments: true, assignmentScopes: true, fieldDefinitions: true } } },
      });
      if (usage?.isActive) {
        const confirmation = deactivationConfirmationResponse(body, "This document sub type", [
          { label: "document(s)", count: usage._count.documents },
          { label: "flow assignment(s)", count: usage._count.flowAssignments },
          { label: "process step(s)", count: usage._count.processSteps },
          { label: "role assignment(s)", count: usage._count.scopedAssignments + usage._count.assignmentScopes },
          { label: "custom field(s)", count: usage._count.fieldDefinitions },
        ]);
        if (confirmation) return confirmation;
      }
    }

    const documentSubtype = await prisma.$transaction(async (tx) => {
      const previous = await tx.documentSubtype.findUniqueOrThrow({
        where: { id },
        select: { documentTypeId: true, code: true, numberingCode: true },
      });
      const numberingCode = requestedNumberingCode ?? (previous.numberingCode || previous.code);
      const updated = await tx.documentSubtype.update({
        where: { id },
        data: { code, numberingCode, name, ...(typeof body?.isActive === "boolean" ? { isActive: body.isActive } : {}) },
        select: subtypeSelect,
      });
      if (previous.numberingCode !== numberingCode) {
        await renumberSubtypeDocuments(tx, { documentTypeId: previous.documentTypeId, documentSubtypeId: id });
      }
      return updated;
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
