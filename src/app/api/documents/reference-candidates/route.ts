// src/app/api/documents/reference-candidates/route.ts
import { DocumentStatus } from "@prisma/client";
import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { buildDocumentVisibilityWhere } from "@/lib/auth/access";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

/**
 * Approved documents a step's uploader may pick as the step's reference document instead of uploading a new file.
 * Only documents the person can already see; documents that are themselves reference documents are never offered.
 */
export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const documentTypeId = searchParams.get("documentTypeId")?.trim() || "";
  const documentSubtypeId = searchParams.get("documentSubtypeId")?.trim() || "";
  const projectId = searchParams.get("projectId")?.trim() || "";
  const search = searchParams.get("search")?.trim() || "";
  if (!documentTypeId) return NextResponse.json({ message: "documentTypeId is required." }, { status: 400 });

  const visibility = await buildDocumentVisibilityWhere(session);
  const documents = await prisma.document.findMany({
    where: {
      AND: [
        visibility,
        {
          isReference: false,
          status: DocumentStatus.APPROVED,
          documentTypeId,
          ...(documentSubtypeId ? { documentSubtypeId } : {}),
          ...(projectId ? { projectId } : {}),
          ...(search
            ? { OR: [{ documentNumber: { contains: search, mode: "insensitive" as const } }, { title: { contains: search, mode: "insensitive" as const } }] }
            : {}),
        },
      ],
    },
    orderBy: { createdAt: "desc" },
    take: 50,
    select: { id: true, documentNumber: true, title: true, project: { select: { code: true } } },
  });

  return NextResponse.json({
    documents: documents.map((document) => ({
      id: document.id,
      documentNumber: document.documentNumber,
      title: document.title,
      projectCode: document.project?.code ?? null,
    })),
  });
}
