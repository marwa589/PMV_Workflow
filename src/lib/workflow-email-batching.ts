import { ApprovalActionType, DocumentStatus, EmailEventType, ProcessStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { sendEmail } from "@/lib/mail";
import { appConfig } from "@/lib/env";
import { getEligibleRecipients, loadDocScope } from "@/lib/workflow/eligibility";
import { USER_TYPE } from "@/lib/auth/roles";

const EMAIL_DELAY_MS = 10 * 60 * 1000;
const PROCESS_EMAIL_DELAY_MS = 20 * 60 * 1000;
const REMINDER_INTERVAL_MS = 24 * 60 * 60 * 1000;
const CLAIM_TIMEOUT_MS = 15 * 60 * 1000;
const EMAIL_TIME_ZONE = "Asia/Kuwait";

type ZonedParts = { year: number; month: number; day: number; hour: number; minute: number };

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

// Documents that belong to a process run are batched over a longer window, so a person who uploads
// several documents of one run gets a single summary. Everything else uses the shorter window.
type EmailBatchCohort = "PROCESS" | "OTHER";

async function getDocumentCohorts(documentIds: Array<string | null | undefined>) {
  const ids = [...new Set(documentIds.filter((id): id is string => Boolean(id)))];
  const cohorts = new Map<string, EmailBatchCohort>();
  if (ids.length === 0) return cohorts;

  const inProcess = await prisma.processStepDocument.findMany({
    where: { documentId: { in: ids } },
    select: { documentId: true },
    distinct: ["documentId"],
  });
  const inProcessIds = new Set(inProcess.map((row) => row.documentId));
  for (const id of ids) cohorts.set(id, inProcessIds.has(id) ? "PROCESS" : "OTHER");
  return cohorts;
}

function cohortFor(documentId: string | null | undefined, cohorts: Map<string, EmailBatchCohort>): EmailBatchCohort {
  return (documentId ? cohorts.get(documentId) : undefined) ?? "OTHER";
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
    select: { id: true, emailDueAt: true, documentId: true },
  });

  const candidateCohorts = await getDocumentCohorts(pendingEvents.map((event) => event.documentId));
  const matchingEvents = pendingEvents.filter((event) => cohortFor(event.documentId, candidateCohorts) === cohort);

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

  const createdAt = new Date();
  const cohorts = await getDocumentCohorts(dedupedEvents.map((event) => event.documentId));
  const dueAtByCohort = new Map<string, Date>();

  for (const event of dedupedEvents) {
    const cohort = cohortFor(event.documentId, cohorts);
    const batchWindowMs = cohort === "PROCESS" ? PROCESS_EMAIL_DELAY_MS : EMAIL_DELAY_MS;
    const key = `${event.recipientId}:${cohort}`;
    if (!dueAtByCohort.has(key)) {
      const desiredDueAt = nextEmailSendTime(new Date(createdAt.getTime() + batchWindowMs));
      dueAtByCohort.set(key, await alignRecipientEmailDueAt(event.recipientId, desiredDueAt, cohort, batchWindowMs));
    }
  }

  await prisma.emailNotificationEvent.createMany({
    data: dedupedEvents.map((event) => ({
      recipientId: event.recipientId,
      type: event.type,
      documentId: event.documentId ?? null,
      createdAt,
      emailDueAt: dueAtByCohort.get(`${event.recipientId}:${cohortFor(event.documentId, cohorts)}`)!,
      emailSent: false,
    })),
    skipDuplicates: true,
  });

  return dedupedEvents.length;
}

const WAITING_STATUSES: DocumentStatus[] = [DocumentStatus.PENDING, DocumentStatus.REVISION_REQUIRED];

const waitingDocumentSelect = {
  id: true,
  status: true,
  createdById: true,
  projectId: true,
  documentTypeId: true,
  documentSubtypeId: true,
  currentWorkflowStep: true,
  currentApproverAssignedAt: true,
  approvals: {
    orderBy: { performedAt: "desc" },
    take: 2,
    select: { action: true, performedById: true },
  },
  approvalSteps: { select: { levelNumber: true, approvers: true } },
} as const;

type WaitingDocument = {
  id: string;
  status: DocumentStatus;
  createdById: string;
  projectId: string | null;
  documentTypeId: string;
  documentSubtypeId: string | null;
  currentWorkflowStep: number | null;
  approvals: Array<{ action: ApprovalActionType; performedById: string }>;
  approvalSteps: Array<{ levelNumber: number; approvers: Array<{ approverType: "USER" | "USER_TYPE"; userId: string | null; userTypeId: string | null }> }>;
};

/** Who is expected to act now: the uploader at level 0, otherwise the assigned approvers at the current level. */
async function getWaitingRecipientIds(document: WaitingDocument): Promise<string[]> {
  if (document.status !== DocumentStatus.PENDING && document.status !== DocumentStatus.REVISION_REQUIRED) return [];
  if (document.currentWorkflowStep === null) return [];
  if (document.status === DocumentStatus.REVISION_REQUIRED && document.currentWorkflowStep === 0) return [document.createdById];

  if (document.status === DocumentStatus.PENDING && document.approvals[0]?.action === ApprovalActionType.RESUBMITTED) {
    const requester = document.approvals.find((entry) => entry.action === ApprovalActionType.REQUESTED_REVISION);
    return requester ? [requester.performedById] : [];
  }

  const step = document.approvalSteps.find((candidate) => candidate.levelNumber === document.currentWorkflowStep);
  if (!step) return [];

  const scope = await loadDocScope(prisma, document);
  const recipients = await getEligibleRecipients(prisma, step.approvers, scope);
  return recipients.map((recipient) => recipient.id);
}

