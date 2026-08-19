import { mkdir, writeFile, rm, readFile } from 'fs/promises';
import path from 'path';
import { NextResponse } from 'next/server';
import { DocumentStatus } from '@prisma/client';
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

  // Fetch the current-version file path for every document we might need
  const allDocIds = [
    ...documents.map((d) => d.id),
    ...documents.map((d) => d.relatedComparison?.id).filter(Boolean) as string[],
  ];
  const uniqueDocIds = [...new Set(allDocIds)];

  const versionMap = new Map<string, { filePath: string; originalName: string }>();
  for (const docId of uniqueDocIds) {
    // Find the document's currentVersion number first
    const docRecord = documents.find((d) => d.id === docId)
      ?? await prisma.document.findUnique({ where: { id: docId }, select: { currentVersion: true } });
    if (!docRecord) continue;
    const version = await prisma.documentVersion.findUnique({
      where: { documentId_versionNumber: { documentId: docId, versionNumber: docRecord.currentVersion } },
      select: { filePath: true, originalName: true },
    });
    if (version) versionMap.set(docId, version);
  }

  const tempDir = path.join(process.cwd(), 'tmp', `bulk-${Date.now()}`);
  await mkdir(tempDir, { recursive: true });

  // Track which comparison IDs are already placed inside a paired MR folder
  const pairedComparisonIds = new Set<string>();

  // --- Bucket 1: MRs with a linked approved comparison ---
  const pairedMRs = documents.filter(
    (d) => d.documentType === 'MATERIAL_REQUISITION' &&
      d.relatedComparison &&
      d.relatedComparison.status === DocumentStatus.APPROVED,
  );

  for (const mr of pairedMRs) {
    const comp = mr.relatedComparison!;
    pairedComparisonIds.add(comp.id);

    const mrLabel = mr.mrNumber ? `MR-${mr.mrNumber}` : mr.documentNumber;
    const pairFolder = path.join(tempDir, 'MRs+Comparisons', mrLabel.replace(/[\\/:*?"<>|]/g, '_'));
    await mkdir(pairFolder, { recursive: true });

    const mrVersion = versionMap.get(mr.id);
    if (mrVersion) {
      const safeFile = mrVersion.originalName.replace(/[\\/:*?"<>|]/g, '_');
      await writeFile(path.join(pairFolder, safeFile), await readFile(resolveStoredFilePath(mrVersion.filePath)));
    }

    const compVersion = versionMap.get(comp.id);
    if (compVersion) {
      const safeFile = compVersion.originalName.replace(/[\\/:*?"<>|]/g, '_');
      await writeFile(path.join(pairFolder, safeFile), await readFile(resolveStoredFilePath(compVersion.filePath)));
    }
  }

  // --- Bucket 2: MRs with no linked approved comparison ---
  const soloMRs = documents.filter(
    (d) => d.documentType === 'MATERIAL_REQUISITION' &&
      (!d.relatedComparison || d.relatedComparison.status !== DocumentStatus.APPROVED),
  );

  if (soloMRs.length > 0) {
    await mkdir(path.join(tempDir, 'MRs'), { recursive: true });
    for (const mr of soloMRs) {
      const version = versionMap.get(mr.id);
      if (!version) continue;
      const safeFile = version.originalName.replace(/[\\/:*?"<>|]/g, '_');
      await writeFile(path.join(tempDir, 'MRs', safeFile), await readFile(resolveStoredFilePath(version.filePath)));
    }
  }

  // --- Bucket 3: Comparisons not already in a pair ---
  const soloComparisons = documents.filter(
    (d) => d.documentType === 'COMPARISON' && !pairedComparisonIds.has(d.id),
  );

  if (soloComparisons.length > 0) {
    await mkdir(path.join(tempDir, 'Comparisons'), { recursive: true });
    for (const comp of soloComparisons) {
      const version = versionMap.get(comp.id);
      if (!version) continue;
      const safeFile = version.originalName.replace(/[\\/:*?"<>|]/g, '_');
      await writeFile(path.join(tempDir, 'Comparisons', safeFile), await readFile(resolveStoredFilePath(version.filePath)));
    }
  }

  const archiveName = `documents-${Date.now()}.zip`;
  const archivePath = path.join(process.cwd(), 'tmp', archiveName);

  const { execFile } = await import('child_process');
  const { promisify } = await import('util');
  const execFileAsync = promisify(execFile);

  try {
    await execFileAsync('powershell', [
      '-NoProfile', '-Command',
      `Compress-Archive -Path '${tempDir}\\*' -DestinationPath '${archivePath}' -Force`,
    ]);
  } catch {
    await execFileAsync('zip', ['-r', archivePath, '.'], { cwd: tempDir });
  }

  const buffer = await readFile(archivePath);
  await rm(tempDir, { recursive: true, force: true });
  await rm(archivePath, { force: true });

  return new NextResponse(buffer, {
    status: 200,
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${archiveName}"`,
    },
  });
}
