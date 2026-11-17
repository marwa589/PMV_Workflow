import "server-only";

import { prisma } from "@/lib/prisma";
import type { DocumentRow } from "@/lib/document-queries";

/** When this user last downloaded each of the given documents (documents never downloaded by them are absent). */
export async function getDownloadedAtMap(userId: string, documentIds: string[]): Promise<Map<string, Date>> {
  if (documentIds.length === 0) return new Map();
  const records = await prisma.documentDownload.findMany({
    where: { userId, documentId: { in: documentIds } },
    select: { documentId: true, downloadedAt: true },
  });
  return new Map(records.map((record) => [record.documentId, record.downloadedAt]));
}

/**
 * Sets `downloadedAt` on every row to this user's own download time (null when they never downloaded it),
 * so "Downloaded / Not Downloaded", its timestamp and the download filter are all per user.
 */
export async function withDownloadTracking(rows: DocumentRow[], userId: string): Promise<DocumentRow[]> {
  const downloaded = await getDownloadedAtMap(userId, rows.map((row) => row.id));
  return rows.map((row) => ({ ...row, downloadedAt: downloaded.get(row.id) ?? null }));
}

/** Marks documents as downloaded by this user now (first time creates the record, later times refresh the timestamp). */
export async function recordDownloads(userId: string, documentIds: string[]): Promise<void> {
  if (documentIds.length === 0) return;
  const now = new Date();
  await prisma.$transaction([
    prisma.documentDownload.createMany({
      data: documentIds.map((documentId) => ({ documentId, userId, downloadedAt: now })),
      skipDuplicates: true,
    }),
    prisma.documentDownload.updateMany({
      where: { userId, documentId: { in: documentIds } },
      data: { downloadedAt: now },
    }),
  ]);
}
