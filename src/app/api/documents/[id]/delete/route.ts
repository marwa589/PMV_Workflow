import { UserRole } from "@prisma/client";
import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { deleteDocumentFiles } from "@/lib/files";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  if (session.role !== UserRole.ADMIN) {
    return NextResponse.json({ message: "Only admin can delete documents." }, { status: 403 });
  }

  const { id: documentId } = await params;

  try {
    const document = await prisma.document.findUnique({
      where: { id: documentId },
      select: { id: true },
    });

    if (!document) {
      return NextResponse.json({ message: "Document not found." }, { status: 404 });
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

    return NextResponse.json({ message: "Document deleted." }, { status: 200 });
  } catch (error) {
    return NextResponse.json(
      {
        message: error instanceof Error ? error.message : "Unable to delete document.",
      },
      { status: 400 },
    );
  }
}
