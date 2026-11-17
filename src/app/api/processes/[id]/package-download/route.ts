// src/app/api/processes/[id]/package-download/route.ts
import { readFile } from "fs/promises";
import { DocumentStatus } from "@prisma/client";
import { NextResponse } from "next/server";
import { PDFDocument } from "pdf-lib";
import { getSession } from "@/lib/auth/session";
import { buildDocumentVisibilityWhere, buildProcessVisibilityWhere } from "@/lib/auth/access";
import { resolveStoredFilePath } from "@/lib/files";
import { recordDownloads } from "@/lib/download-tracking";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

// One PDF with the approved document of every step of a run, in step order (the "package").
// Only documents the person is allowed to download are included.
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const visibility = await buildProcessVisibilityWhere(session);
  const run = await prisma.processInstance.findFirst({
    where: { AND: [{ id }, visibility] },
    select: { id: true, reference: true, processDefinition: { select: { name: true } } },
  });
  if (!run) return NextResponse.json({ message: "Process run not found." }, { status: 404 });

  const downloadable = await buildDocumentVisibilityWhere(session, prisma, "documents.download");
  const links = await prisma.processStepDocument.findMany({
    where: { processInstanceId: id, isCurrent: true, document: { AND: [{ status: DocumentStatus.APPROVED }, downloadable] } },
    orderBy: { processStep: { stepNumber: "asc" } },
    select: { document: { select: { id: true, currentVersion: true } } },
  });

  const merged = await PDFDocument.create();
  const includedIds: string[] = [];
  for (const { document } of links) {
    const version = await prisma.documentVersion.findUnique({
      where: { documentId_versionNumber: { documentId: document.id, versionNumber: document.currentVersion } },
      select: { filePath: true, originalName: true },
    });
    if (!version) continue;
    if (!version.originalName.toLowerCase().endsWith(".pdf")) {
      return NextResponse.json({ message: `The package supports PDF files only: ${version.originalName}` }, { status: 400 });
    }
    const source = await PDFDocument.load(await readFile(resolveStoredFilePath(version.filePath)));
    (await merged.copyPages(source, source.getPageIndices())).forEach((page) => merged.addPage(page));
    includedIds.push(document.id);
  }

  if (merged.getPageCount() === 0) {
    return NextResponse.json({ message: "No approved documents are available to download for this run." }, { status: 404 });
  }

  // Every included document is approved (see the query above); mark them downloaded for this user.
  await recordDownloads(session.userId, includedIds);

  const safeName = `${run.processDefinition.name}${run.reference ? `-${run.reference}` : ""}`.replace(/[^A-Za-z0-9._-]+/g, "_");
  return new NextResponse(new Uint8Array(await merged.save()), {
    status: 200,
    headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${safeName}.pdf"` },
  });
}
