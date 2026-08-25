import { readFile } from 'fs/promises';
import { NextResponse } from 'next/server';
import { DocumentStatus } from '@prisma/client';
import { PDFDocument } from 'pdf-lib';
import { getSession } from '@/lib/auth/session';
import { resolveStoredFilePath } from '@/lib/files';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';

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

  const selectedIds = new Set(ids);
  const comparisonIdsIncluded = new Set<string>();
  const orderedDocuments = documents.flatMap((document) => {
    const selected = [document];
    if (
      document.documentType === 'MATERIAL_REQUISITION' &&
      document.relatedComparison?.status === DocumentStatus.APPROVED &&
      !comparisonIdsIncluded.has(document.relatedComparison.id)
    ) {
      comparisonIdsIncluded.add(document.relatedComparison.id);
      const comparison = documents.find((item) => item.id === document.relatedComparison?.id);
      if (comparison && selectedIds.has(comparison.id)) return selected;
      return [document, { ...document, id: document.relatedComparison.id, documentType: 'COMPARISON' as const, currentVersion: document.relatedComparison.currentVersion, relatedComparison: null }];
    }
    if (document.documentType === 'COMPARISON') comparisonIdsIncluded.add(document.id);
    return selected;
  });

  const versionMap = new Map<string, { filePath: string; originalName: string }>();
  for (const document of orderedDocuments) {
    const version = await prisma.documentVersion.findUnique({
      where: { documentId_versionNumber: { documentId: document.id, versionNumber: document.currentVersion } },
      select: { filePath: true, originalName: true },
    });
    if (version) versionMap.set(document.id, version);
  }

  const mergedPdf = await PDFDocument.create();
  for (const document of orderedDocuments) {
    const version = versionMap.get(document.id);
    if (!version) continue;
    if (!version.originalName.toLowerCase().endsWith('.pdf')) {
      return NextResponse.json({ message: `Bulk PDF download supports PDF files only: ${version.originalName}` }, { status: 400 });
    }
    const sourcePdf = await PDFDocument.load(await readFile(resolveStoredFilePath(version.filePath)));
    const pages = await mergedPdf.copyPages(sourcePdf, sourcePdf.getPageIndices());
    pages.forEach((page) => mergedPdf.addPage(page));
  }

  if (mergedPdf.getPageCount() === 0) {
    return NextResponse.json({ message: 'No PDF files found for the selected documents.' }, { status: 404 });
  }

  const buffer = Buffer.from(await mergedPdf.save());
  const includedDocumentIds = [...versionMap.keys()];
  await prisma.document.updateMany({
    where: { id: { in: includedDocumentIds }, status: DocumentStatus.APPROVED },
    data: { downloadedAt: new Date() },
  });
  const archiveName = `documents-${Date.now()}.pdf`;

  return new NextResponse(buffer, {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${archiveName}"`,
    },
  });
}
