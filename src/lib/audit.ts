import { prisma } from "@/lib/prisma";
import { appConfig } from "@/lib/env";

export const AUDIT_LOG_RETENTION_DAYS = appConfig.auditRetentionDays();

export async function pruneAuditLogs() {
  const retentionDays = Number.isFinite(AUDIT_LOG_RETENTION_DAYS) && AUDIT_LOG_RETENTION_DAYS > 0
    ? AUDIT_LOG_RETENTION_DAYS
    : 90;

  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);

  return prisma.auditLog.deleteMany({
    where: {
      createdAt: {
        lt: cutoff,
      },
    },
  });
}

export async function writeAuditLog({
  documentId,
  performedById,
  action,
  details,
}: {
  documentId?: string | null;
  performedById: string;
  action: string;
  details?: string | null;
}) {
  const entry = await prisma.auditLog.create({
    data: {
      documentId: documentId ?? null,
      performedById,
      action,
      details: details ?? null,
    },
  });

  await pruneAuditLogs();
  return entry;
}
