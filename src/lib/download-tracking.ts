import { ApprovalActionType } from "@prisma/client";
import { prisma } from "@/lib/prisma";

export type TrackingInfo = {
  downloadedAt: Date | null;
  approvalDate: Date | null;
};

const EMPTY: TrackingInfo = { downloadedAt: null, approvalDate: null };

export type TrackingMap = {
  get(id: string): TrackingInfo;
};

function buildMap(downloads: Array<{ id: string; at: Date }>, approvals: Array<{ id: string; at: Date }>): TrackingMap {
  const map = new Map<string, TrackingInfo>();
  for (const row of downloads) {
    map.set(row.id, { downloadedAt: row.at, approvalDate: null });
  }
  // Rows arrive ordered by performedAt desc, so the first one seen per id is the latest approval.
  const seenApproval = new Set<string>();
  for (const row of approvals) {
    if (seenApproval.has(row.id)) continue;
    seenApproval.add(row.id);
    const existing = map.get(row.id);
    map.set(row.id, { downloadedAt: existing?.downloadedAt ?? null, approvalDate: row.at });
  }
  return { get: (id) => map.get(id) ?? EMPTY };
}

/** Per-user download state + latest approval time for a set of documents (MR / comparison / custody). */
export async function getDocumentTracking(userId: string, documentIds: string[]): Promise<TrackingMap> {
  if (documentIds.length === 0) return buildMap([], []);
  const [downloads, approvals] = await Promise.all([
    prisma.documentDownload.findMany({
      where: { userId, documentId: { in: documentIds } },
      select: { documentId: true, downloadedAt: true },
    }),
    prisma.approvalHistory.findMany({
      where: { documentId: { in: documentIds }, action: ApprovalActionType.APPROVED },
      orderBy: { performedAt: "desc" },
      select: { documentId: true, performedAt: true },
    }),
  ]);
  return buildMap(
    downloads.map((row) => ({ id: row.documentId, at: row.downloadedAt })),
    approvals.map((row) => ({ id: row.documentId, at: row.performedAt })),
  );
}

/** Same as above for ERRs. */
export async function getErrTracking(userId: string, errIds: string[]): Promise<TrackingMap> {
  if (errIds.length === 0) return buildMap([], []);
  const [downloads, approvals] = await Promise.all([
    prisma.errDownload.findMany({
      where: { userId, errId: { in: errIds } },
      select: { errId: true, downloadedAt: true },
    }),
    prisma.errApprovalHistory.findMany({
      where: { errId: { in: errIds }, action: "APPROVED" },
      orderBy: { performedAt: "desc" },
      select: { errId: true, performedAt: true },
    }),
  ]);
  return buildMap(
    downloads.map((row) => ({ id: row.errId, at: row.downloadedAt })),
    approvals.map((row) => ({ id: row.errId, at: row.performedAt })),
  );
}

export type DownloadStatusValue = "DOWNLOADED" | "NOT_DOWNLOADED" | "";

export function matchesDownloadStatus(downloadedAt: Date | null | undefined, filter: DownloadStatusValue): boolean {
  if (!filter) return true;
  return filter === "DOWNLOADED" ? Boolean(downloadedAt) : !downloadedAt;
}

export function matchesApprovalRange(approvalDate: Date | null | undefined, from: string, to: string): boolean {
  const fromMs = from ? new Date(from).getTime() : null;
  const toMs = to ? new Date(to).getTime() : null;
  if (fromMs === null && toMs === null) return true;
  const time = approvalDate?.getTime();
  if (time === undefined) return false;
  return (fromMs === null || time >= fromMs) && (toMs === null || time <= toMs);
}
