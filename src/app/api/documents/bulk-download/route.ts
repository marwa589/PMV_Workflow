// src/app/api/documents/bulk-download/route.ts
import { mkdir, readFile, rm, writeFile } from 'fs/promises';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { NextResponse } from 'next/server';
import { DocumentStatus } from '@prisma/client';
import { PDFDocument } from 'pdf-lib';
import { getSession } from '@/lib/auth/session';
import { buildDocumentVisibilityWhere } from '@/lib/auth/access';
import { resolveStoredFilePath } from '@/lib/files';
import { recordDownloads } from '@/lib/download-tracking';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
const execFileAsync = promisify(execFile);

function quotePowerShellPath(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

export async function GET(request: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const ids = searchParams.getAll('ids');

  if (ids.length === 0) {
    return NextResponse.json({ message: 'No documents selected.' }, { status: 400 });
  }

  // Only approved documents the person is allowed to download.
  const visibility = await buildDocumentVisibilityWhere(session, prisma, 'documents.download');
  const documents = await prisma.document.findMany({
    where: { AND: [{ id: { in: ids }, status: DocumentStatus.APPROVED }, visibility] },
    select: {
      id: true,
      currentVersion: true,
      documentType: { select: { code: true } },
      documentSubtype: { select: { code: true } },
    },
  });

  if (documents.length === 0) {
    return NextResponse.json({ message: 'None of the selected documents can be downloaded.' }, { status: 403 });
  }

  // One merged PDF per document type (and sub type), named after them, e.g. MR-CREDIT.pdf.
  const versionMap = new Map<string, { filePath: string; originalName: string }>();
  const groupedDocuments = new Map<string, typeof documents>();
  for (const document of documents) {
    const version = await prisma.documentVersion.findUnique({
      where: { documentId_versionNumber: { documentId: document.id, versionNumber: document.currentVersion } },
      select: { filePath: true, originalName: true },
    });
    if (version) versionMap.set(document.id, version);

    const groupName = [document.documentType.code, document.documentSubtype?.code].filter(Boolean).join('-');
    const group = groupedDocuments.get(groupName) || [];
    group.push(document);
    groupedDocuments.set(groupName, group);
  }

  const mergedPdfs: Array<{ name: string; buffer: Buffer }> = [];
  for (const [groupName, group] of groupedDocuments) {
    const mergedPdf = await PDFDocument.create();
    for (const document of group) {
      const version = versionMap.get(document.id);
      if (!version) continue;
      if (!version.originalName.toLowerCase().endsWith('.pdf')) {
        return NextResponse.json({ message: `Bulk PDF download supports PDF files only: ${version.originalName}` }, { status: 400 });
      }
      const sourcePdf = await PDFDocument.load(await readFile(resolveStoredFilePath(version.filePath)));
      const pages = await mergedPdf.copyPages(sourcePdf, sourcePdf.getPageIndices());
      pages.forEach((page) => mergedPdf.addPage(page));
    }

    if (mergedPdf.getPageCount() > 0) {
      mergedPdfs.push({ name: `${groupName}.pdf`, buffer: Buffer.from(await mergedPdf.save()) });
    }
  }

  if (mergedPdfs.length === 0) {
    return NextResponse.json({ message: 'No PDF files found for the selected documents.' }, { status: 404 });
  }

  const includedDocumentIds = [...versionMap.keys()];
  const archiveName = `documents-${Date.now()}.zip`;
  const tempDir = path.join(process.cwd(), 'tmp', `bulk-${Date.now()}`);
  const archivePath = path.join(process.cwd(), 'tmp', archiveName);
  await mkdir(tempDir, { recursive: true });
  try {
    await Promise.all(mergedPdfs.map((pdf) => writeFile(path.join(tempDir, pdf.name), pdf.buffer)));
    await execFileAsync('powershell', [
      '-NoProfile',
      '-Command',
      `Compress-Archive -Path ${quotePowerShellPath(path.join(tempDir, '*'))} -DestinationPath ${quotePowerShellPath(archivePath)} -Force`,
    ]);
    const zipBuffer = await readFile(archivePath);
    // Every included document is approved (see the query above); mark them downloaded for this user.
    await recordDownloads(session.userId, includedDocumentIds);
    return new NextResponse(new Uint8Array(zipBuffer), {
      status: 200,
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${archiveName}"`,
      },
    });
  } finally {
    await rm(tempDir, { recursive: true, force: true });
    await rm(archivePath, { force: true });
  }
}
