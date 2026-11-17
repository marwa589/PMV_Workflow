import { ApprovalActionType, ApproverType, DocumentStatus, EmailEventType, ProcessStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { emailSendingConfigured, isBlockedEmail, sendEmail } from "@/lib/mail";
import { appConfig } from "@/lib/env";
import { getEligibleRecipients, loadDocScope } from "@/lib/workflow/eligibility";
import { USER_TYPE, type UserTypeCode } from "@/lib/auth/roles";
import { MAIL_KINDS, scopeCoversDocument, type MailDelivery, type MailKind, type MailKindDefaults } from "@/lib/mailing-list-config";
import { effectiveDelivery, loadDigestIntervalHours, loadMailDefaults, loadMailSettings, type MailSettingRow } from "@/lib/workflow/mailing-list";

/** One "pending tasks" email per person per summary interval (1 hour unless an admin sets another number of hours). */
const HOUR_MS = 60 * 60 * 1000;
/** A little slack so a worker tick a few seconds early does not push the next email a whole tick later. */
const DIGEST_TOLERANCE_MS = 60 * 1000;
const CLAIM_TIMEOUT_MS = 15 * 60 * 1000;
/** A process run counts as stalled when its next document is still missing this long after its choice opened. */
const STALLED_RUN_AFTER_MS = 24 * 60 * 60 * 1000;
const MAX_LISTED = 10;
/** The mail server limits how fast a client may submit: send a few per run, with a pause between emails. */
const MAX_EMAILS_PER_RUN = 10;
const PAUSE_BETWEEN_EMAILS_MS = 3000;
/** An instant email that fails is tried again later (10, 20, 30 ... minutes) and dropped after this many tries. */
const INSTANT_MAX_ATTEMPTS = 5;
const INSTANT_RETRY_STEP_MS = 10 * 60 * 1000;
/** An instant email still unsent after this long is out of date (for example delivery was switched off): dropped. */
const INSTANT_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
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

/** The kind of email an event is, unless the event says so itself (the "any document" emails do). */
const KIND_BY_TYPE: Partial<Record<EmailEventType, MailKind>> = {
  [EmailEventType.APPROVAL_PENDING]: "AWAITING_REVIEW",
  [EmailEventType.PROCESS_UPLOAD_READY]: "AWAITING_UPLOAD",
  [EmailEventType.WORKFLOW_APPROVED]: "OWN_APPROVED",
  [EmailEventType.WORKFLOW_REJECTED]: "OWN_REJECTED",
  [EmailEventType.WORKFLOW_REVISION_REQUESTED]: "OWN_REVISION",
};

/** Pending-task kinds are found by the hourly summary itself; the others need a stored event to be summarised. */
const TASK_KINDS: MailKind[] = ["AWAITING_REVIEW", "AWAITING_UPLOAD"];
const RESULT_KINDS: MailKind[] = ["OWN_APPROVED", "OWN_REJECTED", "OWN_REVISION"];
const FOLLOW_KINDS: MailKind[] = ["WATCH_APPROVED", "WATCH_REJECTED", "WATCH_REVISION", "PROCESS_UPLOADED", "PROCESS_APPROVED"];

/**
 * Called after something happened to a document. Decides, per person and kind of email, from the Mailing List page's
 * settings (their own, else the defaults), what to do:
 *  - Off: nothing.
 *  - Instant: store an event that is sent on its own as soon as it is allowed (see sendInstantMailEvents).
 *  - Hourly summary: result emails are stored and go into the person's next summary; pending tasks are found by the
 *    summary itself (it looks at what is waiting), so nothing is stored for them.
 * Returns the number of events stored.
 */
export async function queueWorkflowEmailEvents(events: Array<{ recipientId: string; type: EmailEventType; documentId?: string | null; kind?: MailKind; delivery?: MailDelivery }>) {
  const usable = events
    .map((event) => ({ ...event, kind: event.kind ?? KIND_BY_TYPE[event.type] ?? null }))
    .filter((event): event is typeof event & { kind: MailKind; documentId: string } => Boolean(event.kind && event.documentId));
  if (usable.length === 0) return 0;

  const [documents, users, defaults, settings] = await Promise.all([
    prisma.document.findMany({
      where: { id: { in: [...new Set(usable.map((event) => event.documentId))] } },
      select: { id: true, projectId: true, documentTypeId: true, documentSubtypeId: true },
    }),
    prisma.user.findMany({
      where: { id: { in: [...new Set(usable.map((event) => event.recipientId))] } },
      select: { id: true, email: true, isActive: true, emailNotificationsDisabled: true },
    }),
    loadMailDefaults(prisma),
    loadMailSettings(prisma, [...new Set(usable.map((event) => event.recipientId))], [...new Set(usable.map((event) => event.kind))]),
  ]);
  const documentById = new Map(documents.map((document) => [document.id, document]));
  const userById = new Map(users.map((user) => [user.id, user]));

  const rows: Array<{ recipientId: string; type: EmailEventType; documentId: string; kind: MailKind; instant: boolean; emailDueAt: Date }> = [];
  const seen = new Set<string>();
  for (const event of usable) {
    const document = documentById.get(event.documentId);
    const user = userById.get(event.recipientId);
    if (!document || !user || !user.isActive || user.emailNotificationsDisabled || !user.email) continue;
    // One "what happened" email per person per document for one action: the first kind (in the order the events were
    // added) whose delivery is not Off wins, so the uploader on an "Any document ..." list is not mailed twice, nor
    // missed when their own "My document ..." email is Off. Task emails (review / upload waiting) stand on their own.
    const key = TASK_KINDS.includes(event.kind) ? `${event.recipientId}|${event.documentId}|${event.kind}` : `${event.recipientId}|${event.documentId}`;
    if (seen.has(key)) continue;

    const setting = settings.get(`${user.id}|${event.kind}`);
    // For "next document to upload" the event carries the document the run follows, not the one to be uploaded, so only
    // the project limit can be checked here; the type limits are applied by the hourly summary.
    // Follow-up rules decide their own delivery (already worked out with the rule's setting or the kind's default).
    const delivery = event.delivery ?? effectiveDelivery(
      setting,
      event.kind,
      defaults,
      event.kind === "AWAITING_UPLOAD" ? null : document,
      MAIL_KINDS[event.kind].involvement,
    );
    if (delivery === "OFF") continue;
    if (event.kind === "AWAITING_UPLOAD" && setting && setting.projectIds.length > 0 && !(document.projectId && setting.projectIds.includes(document.projectId))) continue;
    seen.add(key);
    // Pending tasks in the summary are found by the summary itself (it looks at what is waiting).
    if (delivery === "DIGEST" && TASK_KINDS.includes(event.kind)) continue;
    rows.push({ recipientId: event.recipientId, type: event.type, documentId: event.documentId, kind: event.kind, instant: delivery === "INSTANT", emailDueAt: new Date() });
  }
  if (rows.length === 0) return 0;
  await prisma.emailNotificationEvent.createMany({ data: rows });
  return rows.length;
}

const WAITING_STATUSES: DocumentStatus[] = [DocumentStatus.PENDING, DocumentStatus.REVISION_REQUIRED];

const waitingDocumentSelect = {
  id: true,
  documentNumber: true,
  title: true,
  status: true,
  createdById: true,
  projectId: true,
  documentTypeId: true,
  documentSubtypeId: true,
  currentWorkflowStep: true,
  approvals: {
    orderBy: { performedAt: "desc" },
    take: 2,
    select: { action: true, performedById: true },
  },
  approvalSteps: { select: { levelNumber: true, approvers: true } },
} as const;

type WaitingDocument = {
  id: string;
  documentNumber: string;
  title: string;
  status: DocumentStatus;
  createdById: string;
  projectId: string | null;
  documentTypeId: string;
  documentSubtypeId: string | null;
  currentWorkflowStep: number | null;
  approvals: Array<{ action: ApprovalActionType; performedById: string }>;
  approvalSteps: Array<{ levelNumber: number; approvers: Array<{ approverType: ApproverType; userId: string | null; userTypeId: string | null }> }>;
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

const EVENT_WORDS: Record<MailKind, string> = {
  AWAITING_REVIEW: "Waiting for review",
  AWAITING_UPLOAD: "Waiting for upload",
  OWN_APPROVED: "Approved",
  OWN_REJECTED: "Rejected",
  OWN_REVISION: "Sent back for revision",
  WATCH_APPROVED: "Approved",
  WATCH_REJECTED: "Rejected",
  WATCH_REVISION: "Sent back for revision",
  PROCESS_UPLOADED: "Uploaded",
  PROCESS_APPROVED: "Approved",
};

type DigestItem = { label: string };
type Digest = { approvals: DigestItem[]; revisions: DigestItem[]; uploads: DigestItem[]; results: DigestItem[]; follows: DigestItem[]; eventIds: string[]; stalledRuns: number };

const emptyDigest = (): Digest => ({ approvals: [], revisions: [], uploads: [], results: [], follows: [], eventIds: [], stalledRuns: 0 });
const digestTotal = (digest: Digest) => digest.approvals.length + digest.revisions.length + digest.uploads.length + digest.results.length + digest.follows.length + digest.stalledRuns;

/** Documents waiting for a person, grouped by that person. Only documents created since `since` count: old ones never trigger an email. */
async function collectWaitingDocuments(since: Date, dueUserIds: Set<string>, digests: Map<string, Digest>, mail: { defaults: MailKindDefaults; settings: Map<string, MailSettingRow> }) {
  const documents = await prisma.document.findMany({
    where: { status: { in: WAITING_STATUSES }, isReference: false, createdAt: { gte: since } },
    select: waitingDocumentSelect,
    orderBy: { createdAt: "asc" },
  });
  for (const document of documents) {
    const label = `${document.documentNumber} - ${document.title}`;
    for (const recipientId of new Set(await getWaitingRecipientIds(document))) {
      if (!dueUserIds.has(recipientId)) continue;
      // The person's own setting (Mailing List page): only "Hourly summary" puts this document in the summary.
      if (effectiveDelivery(mail.settings.get(`${recipientId}|AWAITING_REVIEW`), "AWAITING_REVIEW", mail.defaults, document, true) !== "DIGEST") continue;
      const digest = digests.get(recipientId) ?? emptyDigest();
      digests.set(recipientId, digest);
      (document.status === DocumentStatus.REVISION_REQUIRED ? digest.revisions : digest.approvals).push({ label });
    }
  }
}

/** Process runs whose next document is still missing a day after their choice opened (Admin users are told about these). */
async function countStalledRuns(since: Date): Promise<number> {
  const cutoff = Date.now() - STALLED_RUN_AFTER_MS;
  const runs = await prisma.processInstance.findMany({
    where: { status: ProcessStatus.IN_PROGRESS, currentStepId: { not: null }, currentStep: { childSteps: { some: {} } } },
    select: {
      currentStepId: true,
      currentStep: { select: { childSteps: { select: { delayHours: true } } } },
      stepDocuments: {
        where: { isCurrent: true },
        select: { processStep: { select: { id: true, parentStepId: true } }, document: { select: { status: true, approvedAt: true } } },
      },
    },
  });
  let stalled = 0;
  for (const run of runs) {
    if (run.stepDocuments.some((link) => link.processStep.parentStepId === run.currentStepId)) continue;
    const last = run.stepDocuments.find((link) => link.processStep.id === run.currentStepId);
    if (!last || last.document.status !== DocumentStatus.APPROVED || !last.document.approvedAt) continue;
    if (last.document.approvedAt < since) continue;
    const smallestDelayHours = Math.min(...(run.currentStep?.childSteps.map((child) => child.delayHours) ?? [0]));
    if (last.document.approvedAt.getTime() + smallestDelayHours * 60 * 60 * 1000 <= cutoff) stalled += 1;
  }
  return stalled;
}

const escapeHtml = (value: string) => value
  .replace(/&/g, "&amp;")
  .replace(/</g, "&lt;")
  .replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;")
  .replace(/'/g, "&#039;")
  .replace(/\n/g, "<br />");

function renderSection(title: string, items: DigestItem[]) {
  if (items.length === 0) return "";
  const listed = items.slice(0, MAX_LISTED).map((item) => `<li>${escapeHtml(item.label)}</li>`).join("");
  const more = items.length > MAX_LISTED ? `<li>... and ${items.length - MAX_LISTED} more</li>` : "";
  return `<h3 style="margin-bottom:4px;">${escapeHtml(title)} (${items.length})</h3><ul style="margin-top:0;">${listed}${more}</ul>`;
}

function renderDigest(digest: Digest) {
  const appUrl = appConfig.appUrl();
  return `
    <div style="font-family: Arial, sans-serif; line-height: 1.6;">
      <p>${digest.approvals.length + digest.revisions.length + digest.uploads.length + digest.stalledRuns > 0 ? "You have tasks waiting for you." : "Here is what happened since your last email."}</p>
      ${renderSection("Documents waiting for your approval", digest.approvals)}
      ${renderSection("Documents sent back to you for revision", digest.revisions)}
      ${renderSection("Process documents ready for you to upload", digest.uploads)}
      ${renderSection("Updates on your documents", digest.results)}
      ${renderSection("Updates on documents you follow", digest.follows)}
      ${digest.stalledRuns ? `<p>Process runs waiting for their next document for more than 24 hours: ${digest.stalledRuns}</p>` : ""}
      <p>Application URL: <a href="${appUrl}">${appUrl}</a></p>
      <p>Please log in to see the details.</p>
    </div>
  `;
}

/**
 * The only email the workflow sends: ONE summary of a person's pending tasks, at most once per summary interval (default 1 hour), and only when
 * there is something pending. Old documents (created before EMAIL_PENDING_SINCE) are ignored. Safe to call from
 * several places at once: each person's send is claimed atomically in EmailDigestState.
 * Returns the number of emails sent.
 */
export async function sendPendingTaskDigests(): Promise<number> {
  const now = new Date();
  if (isEmailQuietHours(now)) return 0;
  // Delivery off or SMTP not set up: nothing can be sent, so nothing is worked out (and nobody's summary is used up).
  if (!emailSendingConfigured()) return 0;
  const since = appConfig.emailPendingSince();
  const intervalHours = await loadDigestIntervalHours(prisma);
  const dueBefore = new Date(now.getTime() - intervalHours * HOUR_MS + DIGEST_TOLERANCE_MS);
  const claimCutoff = new Date(now.getTime() - CLAIM_TIMEOUT_MS);

  const users = await prisma.user.findMany({
    where: { isActive: true, emailNotificationsDisabled: false, email: { not: "" } },
    select: { id: true, email: true, userType: { select: { code: true } }, emailDigestState: { select: { lastSentAt: true, claimedAt: true } } },
  });
  // Only people whose last email is older than the summary interval (or who never got one) are looked at.
  const due = users.filter((user) => !isBlockedEmail(user.email) && (!user.emailDigestState || (user.emailDigestState.lastSentAt <= dueBefore && (!user.emailDigestState.claimedAt || user.emailDigestState.claimedAt < claimCutoff))));
  if (due.length === 0) return 0;
  const dueIds = new Set(due.map((user) => user.id));
  const digests = new Map<string, Digest>();

  const mail = {
    defaults: await loadMailDefaults(prisma),
    settings: await loadMailSettings(prisma, [...dueIds], ["AWAITING_REVIEW", "AWAITING_UPLOAD"]),
  };
  await collectWaitingDocuments(since, dueIds, digests, mail);

  // Uploads waiting for a person: same rule as My Tasks, Admin users excluded (they are never told about uploads).
  // Imported lazily: processes.ts reaches this file through effects.ts.
  const { getUploadTasks } = await import("@/lib/workflow/processes");
  for (const user of due) {
    if (user.userType.code === USER_TYPE.ADMIN) continue;
    const uploadSetting = mail.settings.get(`${user.id}|AWAITING_UPLOAD`);
    // Only "Hourly summary" lists upload tasks here; a limit on projects / types keeps the tasks inside it.
    if (effectiveDelivery(uploadSetting, "AWAITING_UPLOAD", mail.defaults, null, true) !== "DIGEST") continue;
    const allTasks = await getUploadTasks(prisma, { userId: user.id, userType: user.userType.code as UserTypeCode }, { since });
    const recent = uploadSetting
      ? allTasks.filter((task) => task.options.some((option) => scopeCoversDocument(uploadSetting, { projectId: task.project?.id ?? null, documentTypeId: option.documentTypeId, documentSubtypeId: option.documentSubtypeId })))
      : allTasks;
    if (recent.length === 0) continue;
    const digest = digests.get(user.id) ?? emptyDigest();
    digests.set(user.id, digest);
    digest.uploads.push(...recent.map((task) => ({ label: `${task.processName}${task.reference ? ` - ${task.reference}` : ""} (after ${task.afterStepName})` })));
  }

  // Result emails waiting for the summary: own documents and the "any document" lists.
  const storedEvents = await prisma.emailNotificationEvent.findMany({
    where: {
      emailSent: false,
      instant: false,
      kind: { in: [...RESULT_KINDS, ...FOLLOW_KINDS] },
      recipientId: { in: [...dueIds] },
      OR: [{ claimedAt: null }, { claimedAt: { lt: claimCutoff } }],
    },
    orderBy: { createdAt: "asc" },
    select: { id: true, recipientId: true, kind: true, documentId: true },
  });
  if (storedEvents.length > 0) {
    const eventDocuments = await prisma.document.findMany({
      where: { id: { in: [...new Set(storedEvents.flatMap((event) => (event.documentId ? [event.documentId] : [])))] } },
      select: { id: true, documentNumber: true, title: true },
    });
    const documentLabel = new Map(eventDocuments.map((document) => [document.id, `${document.documentNumber} - ${document.title}`]));
    for (const event of storedEvents) {
      if (!event.kind || !event.documentId) continue;
      const digest = digests.get(event.recipientId) ?? emptyDigest();
      digests.set(event.recipientId, digest);
      const item = { label: `${EVENT_WORDS[event.kind]}: ${documentLabel.get(event.documentId) ?? event.documentId}` };
      (RESULT_KINDS.includes(event.kind) ? digest.results : digest.follows).push(item);
      digest.eventIds.push(event.id);
    }
  }

  const admins = due.filter((user) => user.userType.code === USER_TYPE.ADMIN);
  if (admins.length > 0) {
    const stalledRuns = await countStalledRuns(since);
    if (stalledRuns > 0) {
      for (const admin of admins) {
        const digest = digests.get(admin.id) ?? emptyDigest();
        digests.set(admin.id, digest);
        digest.stalledRuns = stalledRuns;
      }
    }
  }

  let sent = 0;
  for (const user of due) {
    const digest = digests.get(user.id);
    if (!digest || digestTotal(digest) === 0) continue;
    // Everyone else waits for the next run (people not yet emailed stay due, so nobody is skipped for good).
    if (sent >= MAX_EMAILS_PER_RUN) break;

    // Claim this person's turn. Whoever flips claimedAt first sends; everyone else skips.
    await prisma.emailDigestState.createMany({ data: [{ userId: user.id, lastSentAt: new Date(0) }], skipDuplicates: true });
    const claimedAt = new Date();
    const claimed = await prisma.emailDigestState.updateMany({
      where: { userId: user.id, lastSentAt: { lte: dueBefore }, OR: [{ claimedAt: null }, { claimedAt: { lt: claimCutoff } }] },
      data: { claimedAt },
    });
    if (claimed.count === 0) continue;

    try {
      const result = await sendEmail({ to: user.email, subject: "You have pending tasks", html: renderDigest(digest), throwOnError: true });
      if (result) {
        await prisma.emailDigestState.updateMany({ where: { userId: user.id, claimedAt }, data: { lastSentAt: new Date(), claimedAt: null } });
        if (digest.eventIds.length > 0) await prisma.emailNotificationEvent.updateMany({ where: { id: { in: digest.eventIds } }, data: { emailSent: true, claimedAt: null } });
        sent += 1;
        await sleep(PAUSE_BETWEEN_EMAILS_MS);
      } else {
        // Not sent (delivery disabled, blocked address or SMTP error): release the claim, try again on the next run.
        await prisma.emailDigestState.updateMany({ where: { userId: user.id, claimedAt }, data: { claimedAt: null } });
      }
    } catch (error) {
      await prisma.emailDigestState.updateMany({ where: { userId: user.id, claimedAt }, data: { claimedAt: null } });
      console.error("Pending task email failed:", error);
      // The server said "too fast" (SMTP 4xx): stop this run, the rest go out on the next one.
      const responseCode = (error as { responseCode?: number })?.responseCode;
      if (typeof responseCode === "number" && responseCode >= 400 && responseCode < 500) break;
    }
  }
  return sent;
}

const INSTANT_SUBJECTS: Record<MailKind, string> = {
  AWAITING_REVIEW: "A document is waiting for your review",
  AWAITING_UPLOAD: "A next document is ready for you to upload",
  OWN_APPROVED: "Your document was fully approved",
  OWN_REJECTED: "Your document was rejected",
  OWN_REVISION: "Your document was sent back for revision",
  WATCH_APPROVED: "A document was fully approved",
  WATCH_REJECTED: "A document was rejected",
  WATCH_REVISION: "A document was sent back for revision",
  PROCESS_UPLOADED: "A document was uploaded in a process you follow",
  PROCESS_APPROVED: "A document was approved in a process you follow",
};

/**
 * Sends the "Instant" emails: one email per event, as soon as quiet hours (18:00-06:00 Kuwait) allow. Called right after
 * something happens and again by the background worker and the cron endpoint, so anything held back goes out in the
 * morning. Each event is claimed atomically, so running it from several places never sends one twice.
 * A failed email never holds up the others: it is tried again later (and dropped after a few tries), an address the
 * system never emails is dropped at once, and emails older than a day are dropped as out of date.
 * Returns the number of emails sent.
 */
export async function sendInstantMailEvents(): Promise<number> {
  const now = new Date();
  if (isEmailQuietHours(now)) return 0;
  // Delivery off or SMTP not set up: the emails wait (the age limit below keeps old ones from going out later).
  if (!emailSendingConfigured()) return 0;
  const claimCutoff = new Date(now.getTime() - CLAIM_TIMEOUT_MS);

  // Out of date: dropped without sending.
  await prisma.emailNotificationEvent.updateMany({
    where: { instant: true, emailSent: false, createdAt: { lt: new Date(now.getTime() - INSTANT_MAX_AGE_MS) } },
    data: { emailSent: true, claimedAt: null },
  });

  const events = await prisma.emailNotificationEvent.findMany({
    where: { instant: true, emailSent: false, emailDueAt: { lte: now }, OR: [{ claimedAt: null }, { claimedAt: { lt: claimCutoff } }] },
    // By when each is due: an email that failed was given a later time, so it waits behind the others.
    orderBy: [{ emailDueAt: "asc" }, { createdAt: "asc" }],
    take: MAX_EMAILS_PER_RUN,
    select: { id: true, kind: true, documentId: true, attempts: true, recipient: { select: { email: true, isActive: true, emailNotificationsDisabled: true } } },
  });

  // A failed send: try again later, or give up after a few tries.
  const retryLater = async (event: { id: string; attempts: number }, claimedAt: Date) => {
    const attempts = event.attempts + 1;
    await prisma.emailNotificationEvent.updateMany({
      where: { id: event.id, claimedAt },
      data: attempts >= INSTANT_MAX_ATTEMPTS
        ? { attempts, emailSent: true, claimedAt: null }
        : { attempts, emailDueAt: new Date(Date.now() + attempts * INSTANT_RETRY_STEP_MS), claimedAt: null },
    });
  };

  let sent = 0;
  for (const event of events) {
    const claimedAt = new Date();
    const claimed = await prisma.emailNotificationEvent.updateMany({
      where: { id: event.id, emailSent: false, OR: [{ claimedAt: null }, { claimedAt: { lt: claimCutoff } }] },
      data: { claimedAt },
    });
    if (claimed.count === 0) continue;

    // The person was deactivated or switched their emails off since the event was stored, or the address is one the
    // system never emails: drop it.
    if (!event.kind || !event.recipient.isActive || event.recipient.emailNotificationsDisabled || !event.recipient.email || isBlockedEmail(event.recipient.email)) {
      await prisma.emailNotificationEvent.updateMany({ where: { id: event.id, claimedAt }, data: { emailSent: true, claimedAt: null } });
      continue;
    }

    const document = event.documentId
      ? await prisma.document.findUnique({ where: { id: event.documentId }, select: { id: true, documentNumber: true, title: true } })
      : null;
    const appUrl = appConfig.appUrl();
    const html = `
      <div style="font-family: Arial, sans-serif; line-height: 1.6;">
        <p>${escapeHtml(INSTANT_SUBJECTS[event.kind])}.</p>
        ${document ? `<p><strong>${escapeHtml(`${document.documentNumber} - ${document.title}`)}</strong></p>` : ""}
        <p><a href="${document ? `${appUrl}/documents/${document.id}` : appUrl}">Open in the application</a></p>
      </div>
    `;
    try {
      const result = await sendEmail({ to: event.recipient.email, subject: INSTANT_SUBJECTS[event.kind], html, throwOnError: true });
      if (result) {
        await prisma.emailNotificationEvent.updateMany({ where: { id: event.id, claimedAt }, data: { emailSent: true, claimedAt: null } });
        sent += 1;
        await sleep(PAUSE_BETWEEN_EMAILS_MS);
      } else {
        await retryLater(event, claimedAt);
      }
    } catch (error) {
      console.error("Instant email failed:", error);
      const responseCode = (error as { responseCode?: number })?.responseCode;
      // The server said "too fast" (SMTP 4xx): not this email's fault. Release it as it was and stop this run.
      if (typeof responseCode === "number" && responseCode >= 400 && responseCode < 500) {
        await prisma.emailNotificationEvent.updateMany({ where: { id: event.id, claimedAt }, data: { claimedAt: null } });
        break;
      }
      // Anything else (a bounced address, a server error): try again later, up to a few times.
      await retryLater(event, claimedAt);
    }
  }
  return sent;
}
