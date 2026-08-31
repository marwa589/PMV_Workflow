import { readFile } from "fs/promises";
import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { canAccessDocument } from "@/lib/auth/resource-access";
import { resolveStoredFilePath } from "@/lib/files";
import { downloadFileFromGraph } from "@/lib/graph-upload";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  const { id: documentId } = await params;

  const canAccess = await canAccessDocument(session, documentId);
  if (!canAccess) {
    return NextResponse.json({ message: "Forbidden" }, { status: 403 });
  }

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
      driveId: true,
      itemId: true,
    },
  });

  if (!version) {
    return NextResponse.json({ message: "Document version not found." }, { status: 404 });
  }

  const contentType = version.mimeType || "application/octet-stream";
  const disposition = `${new URL(request.url).searchParams.get("inline") === "1" ? "inline" : "attachment"}; filename="${version.originalName}"`;

  try {
    if (version.driveId && version.itemId) {
      const graphBuffer = await downloadFileFromGraph(version.driveId, version.itemId);
      return new NextResponse(Uint8Array.from(graphBuffer), {
        status: 200,
        headers: {
          "Content-Type": contentType,
          "Content-Disposition": disposition,
        },
      });
    }

    const absolutePath = resolveStoredFilePath(version.filePath);
    const buffer = await readFile(absolutePath);

    return new NextResponse(Uint8Array.from(buffer), {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Content-Disposition": disposition,
      },
    });
  } catch (error) {
    try {
      const absolutePath = resolveStoredFilePath(version.filePath);
      const buffer = await readFile(absolutePath);

      return new NextResponse(Uint8Array.from(buffer), {
        status: 200,
        headers: {
          "Content-Type": contentType,
          "Content-Disposition": disposition,
        },
      });
    } catch {
      console.error("Document download failed for Graph and local fallback", {
        documentId,
        versionNumber: document.currentVersion,
        driveId: version.driveId,
        itemId: version.itemId,
        filePath: version.filePath,
        error: error instanceof Error ? error.message : String(error),
      });
      return NextResponse.json({ message: "File not found on server or in Graph." }, { status: 404 });
    }
  }
}