export async function queuePendingApprovalReminders() {
  const reminderCutoff = new Date(Date.now() - REMINDER_INTERVAL_MS);
  const waitingDocuments = await prisma.document.findMany({
    where: {
      status: { in: WAITING_STATUSES },
      currentApproverAssignedAt: { lte: reminderCutoff },
    },
    select: waitingDocumentSelect,
  });

  const events: Array<{ recipientId: string; type: EmailEventType; documentId: string }> = [];
  for (const document of waitingDocuments) {
    for (const recipientId of await getWaitingRecipientIds(document)) {
      const existingReminder = await prisma.emailNotificationEvent.findFirst({
        where: {
          recipientId,
          documentId: document.id,
          type: EmailEventType.APPROVAL_OVERDUE,
          createdAt: { gte: reminderCutoff },
        },
        select: { id: true },
      });

      if (!existingReminder) {
        events.push({ recipientId, type: EmailEventType.APPROVAL_OVERDUE, documentId: document.id });
      }
    }
  }

  return queueWorkflowEmailEvents(events);
}

/**
 * A process run is stuck when its previous step's document was approved more than 24 hours ago and the
 * current step still has no document. Admins are reminded once per approved document.
 * (Replaces the old "approved Comparison waiting for an MR" reminder.)
 */
export async function queueProcessStepReminders() {
  const admins = await prisma.user.findMany({
    where: { isActive: true, userType: { code: USER_TYPE.ADMIN } },
    select: { id: true },
  });
  if (admins.length === 0) return 0;

  const cutoff = new Date(Date.now() - REMINDER_INTERVAL_MS);
  const runs = await prisma.processInstance.findMany({
    where: { status: ProcessStatus.IN_PROGRESS },
    select: {
      currentStepNumber: true,
      processDefinition: { select: { steps: { select: { id: true, stepNumber: true } } } },
      stepDocuments: {
        where: { isCurrent: true },
        select: { processStep: { select: { stepNumber: true } }, document: { select: { id: true, status: true, approvedAt: true } } },
      },
    },
  });

  const stalledDocumentIds = new Set<string>();
  for (const run of runs) {
    const hasCurrentDocument = run.stepDocuments.some((link) => link.processStep.stepNumber === run.currentStepNumber);
    if (hasCurrentDocument) continue;

    const previous = run.stepDocuments
      .filter((link) => link.processStep.stepNumber < run.currentStepNumber)
      .sort((a, b) => b.processStep.stepNumber - a.processStep.stepNumber)[0];

    if (previous && previous.document.status === DocumentStatus.APPROVED && previous.document.approvedAt && previous.document.approvedAt <= cutoff) {
      stalledDocumentIds.add(previous.document.id);
    }
  }

  const events: Array<{ recipientId: string; type: EmailEventType; documentId: string }> = [];
  for (const admin of admins) {
    for (const documentId of stalledDocumentIds) {
      const existingReminder = await prisma.emailNotificationEvent.findFirst({
        where: { recipientId: admin.id, documentId, type: EmailEventType.PROCESS_STEP_OVERDUE },
        select: { id: true },
      });

      if (!existingReminder) {
        events.push({ recipientId: admin.id, type: EmailEventType.PROCESS_STEP_OVERDUE, documentId });
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
    case EmailEventType.PROCESS_STEP_OVERDUE:
      return "processOverdue";
    default:
      return "updates";
  }
}

const escapeHtml = (value: string) => value
  .replace(/&/g, "&amp;")
  .replace(/</g, "&lt;")
  .replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;")
  .replace(/'/g, "&#039;")
  .replace(/\n/g, "<br />");

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
    counts.processOverdue ? `<p>Process runs waiting for their next document for more than 24 hours: ${counts.processOverdue}</p>` : "",
  ].join("");

  const updateDetails = updates
    .filter((update) => update.comments)
    .map((update) => `<p><strong>${escapeHtml(update.documentNumber)} - ${escapeHtml(update.title)}</strong><br />Comments: ${escapeHtml(update.comments!)}</p>`)
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

  // Drop reminders that no longer apply: the document moved on, or this person is no longer expected to act.
  const reminderEvents = pendingEvents.filter(
    (event) => event.type === EmailEventType.APPROVAL_PENDING || event.type === EmailEventType.APPROVAL_OVERDUE,
  );
  const reminderDocuments = await prisma.document.findMany({
    where: { id: { in: reminderEvents.flatMap((event) => (event.documentId ? [event.documentId] : [])) } },
    select: waitingDocumentSelect,
  });
  const expectedByDocument = new Map<string, Set<string>>();
  for (const document of reminderDocuments) {
    expectedByDocument.set(document.id, new Set(await getWaitingRecipientIds(document)));
  }

  const staleReminderIds = reminderEvents
    .filter((event) => !event.documentId || !expectedByDocument.get(event.documentId)?.has(event.recipientId))
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
  for (const [, group] of groups) {
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
      const documentIds = [...new Set(group.map((event) => event.documentId).filter((id): id is string => Boolean(id)))];
      const documentsWithComments = documentIds.length > 0
        ? await prisma.document.findMany({
            where: { id: { in: documentIds } },
            select: {
              id: true,
              documentNumber: true,
              title: true,
              approvals: { orderBy: { performedAt: "desc" }, take: 1, select: { comments: true } },
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
