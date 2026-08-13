import { prisma } from "@/lib/prisma";

export type NotificationKind = "PENDING_APPROVAL" | "DOCUMENT_APPROVED" | "DOCUMENT_REJECTED" | "DOCUMENT_REVISED" | "DOCUMENT_DELETED";

type NotificationRecord = {
  id: string;
  userId: string;
  type: string;
  title: string;
  message: string;
  documentId: string | null;
  isRead: boolean;
  createdAt: Date;
};

export async function createNotification(params: {
  userId: string;
  type: NotificationKind;
  title: string;
  message: string;
  documentId?: string | null;
}) {
  await prisma.$executeRaw`
    INSERT INTO "Notification" ("id", "userId", "type", "title", "message", "documentId", "isRead", "createdAt")
    VALUES (gen_random_uuid(), ${params.userId}, ${params.type}, ${params.title}, ${params.message}, ${params.documentId ?? null}, false, NOW())
  `;
}

export async function getNotificationsForUser(userId: string) {
  const rows = await prisma.$queryRaw<NotificationRecord[]>`
    SELECT "id", "userId", "type", "title", "message", "documentId", "isRead", "createdAt"
    FROM "Notification"
    WHERE "userId" = ${userId}
    ORDER BY "createdAt" DESC
    LIMIT 25
  `;

  return rows.map((row) => ({
    id: row.id,
    userId: row.userId,
    type: row.type,
    title: row.title,
    message: row.message,
    documentId: row.documentId,
    isRead: row.isRead,
    createdAt: row.createdAt.toISOString(),
  }));
}

export async function getUnreadNotificationCount(userId: string) {
  const rows = await prisma.$queryRaw<{ count: number }[]>`
    SELECT COUNT(*)::int AS count
    FROM "Notification"
    WHERE "userId" = ${userId} AND "isRead" = false
  `;

  return rows[0]?.count ?? 0;
}

export async function markNotificationsAsRead(userId: string) {
  await prisma.$executeRaw`
    UPDATE "Notification"
    SET "isRead" = true
    WHERE "userId" = ${userId} AND "isRead" = false
  `;
}
