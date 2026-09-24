import { EmailEventType, DocumentStatus, UserRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { sendEmail } from "@/lib/mail";
import { appConfig } from "@/lib/env";
import { getPurchaseOrderRecipientIds } from "@/lib/po-access";

const EMAIL_DELAY_MS = 10 * 60 * 1000;
const REMINDER_INTERVAL_MS = 24 * 60 * 60 * 1000;
const CLAIM_TIMEOUT_MS = 15 * 60 * 1000;

async function alignRecipientEmailDueAt(recipientId: string, desiredDueAt: Date) {
  const now = new Date();
  const batchWindowEnd = new Date(now.getTime() + EMAIL_DELAY_MS);
  const pendingEvents = await prisma.emailNotificationEvent.findMany({
    where: {
      recipientId,
      emailSent: false,
      claimedAt: null,
      emailDueAt: { gte: now, lte: batchWindowEnd },
    },
    select: { id: true, emailDueAt: true },
  });

  if (pendingEvents.length === 0) return desiredDueAt;

  const earliestDueAt = new Date(Math.min(
    desiredDueAt.getTime(),
    ...pendingEvents.map((event) => event.emailDueAt.getTime()),
  ));

  if (pendingEvents.some((event) => event.emailDueAt.getTime() !== earliestDueAt.getTime())) {
    await prisma.emailNotificationEvent.updateMany({
      where: {
        id: { in: pendingEvents.map((event) => event.id) },
        emailSent: false,
        claimedAt: null,
      },
      data: { emailDueAt: earliestDueAt },
    });
  }

  return earliestDueAt;
}

const PENDING_STATUSES: DocumentStatus[] = [
  DocumentStatus.PENDING_APPROVER_1,
  DocumentStatus.PENDING_APPROVER_2,
  DocumentStatus.PENDING_APPROVER_3,
  DocumentStatus.REVISION_REQUIRED,
];

export async function queueWorkflowEmailEvents(events: Array<{
  recipientId: string;
  type: EmailEventType;
  documentId?: string | null;
}>) {
  if (events.length === 0) return 0;

  const dedupedEvents = Array.from(
    new Map(
      events.map((event) => [
        `${event.recipientId}:${event.type}:${event.documentId ?? ""}`,
        event,
      ]),
    ).values(),
  );

  if (dedupedEvents.length === 0) return 0;

  const createdAt = new Date();
  const emailDueAt = new Date(createdAt.getTime() + EMAIL_DELAY_MS);
  const recipientDueAtMap = new Map<string, Date>();

  for (const event of dedupedEvents) {
    const dueAt = recipientDueAtMap.get(event.recipientId) ?? emailDueAt;
    recipientDueAtMap.set(event.recipientId, await alignRecipientEmailDueAt(event.recipientId, dueAt));
  }

  await prisma.emailNotificationEvent.createMany({
    data: dedupedEvents.map((event) => ({
      recipientId: event.recipientId,
      type: event.type,
      documentId: event.documentId ?? null,
      createdAt,
      emailDueAt: recipientDueAtMap.get(event.recipientId) ?? emailDueAt,
      emailSent: false,
    })),
    skipDuplicates: true,
  });

  return dedupedEvents.length;
}

export async function queuePurchaseOrderAvailableEvents(purchaseOrderIds: string[]) {
  const events: Array<{ recipientId: string; type: EmailEventType; documentId: string }> = [];
  for (const purchaseOrderId of [...new Set(purchaseOrderIds)]) {
    const recipientIds = await getPurchaseOrderRecipientIds(purchaseOrderId);
    for (const recipientId of recipientIds) {
      const existing = await prisma.emailNotificationEvent.findFirst({
        where: {
          recipientId,
          documentId: purchaseOrderId,
          type: EmailEventType.PURCHASE_ORDER_AVAILABLE,
        },
        select: { id: true },
      });
      if (!existing) {
        events.push({ recipientId, type: EmailEventType.PURCHASE_ORDER_AVAILABLE, documentId: purchaseOrderId });
      }
    }
  }
  if (events.length === 0) return 0;
  const createdAt = new Date();
  const emailDueAt = new Date(createdAt.getTime() + EMAIL_DELAY_MS);
  const recipientDueAtMap = new Map<string, Date>();

  for (const event of events) {
    const dueAt = recipientDueAtMap.get(event.recipientId) ?? emailDueAt;
    recipientDueAtMap.set(event.recipientId, await alignRecipientEmailDueAt(event.recipientId, dueAt));
  }

  const result = await prisma.emailNotificationEvent.createMany({
    data: events.map((event) => ({
      recipientId: event.recipientId,
      type: event.type,
      documentId: event.documentId,
      createdAt,
      emailDueAt: recipientDueAtMap.get(event.recipientId) ?? emailDueAt,
      emailSent: false,
    })),
    skipDuplicates: true,
  });
  return result.count;
}

export async function queuePendingApprovalReminders() {
  const now = Date.now();
  const reminderCutoff = new Date(now - REMINDER_INTERVAL_MS);
  const pendingDocuments = await prisma.document.findMany({
    where: {
      status: { in: PENDING_STATUSES },
      currentApproverId: { not: null },
      currentApproverAssignedAt: { lte: reminderCutoff },
    },
    select: { id: true, currentApproverId: true },
  });

  const events: Array<{ recipientId: string; type: EmailEventType; documentId: string }> = [];
  for (const document of pendingDocuments) {
    if (!document.currentApproverId) continue;

    const existingReminder = await prisma.emailNotificationEvent.findFirst({
      where: {
        recipientId: document.currentApproverId,
        documentId: document.id,
        type: EmailEventType.APPROVAL_OVERDUE,
        createdAt: { gte: reminderCutoff },
      },
      select: { id: true },
    });

    if (!existingReminder) {
      events.push({
        recipientId: document.currentApproverId,
        type: EmailEventType.APPROVAL_OVERDUE,
        documentId: document.id,
      });
    }
  }

  return queueWorkflowEmailEvents(events);
}

export async function queueComparisonMrReminders() {
  const admins = await prisma.user.findMany({
    where: { role: UserRole.ADMIN },
    select: { id: true },
  });
  if (admins.length === 0) return 0;

  const cutoff = new Date(Date.now() - REMINDER_INTERVAL_MS);
  const comparisons = await prisma.document.findMany({
    where: {
      documentType: "COMPARISON",
      status: DocumentStatus.APPROVED,
      linkedMRs: { none: {} },
      approvals: {
        some: {
          action: "APPROVED",
          performedAt: { lte: cutoff },
        },
      },
    },
    select: { id: true },
  });

  const events: Array<{ recipientId: string; type: EmailEventType; documentId: string }> = [];
  for (const admin of admins) {
    for (const comparison of comparisons) {
      const existingReminder = await prisma.emailNotificationEvent.findFirst({
        where: {
          recipientId: admin.id,
          documentId: comparison.id,
          type: EmailEventType.COMPARISON_MR_OVERDUE,
        },
        select: { id: true },
      });

      if (!existingReminder) {
        events.push({
          recipientId: admin.id,
          type: EmailEventType.COMPARISON_MR_OVERDUE,
          documentId: comparison.id,
        });
      }
    }
  }

  return queueWorkflowEmailEvents(events);
}

function summaryForType(type: EmailEventType) {
  switch (type) {
    case EmailEventType.APPROVAL_PENDING:
      return "pending";
    case EmailEventType.APPROVAL_OVERDUE:
      return "overdue";
    case EmailEventType.WORKFLOW_APPROVED:
      return "approved";
    case EmailEventType.WORKFLOW_REJECTED:
      return "rejected";
    case EmailEventType.COMPARISON_MR_OVERDUE:
      return "comparisonOverdue";
    case EmailEventType.PURCHASE_ORDER_AVAILABLE:
      return "purchaseOrderAvailable";
  }
}

function renderSummary(
  counts: Record<string, number>,
  updates: Array<{ documentNumber: string; title: string; comments: string | null }>,
) {
  const appUrl = appConfig.appUrl();
  const lines = [
    counts.approved ? `<p>Approved documents: ${counts.approved}</p>` : "",
    counts.rejected ? `<p>Rejected documents: ${counts.rejected}</p>` : "",
    counts.pending ? `<p>Pending documents: ${counts.pending}</p>` : "",
    counts.overdue ? `<p>Documents pending for more than 24 hours: ${counts.overdue}</p>` : "",
    counts.comparisonOverdue ? `<p>Approved Comparisons awaiting MR upload for more than 24 hours: ${counts.comparisonOverdue}</p>` : "",
    counts.purchaseOrderAvailable ? `<p>New purchase orders are available for your related MRs.</p>` : "",
  ].join("");

  const updateDetails = updates
    .filter((update) => update.comments)
    .map((update) => `<p><strong>${update.documentNumber} - ${update.title}</strong><br />Comments: ${update.comments!.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\n/g, "<br />")}</p>`)
    .join("");

  return `
    <div style="font-family: Arial, sans-serif; line-height: 1.6;">
      <p>You have workflow updates requiring your attention.</p>
      ${lines}
      ${updateDetails ? `<h3>Comments</h3>${updateDetails}` : ""}
      <p>Application URL: <a href="${appUrl}">${appUrl}</a></p>
      <p>Please log in to review them.</p>
    </div>
  `;
}

export async function flushWorkflowEmailBatches() {
  const now = new Date();
  const claimCutoff = new Date(now.getTime() - CLAIM_TIMEOUT_MS);
  const pendingEvents = await prisma.emailNotificationEvent.findMany({
    where: {
      emailDueAt: { lte: now },
      emailSent: false,
      OR: [{ claimedAt: null }, { claimedAt: { lt: claimCutoff } }],
    },
    include: { recipient: { select: { email: true } } },
    orderBy: { emailDueAt: "asc" },
    take: 500,
  });

  const reminderEvents = pendingEvents.filter(
    (event) => event.type === EmailEventType.APPROVAL_PENDING || event.type === EmailEventType.APPROVAL_OVERDUE,
  );
  const reminderDocuments = await prisma.document.findMany({
    where: {
      id: { in: reminderEvents.flatMap((event) => event.documentId ? [event.documentId] : []) },
    },
    select: { id: true, status: true, currentApproverId: true },
  });
  const reminderDocumentById = new Map(reminderDocuments.map((document) => [document.id, document]));
  const staleReminderIds = reminderEvents
    .filter((event) => {
      if (!event.documentId) return false;

      const document = reminderDocumentById.get(event.documentId);
      return !document
        || !PENDING_STATUSES.includes(document.status)
        || document.currentApproverId !== event.recipientId;
    })
    .map((event) => event.id);

  if (staleReminderIds.length > 0) {
    await prisma.emailNotificationEvent.updateMany({
      where: { id: { in: staleReminderIds }, emailSent: false },
      data: { emailSent: true, claimedAt: null },
    });
  }

  const events = pendingEvents.filter((event) => !staleReminderIds.includes(event.id));

  const groups = new Map<string, typeof events>();
  for (const event of events) {
    const group = groups.get(event.recipientId) || [];
    group.push(event);
    groups.set(event.recipientId, group);
  }

  let sentCount = 0;
  for (const [recipientId, group] of groups) {
    const claimedAt = new Date();
    const claimed = await prisma.emailNotificationEvent.updateMany({
      where: {
        id: { in: group.map((event) => event.id) },
        emailSent: false,
        OR: [{ claimedAt: null }, { claimedAt: { lt: claimCutoff } }],
      },
      data: { claimedAt },
    });

    if (claimed.count === 0) continue;

    const counts: Record<string, number> = {};
    for (const event of group) {
      const key = summaryForType(event.type);
      counts[key] = (counts[key] || 0) + 1;
    }

    const recipientEmail = group[0]?.recipient.email;
    if (!recipientEmail) {
      await prisma.emailNotificationEvent.updateMany({
        where: { id: { in: group.map((event) => event.id) } },
        data: { claimedAt: null },
      });
      continue;
    }

    try {
      const documentIds = group
        .map((event) => event.documentId)
        .filter((documentId): documentId is string => Boolean(documentId));
      const documentsWithComments = documentIds.length > 0
        ? await prisma.document.findMany({
            where: { id: { in: [...new Set(documentIds)] } },
            select: {
              documentNumber: true,
              title: true,
              approvals: {
                orderBy: { performedAt: "desc" },
                take: 1,
                select: { comments: true },
              },
            },
          })
        : [];

      await sendEmail({
        to: recipientEmail,
        subject: "Workflow notification summary",
        html: renderSummary(counts, documentsWithComments.map((document) => ({
          documentNumber: document.documentNumber,
          title: document.title,
          comments: document.approvals[0]?.comments ?? null,
        }))),
      });
      await prisma.emailNotificationEvent.updateMany({
        where: { id: { in: group.map((event) => event.id) }, claimedAt, emailSent: false },
        data: { emailSent: true, claimedAt: null },
      });
      sentCount += 1;
    } catch (error) {
      await prisma.emailNotificationEvent.updateMany({
        where: { id: { in: group.map((event) => event.id) }, claimedAt },
        data: { claimedAt: null },
      });
      console.error("Workflow email batch failed:", error);
    }
  }

  return sentCount;
}

