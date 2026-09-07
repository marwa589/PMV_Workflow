import { mkdir, readFile, rm, writeFile } from 'fs/promises';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { NextResponse } from 'next/server';
import { DocumentStatus } from '@prisma/client';
import { PDFDocument } from 'pdf-lib';
import { getSession } from '@/lib/auth/session';
import { resolveStoredFilePath } from '@/lib/files';
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

  // Only APPROVED documents, with linked comparison data
  const documents = await prisma.document.findMany({
    where: { id: { in: ids }, status: DocumentStatus.APPROVED },
    select: {
      id: true,
      documentNumber: true,
      mrNumber: true,
      mrType: true,
      documentType: true,
      currentVersion: true,
      relatedComparisonId: true,
      relatedComparison: {
        select: {
          id: true,
          documentNumber: true,
          status: true,
          currentVersion: true,
        },
      },
    },
  });

  const orderedDocuments = documents.flatMap((document) => {
    const group = document.documentType === 'MATERIAL_REQUISITION'
      ? document.mrType === 'CREDIT' ? 'credit-mrs' : 'cash-mrs'
      : 'comparisons';

    return [{ document, group }];
  });

  const versionMap = new Map<string, { filePath: string; originalName: string }>();
  for (const { document } of orderedDocuments) {
    const version = await prisma.documentVersion.findUnique({
      where: { documentId_versionNumber: { documentId: document.id, versionNumber: document.currentVersion } },
      select: { filePath: true, originalName: true },
    });
    if (version) versionMap.set(document.id, version);
  }

  const groupedDocuments = new Map<string, typeof orderedDocuments>();
  for (const entry of orderedDocuments) {
    const group = groupedDocuments.get(entry.group) || [];
    group.push(entry);
    groupedDocuments.set(entry.group, group);
  }

  const mergedPdfs: Array<{ name: string; buffer: Buffer }> = [];
  for (const [groupName, group] of groupedDocuments) {
    const mergedPdf = await PDFDocument.create();
    for (const { document } of group) {
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
    await prisma.document.updateMany({
      where: { id: { in: includedDocumentIds }, status: DocumentStatus.APPROVED },
      data: { downloadedAt: new Date() },
    });
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
