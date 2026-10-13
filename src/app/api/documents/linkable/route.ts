// src/app/api/documents/linkable/route.ts
import { DocumentStatus } from "@prisma/client";
import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { buildDocumentVisibilityWhere } from "@/lib/auth/access";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

/**
 * Search existing documents that could fill a process step (replaces the old "pick an approved comparison").
 * GET ?documentTypeId=...&documentSubtypeId=...&search=...
 * Only documents the person can see, of the requested type (and sub type), that are pending or approved.
 */
export async function GET(request: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const documentTypeId = searchParams.get("documentTypeId")?.trim() || "";
  const documentSubtypeId = searchParams.get("documentSubtypeId")?.trim() || "";
  const search = searchParams.get("search")?.trim() || "";

  if (!documentTypeId) {
    return NextResponse.json({ message: "documentTypeId is required." }, { status: 400 });
  }

  const visibility = await buildDocumentVisibilityWhere(session);
  const documents = await prisma.document.findMany({
    where: {
      AND: [
        visibility,
        {
          documentTypeId,
          ...(documentSubtypeId ? { documentSubtypeId } : {}),
          status: { in: [DocumentStatus.PENDING, DocumentStatus.APPROVED] },
          ...(search
            ? {
                OR: [
                  { documentNumber: { contains: search, mode: "insensitive" } },
                  { title: { contains: search, mode: "insensitive" } },
                ],
              }
            : {}),
        },
      ],
    },
    select: { id: true, documentNumber: true, title: true, status: true, updatedAt: true },
    orderBy: { updatedAt: "desc" },
    take: 20,
  });

  return NextResponse.json({
    documents: documents.map((item) => ({
      id: item.id,
      documentNumber: item.documentNumber,
      title: item.title,
      status: item.status,
      updatedAt: new Intl.DateTimeFormat("en-US", { dateStyle: "medium" }).format(item.updatedAt),
    })),
  });
}
