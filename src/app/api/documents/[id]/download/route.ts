import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { DocumentStatus } from "@prisma/client";
import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { canAccessDocument } from "@/lib/auth/access";
import { resolveStoredFilePath } from "@/lib/files";
import { recordDownloads } from "@/lib/download-tracking";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();

  if (!session) {
    return NextResponse.json(
      { message: "Unauthorized" },
      { status: 401 },
    );
  }

  const { id: documentId } = await params;
  const searchParams = new URL(request.url).searchParams;
  const inline = searchParams.get("inline") === "1";

  const canAccess = await canAccessDocument(
    session,
    documentId,
    inline ? "documents.view" : "documents.download",
  );

  if (!canAccess) {
    return NextResponse.json(
      { message: "Forbidden" },
      { status: 403 },
    );
  }

  const document = await prisma.document.findUnique({
    where: { id: documentId },
    select: {
      id: true,
      currentVersion: true,
      status: true,
    },
  });

  if (!document) {
    return NextResponse.json(
      { message: "Document not found." },
      { status: 404 },
    );
  }

  const versionParam = searchParams.get("version");

  const targetVersionNumber =
    versionParam !== null && !Number.isNaN(Number(versionParam))
      ? Number(versionParam)
      : document.currentVersion;

  const version = await prisma.documentVersion.findUnique({
    where: {
      documentId_versionNumber: {
        documentId,
        versionNumber: targetVersionNumber,
      },
    },
    select: {
      filePath: true,
      originalName: true,
      mimeType: true,
    },
  });

  if (!version) {
    return NextResponse.json(
      { message: "Document version not found." },
      { status: 404 },
    );
  }

  try {
    const buffer = await readFile(
      resolveStoredFilePath(version.filePath),
    );

    // Support Arabic and other non-ASCII characters in filenames.
    const safeFilename = basename(version.originalName).replace(
      /[\r\n"]/g,
      "_",
    );
    const encodedFilename = encodeURIComponent(safeFilename);

    // Counts as "downloaded" for this user only when an approved document is actually saved (not when it is just previewed inline).
    if (document.status === DocumentStatus.APPROVED && !inline) {
      try {
        await recordDownloads(session.userId, [documentId]);
      } catch (error) {
        console.error("[document-download] Failed to record download", { documentId, error });
      }
    }

    return new NextResponse(buffer, {
      status: 200,
      headers: {
        "Content-Type": version.mimeType || "application/octet-stream",
        "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="document.pdf"; filename*=UTF-8''${encodeURIComponent(version.originalName)}`,
        "Content-Length": String(buffer.byteLength),
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    console.error("[document-download] Failed to read stored file", {
      documentId,
      filePath: version.filePath,
      error,
    });

    return NextResponse.json(
      { message: "Unable to read the stored document file." },
      { status: 500 },
    );
  }
}
