import { EmailEventType, DocumentStatus, UserRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { sendEmail } from "@/lib/mail";

const BATCH_WINDOW_MS = 10 * 60 * 1000;
const REMINDER_INTERVAL_MS = 24 * 60 * 60 * 1000;
const CLAIM_TIMEOUT_MS = 15 * 60 * 1000;

const PENDING_STATUSES = [
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

  const emailDueAt = new Date(Date.now() + BATCH_WINDOW_MS);
  await prisma.emailNotificationEvent.createMany({
    data: events.map((event) => ({
      recipientId: event.recipientId,
      type: event.type,
      documentId: event.documentId ?? null,
      emailDueAt,
      emailSent: false,
    })),
  });

  return events.length;
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
  }
}

function renderSummary(counts: Record<string, number>) {
  const lines = [
    counts.approved ? `<p>Approved documents: ${counts.approved}</p>` : "",
    counts.rejected ? `<p>Rejected documents: ${counts.rejected}</p>` : "",
    counts.pending ? `<p>Pending documents: ${counts.pending}</p>` : "",
    counts.overdue ? `<p>Documents pending for more than 24 hours: ${counts.overdue}</p>` : "",
    counts.comparisonOverdue ? `<p>Approved Comparisons awaiting MR upload for more than 24 hours: ${counts.comparisonOverdue}</p>` : "",
  ].join("");

  return `
    <div style="font-family: Arial, sans-serif; line-height: 1.6;">
      <p>You have workflow updates requiring your attention.</p>
      ${lines}
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
  const approvedDocumentIds = new Set(
    (
      await prisma.document.findMany({
        where: {
          id: { in: reminderEvents.flatMap((event) => event.documentId ? [event.documentId] : []) },
          status: DocumentStatus.APPROVED,
        },
        select: { id: true },
      })
    ).map((document) => document.id),
  );
  const staleReminderIds = reminderEvents
    .filter((event) => event.documentId && approvedDocumentIds.has(event.documentId))
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
      await sendEmail({
        to: recipientEmail,
        subject: "Workflow notification summary",
        html: renderSummary(counts),
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
