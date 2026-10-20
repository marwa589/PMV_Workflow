import { EmailEventType, DocumentStatus, UserRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { sendEmail } from "@/lib/mail";
import { appConfig } from "@/lib/env";
import { getPurchaseOrderRecipientIds } from "@/lib/po-access";

const EMAIL_DELAY_MS = 20 * 60 * 1000;
const MR_COMPARISON_EMAIL_DELAY_MS = 20 * 60 * 1000;
const REMINDER_INTERVAL_MS = 24 * 60 * 60 * 1000;
const CLAIM_TIMEOUT_MS = 15 * 60 * 1000;
const SMTP_RATE_LIMIT_COOLDOWN_MS = 15 * 60 * 1000;
const EMAIL_TIME_ZONE = "Asia/Kuwait";

type ZonedParts = { year: number; month: number; day: number; hour: number; minute: number };

function isSmtpRateLimitError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const details = error as { responseCode?: unknown; response?: unknown };
  return details.responseCode === 421
    || (typeof details.response === "string" && /\b421\b/.test(details.response));
}

function getKuwaitParts(date: Date): ZonedParts {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: EMAIL_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day),
    hour: Number(values.hour),
    minute: Number(values.minute),
  };
}

function kuwaitLocalTimeToDate(parts: ZonedParts): Date {
  let timestamp = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const formatted = getKuwaitParts(new Date(timestamp));
    const formattedAsUtc = Date.UTC(formatted.year, formatted.month - 1, formatted.day, formatted.hour, formatted.minute);
    const desiredAsUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute);
    timestamp += desiredAsUtc - formattedAsUtc;
  }
  return new Date(timestamp);
}

export function isEmailQuietHours(date = new Date()): boolean {
  const { hour } = getKuwaitParts(date);
  return hour >= 18 || hour < 6;
}

export function nextEmailSendTime(date: Date): Date {
  const parts = getKuwaitParts(date);
  if (parts.hour >= 6 && parts.hour < 18) return date;

  const nextMorning = { ...parts, hour: 6, minute: 0 };
  if (parts.hour >= 18) {
    const nextDay = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + 1));
    nextMorning.year = nextDay.getUTCFullYear();
    nextMorning.month = nextDay.getUTCMonth() + 1;
    nextMorning.day = nextDay.getUTCDate();
  }
  return kuwaitLocalTimeToDate(nextMorning);
}

type EmailBatchCohort = "ERR" | "MR_COMPARISON" | "OTHER";

function getEmailBatchCohort(documentType?: string | null): EmailBatchCohort {
  return documentType === "MATERIAL_REQUISITION" || documentType === "COMPARISON"
    ? "MR_COMPARISON"
    : "OTHER";
}

function getEmailEventBatchCohort(type: EmailEventType, documentType?: string | null): EmailBatchCohort {
  return type === EmailEventType.PURCHASE_ORDER_AVAILABLE
    ? "MR_COMPARISON"
    : getEmailBatchCohort(documentType);
}

async function getDocumentTypes(documentIds: Array<string | null | undefined>) {
  const ids = [...new Set(documentIds.filter((id): id is string => Boolean(id)))];
  if (ids.length === 0) return new Map<string, string>();

  const documents = await prisma.document.findMany({
    where: { id: { in: ids } },
    select: { id: true, documentType: true },
  });
  return new Map(documents.map((document) => [document.id, document.documentType]));
}

