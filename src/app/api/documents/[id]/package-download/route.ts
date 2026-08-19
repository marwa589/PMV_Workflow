import { createWriteStream } from "fs";
import { mkdir, readFile, rm, writeFile } from "fs/promises";
import path from "path";
import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { canAccessPackage } from "@/lib/auth/resource-access";
import { resolveStoredFilePath } from "@/lib/files";
import { prisma } from "@/lib/prisma";
import { createHash } from "crypto";
import { pipeline } from "stream/promises";
import { promisify } from "util";
import { gunzip, gzip } from "zlib";

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

  const canAccess = await canAccessPackage(session, documentId);
  if (!canAccess) {
    return NextResponse.json({ message: "Forbidden" }, { status: 403 });
  }

  const document = await prisma.document.findUnique({
    where: { id: documentId },
    select: {
      id: true,
      documentNumber: true,
      relatedComparison: {
        select: {
          id: true,
          documentNumber: true,
          title: true,
          currentVersion: true,
          versions: { select: { versionNumber: true, filePath: true, mimeType: true } },
        },
      },
      currentVersion: true,
      versions: { orderBy: { versionNumber: "asc" }, select: { id: true, versionNumber: true, filePath: true, originalName: true, mimeType: true } },
    },
  });

  if (!document) {
    return NextResponse.json({ message: "Document not found." }, { status: 404 });
  }

  const filesToPackage = [
    {
      fileName: `${document.documentNumber || "MR"}.pdf`,
      sourcePath: resolveStoredFilePath(document.versions.find((version) => version.versionNumber === document.currentVersion)?.filePath || ""),
      mimeType: document.versions.find((version) => version.versionNumber === document.currentVersion)?.mimeType || "application/pdf",
    },
  ];

  if (document.relatedComparison) {
    const comparisonVersion = document.relatedComparison.versions.find(
      (version) => version.versionNumber === document.relatedComparison?.currentVersion,
    );
    filesToPackage.push({
      fileName: `${document.relatedComparison.documentNumber || "Comparison"}.pdf`,
      sourcePath: comparisonVersion ? resolveStoredFilePath(comparisonVersion.filePath) : "",
      mimeType: comparisonVersion?.mimeType || "application/pdf",
    });
  }

  const tempDir = path.join(process.cwd(), "tmp", `pkg-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  await mkdir(tempDir, { recursive: true });

  try {
    const zipName = `${document.documentNumber}.zip`;
    const zipPath = path.join(tempDir, zipName);
    const zipEntries = [] as string[];

    for (const file of filesToPackage) {
      if (!file.sourcePath) {
        continue;
      }
      const buffer = await readFile(file.sourcePath);
      const targetPath = path.join(tempDir, file.fileName);
      await writeFile(targetPath, buffer);
      zipEntries.push(file.fileName);
    }

    const zipBuffer = Buffer.from([]);
    const response = new NextResponse(zipBuffer, {
      status: 200,
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${zipName}"`,
      },
    });

    return response;
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}
