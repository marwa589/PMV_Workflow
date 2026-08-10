import { UserRole } from "@prisma/client";
import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { deleteDocumentFiles } from "@/lib/files";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  if (session.role !== UserRole.ADMIN) {
    return NextResponse.json({ message: "Only admin can delete documents." }, { status: 403 });
  }

  let payload: { ids?: unknown };
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ message: "Invalid request body." }, { status: 400 });
  }

  const ids = Array.isArray(payload.ids)
    ? payload.ids.filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    : [];

  if (ids.length === 0) {
    return NextResponse.json({ message: "No documents selected." }, { status: 400 });
  }

  const deletedIds: string[] = [];

  for (const documentId of ids) {
    const document = await prisma.document.findUnique({
      where: { id: documentId },
      select: { id: true },
    });

    if (!document) {
      continue;
    }

    const versions = await prisma.documentVersion.findMany({
      where: { documentId: document.id },
      select: { filePath: true },
    });

    await prisma.$transaction(async (tx) => {
      await tx.approvalHistory.deleteMany({ where: { documentId: document.id } });
      await tx.documentVersion.deleteMany({ where: { documentId: document.id } });
      await tx.document.delete({ where: { id: document.id } });
    });

    await deleteDocumentFiles({ filePaths: versions.map((v) => v.filePath) });
    deletedIds.push(document.id);
  }

  return NextResponse.json(
    {
      message: `Deleted ${deletedIds.length} document(s).`,
      deletedCount: deletedIds.length,
    },
    { status: 200 },
  );
}