async function alignRecipientEmailDueAt(
  recipientId: string,
  desiredDueAt: Date,
  cohort: EmailBatchCohort,
  batchWindowMs: number,
) {
  const now = new Date();
  const batchWindowEnd = new Date(now.getTime() + batchWindowMs);
  const pendingEvents = await prisma.emailNotificationEvent.findMany({
    where: {
      recipientId,
      emailSent: false,
      claimedAt: null,
      emailDueAt: { gte: now, lte: batchWindowEnd },
    },
    select: { id: true, emailDueAt: true, type: true, documentId: true },
  });

  const candidateDocumentTypes = await getDocumentTypes(pendingEvents.map((event) => event.documentId));
  const matchingEvents = pendingEvents.filter((event) => {
    if (event.type === EmailEventType.ERR_WORKFLOW_UPDATE) return cohort === "ERR";
    return getEmailEventBatchCohort(event.type,
      event.documentId ? candidateDocumentTypes.get(event.documentId) : undefined,
    ) === cohort;
  });

  if (matchingEvents.length === 0) return desiredDueAt;

  const earliestDueAt = new Date(Math.min(
    desiredDueAt.getTime(),
    ...matchingEvents.map((event) => event.emailDueAt.getTime()),
  ));

  if (matchingEvents.some((event) => event.emailDueAt.getTime() !== earliestDueAt.getTime())) {
    await prisma.emailNotificationEvent.updateMany({
      where: {
        id: { in: matchingEvents.map((event) => event.id) },
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
  const documentTypeById = await getDocumentTypes(dedupedEvents.map((event) => event.documentId));
  const dueAtByCohort = new Map<string, Date>();

  for (const event of dedupedEvents) {
    const cohort = event.type === EmailEventType.ERR_WORKFLOW_UPDATE
      ? "ERR"
      : getEmailEventBatchCohort(event.type, event.documentId ? documentTypeById.get(event.documentId) : undefined);
    const batchWindowMs = cohort === "OTHER" ? EMAIL_DELAY_MS : MR_COMPARISON_EMAIL_DELAY_MS;
    const key = `${event.recipientId}:${cohort}`;
    if (!dueAtByCohort.has(key)) {
      const desiredDueAt = nextEmailSendTime(new Date(createdAt.getTime() + batchWindowMs));
      dueAtByCohort.set(key, await alignRecipientEmailDueAt(
        event.recipientId,
        desiredDueAt,
        cohort,
        batchWindowMs,
      ));
    }
  }

  await prisma.emailNotificationEvent.createMany({
    data: dedupedEvents.map((event) => ({
      recipientId: event.recipientId,
      type: event.type,
      documentId: event.documentId ?? null,
      createdAt,
      emailDueAt: dueAtByCohort.get(`${event.recipientId}:${event.type === EmailEventType.ERR_WORKFLOW_UPDATE ? "ERR" : getEmailEventBatchCohort(event.type, event.documentId ? documentTypeById.get(event.documentId) : undefined)}`)!,
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
  const emailDueAt = nextEmailSendTime(new Date(createdAt.getTime() + MR_COMPARISON_EMAIL_DELAY_MS));
  const recipientDueAtMap = new Map<string, Date>();

  for (const event of events) {
    const dueAt = recipientDueAtMap.get(event.recipientId) ?? emailDueAt;
    recipientDueAtMap.set(event.recipientId, await alignRecipientEmailDueAt(
      event.recipientId,
      dueAt,
      "MR_COMPARISON",
      MR_COMPARISON_EMAIL_DELAY_MS,
    ));
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

function summaryForType(type: EmailEventType): string {
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
    case EmailEventType.ERR_WORKFLOW_UPDATE:
      return "errUpdates";
    default:
      return "updates";
  }
}

function renderSummary(
  counts: Record<string, number>,
  updates: Array<{ documentNumber: string; title: string; comments: string | null }>,
  errUpdates: Array<{
    documentNumber: string;
    title: string;
    type: string;
    status: string;
    fileName: string;
    projectName: string | null;
    projectDirector: string;
    action: string;
    comments: string | null;
  }> = [],
) {
  const appUrl = appConfig.appUrl();
  const lines = [
    counts.approved ? `<p>Approved documents: ${counts.approved}</p>` : "",
    counts.rejected ? `<p>Rejected documents: ${counts.rejected}</p>` : "",
    counts.pending ? `<p>Pending documents: ${counts.pending}</p>` : "",
    counts.overdue ? `<p>Documents pending for more than 24 hours: ${counts.overdue}</p>` : "",
    counts.comparisonOverdue ? `<p>Approved Comparisons awaiting MR upload for more than 24 hours: ${counts.comparisonOverdue}</p>` : "",
    counts.purchaseOrderAvailable ? `<p>New purchase orders are available for your related MRs.</p>` : "",
    counts.errUpdates ? `<p>ERR updates: ${counts.errUpdates}</p>` : "",
  ].join("");

  const escapeHtml = (value: string) => value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#039;")
    .replace(/\n/g, "<br />");

  const errDetails = errUpdates.map((update) => `
    <article style="margin: 16px 0; padding: 12px; border: 1px solid #d1d5db;">
      <p><strong>${escapeHtml(update.documentNumber)} - ${escapeHtml(update.title)}</strong></p>
      <p>Type: ${escapeHtml(update.type)} | Status: ${escapeHtml(update.status)}</p>
      <p>File: ${escapeHtml(update.fileName)}</p>
      ${update.projectName ? `<p>Project: ${escapeHtml(update.projectName)}</p>` : ""}
      <p>Project Director: ${escapeHtml(update.projectDirector)}</p>
      <p>Action: ${escapeHtml(update.action.replaceAll("_", " "))}</p>
      ${update.comments ? `<p>Comments: ${escapeHtml(update.comments)}</p>` : ""}
      <p><a href="${appUrl}/errs">Open ERR</a></p>
    </article>
  `).join("");

  const updateDetails = updates
    .filter((update) => update.comments)
    .map((update) => `<p><strong>${update.documentNumber} - ${update.title}</strong><br />Comments: ${update.comments!.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\n/g, "<br />")}</p>`)
    .join("");

  return `
    <div style="font-family: Arial, sans-serif; line-height: 1.6;">
      <p>You have workflow updates requiring your attention.</p>
      ${lines}
      ${updateDetails ? `<h3>Comments</h3>${updateDetails}` : ""}
      ${errDetails ? `<h3>ERR details</h3>${errDetails}` : ""}
      <p>Application URL: <a href="${appUrl}">${appUrl}</a></p>
      <p>Please log in to review them.</p>
    </div>
  `;
}

export async function flushWorkflowEmailBatches() {
  const now = new Date();
  if (isEmailQuietHours(now)) return 0;
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
      if (event.type === EmailEventType.ERR_WORKFLOW_UPDATE) continue;
      const key = summaryForType(event.type);
      counts[key] = (counts[key] || 0) + 1;
    }
    const uniqueErrIds = new Set(group
      .filter((event) => event.type === EmailEventType.ERR_WORKFLOW_UPDATE)
      .map((event) => event.documentId)
      .filter((documentId): documentId is string => Boolean(documentId)));
    if (uniqueErrIds.size > 0) counts.errUpdates = uniqueErrIds.size;

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
        .filter((event) => event.type !== EmailEventType.ERR_WORKFLOW_UPDATE)
        .map((event) => event.documentId)
        .filter((documentId): documentId is string => Boolean(documentId));
      const documentTypes = await getDocumentTypes(documentIds);
      const documentsWithComments = documentIds.length > 0
        ? await prisma.document.findMany({
            where: { id: { in: [...new Set(documentIds)] } },
            select: {
              id: true,
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
      const errIds = group
        .filter((event) => event.type === EmailEventType.ERR_WORKFLOW_UPDATE)
        .map((event) => event.documentId)
        .filter((documentId): documentId is string => Boolean(documentId));
      const errRecords = errIds.length > 0
        ? await prisma.err.findMany({
            where: { id: { in: [...new Set(errIds)] } },
            select: {
              id: true,
              documentNumber: true,
              title: true,
              type: true,
              status: true,
              files: {
                where: { kind: "ERR_PDF" },
                orderBy: [{ versionNumber: "desc" }, { createdAt: "desc" }],
                take: 1,
                select: { originalName: true },
              },
              projectNameSnapshot: true,
              projectDirector: { select: { name: true } },
              approvalHistory: {
                orderBy: { performedAt: "desc" },
                take: 1,
                select: { action: true, comments: true },
              },
            },
          })
        : [];

      await sendEmail({
        to: recipientEmail,
        subject: counts.errUpdates ? `Workflow updates (${Object.values(counts).reduce((sum, count) => sum + count, 0)})` : "Workflow notification summary",
        html: renderSummary(counts, documentsWithComments
          .filter((document) => getEmailBatchCohort(documentTypes.get(document.id)) === "OTHER")
          .map((document) => ({
          documentNumber: document.documentNumber,
          title: document.title,
          comments: document.approvals[0]?.comments ?? null,
        })), errRecords.map((err) => ({
          documentNumber: err.documentNumber,
          title: err.title,
          type: err.type,
          status: err.status,
          fileName: err.files[0]?.originalName ?? err.title,
          projectName: err.projectNameSnapshot,
          projectDirector: err.projectDirector.name,
          action: err.approvalHistory[0]?.action ?? "UPDATED",
          comments: err.approvalHistory[0]?.comments ?? null,
        }))),
      });
      await prisma.emailNotificationEvent.updateMany({
        where: { id: { in: group.map((event) => event.id) }, claimedAt, emailSent: false },
        data: { emailSent: true, claimedAt: null },
      });
      sentCount += 1;
    } catch (error) {
      if (isSmtpRateLimitError(error)) {
        const retryAt = new Date(Date.now() + SMTP_RATE_LIMIT_COOLDOWN_MS);
        await prisma.emailNotificationEvent.updateMany({
          where: {
            id: { in: events.map((event) => event.id) },
            emailSent: false,
          },
          data: { emailDueAt: retryAt },
        });
        await prisma.emailNotificationEvent.updateMany({
          where: { id: { in: group.map((event) => event.id) }, claimedAt },
          data: { claimedAt: null },
        });
        console.warn(`SMTP rate limit reached; remaining workflow email batches deferred until ${retryAt.toISOString()}.`);
        break;
      }

      await prisma.emailNotificationEvent.updateMany({
        where: { id: { in: group.map((event) => event.id) }, claimedAt },
        data: { claimedAt: null },
      });
      console.error("Workflow email batch failed:", error);
    }
  }

  return sentCount;
}

