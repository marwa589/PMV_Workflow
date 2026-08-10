import { readFile } from "fs/promises";
import path from "path";
import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  const { id: documentId } = await params;

  const document = await prisma.document.findUnique({
    where: { id: documentId },
    select: {
      id: true,
      currentVersion: true,
    },
  });

  if (!document) {
    return NextResponse.json({ message: "Document not found." }, { status: 404 });
  }

  const version = await prisma.documentVersion.findUnique({
    where: {
      documentId_versionNumber: {
        documentId,
        versionNumber: document.currentVersion,
      },
    },
    select: {
      filePath: true,
      originalName: true,
      mimeType: true,
    },
  });

  if (!version) {
    return NextResponse.json({ message: "Document version not found." }, { status: 404 });
  }

  try {
    const absolutePath = path.join(/* turbopackIgnore: true */ process.cwd(), version.filePath);
    const buffer = await readFile(absolutePath);

    return new NextResponse(buffer, {
      status: 200,
      headers: {
        "Content-Type": version.mimeType || "application/octet-stream",
        "Content-Disposition": `attachment; filename="${version.originalName}"`,
      },
    });
  } catch {
    return NextResponse.json({ message: "File not found on server." }, { status: 404 });
  }
}
