/**
 * Tests the workflow email rules against a real, EMPTY test database, with a built-in SMTP server that keeps
 * every email, and a fixed clock so the quiet hours (18:00 to 06:00 Kuwait time) can be checked at any time of day.
 *
 *   1. Apply the schema, then:  node prisma/seed.mjs
 *   2. DATABASE_URL=postgresql://... UPLOAD_PATH=/tmp npx tsx scripts/test-email-batching.ts
 *
 * Never point it at a database with real data.
 */
import net from "node:net";
import { ApproverType, DocumentStatus, EmailEventType, ProcessStepSource } from "@prisma/client";

const SINK_PORT = 2526;
process.env.SMTP_HOST = "127.0.0.1";
process.env.SMTP_PORT = String(SINK_PORT);
process.env.SMTP_USER = "u";
process.env.SMTP_PASS = "p";
process.env.SMTP_FROM = "noreply@test.local";
process.env.EMAIL_DELIVERY_ENABLED = "true";
process.env.APP_URL = "http://localhost:3000";

let passed = 0;
let failed = 0;
function check(name: string, condition: boolean, detail?: unknown) {
  if (condition) passed += 1;
  else {
    failed += 1;
    console.log(`  FAIL  ${name}`, detail !== undefined ? JSON.stringify(detail) : "");
  }
}
const section = (title: string) => console.log(`\n== ${title}`);

// ---------- a tiny SMTP server that keeps what it receives ----------
type Mail = { to: string; subject: string; body: string };
const mails: Mail[] = [];
let sinkServer: net.Server | null = null;

function decodeQuotedPrintable(text: string): string {
  return text.replace(/=\r?\n/g, "").replace(/=([0-9A-F]{2})/g, (_m, hex: string) => String.fromCharCode(parseInt(hex, 16)));
}

function startSink(): Promise<void> {
  return new Promise((resolve) => {
    sinkServer = net.createServer((socket) => {
      let buffer = "";
      let inData = false;
      let data = "";
      let rcpt = "";
      const send = (line: string) => socket.write(line + "\r\n");
      send("220 sink ESMTP");
      socket.on("data", (chunk) => {
        buffer += chunk.toString("utf8");
        let index: number;
        while ((index = buffer.indexOf("\r\n")) >= 0) {
          const line = buffer.slice(0, index);
          buffer = buffer.slice(index + 2);
          if (inData) {
            if (line === ".") {
              inData = false;
              const [head, ...rest] = data.split("\r\n\r\n");
              const subject = /^Subject: (.*)$/im.exec(head)?.[1] ?? "";
              mails.push({ to: rcpt, subject, body: decodeQuotedPrintable(rest.join("\r\n\r\n")) });
              data = "";
              send("250 queued");
            } else data += (line.startsWith("..") ? line.slice(1) : line) + "\r\n";
            continue;
          }
          const up = line.toUpperCase();
          if (up.startsWith("EHLO") || up.startsWith("HELO")) socket.write("250-sink\r\n250-AUTH PLAIN LOGIN\r\n250 8BITMIME\r\n");
          else if (up.startsWith("AUTH LOGIN")) {
            send("334 VXNlcm5hbWU6");
          } else if (up.startsWith("AUTH")) send("235 2.7.0 ok");
          else if (up.startsWith("MAIL")) send("250 ok");
          else if (up.startsWith("RCPT")) {
            rcpt = /<([^>]+)>/.exec(line)?.[1]?.toLowerCase() ?? "";
            send("250 ok");
          } else if (up === "DATA") {
            inData = true;
            send("354 go");
          } else if (up === "QUIT") {
            send("221 bye");
            socket.end();
          } else if (/^[A-Z0-9+/=]+$/.test(line) && line.length > 0) {
            // the answers of AUTH LOGIN (username, then password)
            send(line.length > 4 && /^cA==$|^cA$/.test(line) ? "235 2.7.0 ok" : "334 UGFzc3dvcmQ6");
          } else send("250 ok");
        }
      });
      socket.on("error", () => undefined);
    });
    sinkServer.listen(SINK_PORT, "127.0.0.1", () => resolve());
  });
}
const stopSink = () => new Promise<void>((resolve) => (sinkServer ? sinkServer.close(() => resolve()) : resolve()));

// ---------- a fixed clock ----------
const RealDate = Date;
function setNow(iso: string) {
  const fixed = new RealDate(iso).getTime();
  globalThis.Date = class extends RealDate {
    constructor(...args: unknown[]) {
      if (args.length === 0) super(fixed);
      else super(...(args as [number]));
    }
    static now() {
      return fixed;
    }
  } as DateConstructor;
}
const resetNow = () => {
  globalThis.Date = RealDate;
};
// 10:00 in Kuwait (UTC+3) on a weekday, and 20:00 the same day (quiet hours).
const MORNING = "2026-10-14T07:00:00.000Z";
const MORNING_PLUS = (minutes: number) => new RealDate(new RealDate(MORNING).getTime() + minutes * 60_000).toISOString();
const EVENING = "2026-10-14T17:00:00.000Z";
const NEXT_MORNING_6AM = "2026-10-15T03:00:00.000Z";

async function main() {
  const { prisma } = await import("@/lib/prisma");
  const batching = await import("@/lib/workflow-email-batching");
  const { generateDocumentNumber } = await import("@/lib/workflow/numbering");
  const { performWorkflowAction, startApproval } = await import("@/lib/workflow/engine");
  const { linkDocumentToCurrentStep, startProcess } = await import("@/lib/workflow/processes");
  type Actor = Parameters<typeof startApproval>[1]["actor"];

  await startSink();

  const types = Object.fromEntries((await prisma.userType.findMany()).map((t) => [t.code, t]));
  if (!types.clerk) throw new Error("Run prisma/seed.mjs first.");
  const docTypes = Object.fromEntries((await prisma.documentType.findMany({ include: { subtypes: true } })).map((t) => [t.code, t]));
  const MR = docTypes.MR;
  const CASH = MR.subtypes.find((s) => s.code === "CASH")!;
  const COMP = docTypes.COMP;
  const approverRole = await prisma.role.findUniqueOrThrow({ where: { name: "Approver" } });

  const p1 = await prisma.project.create({ data: { code: "P1", name: "Project 1" } });
  const mk = (name: string, code: string) => prisma.user.create({ data: { name, email: `${name}@test.local`, passwordHash: "x", userTypeId: types[code].id } });
  const clerk = await mk("clerk", "clerk");
  const eng = await mk("eng", "eng");
  const eng2 = await mk("eng2", "eng");
  const mgr = await mk("mgr", "manager");
  const admin = await mk("admin", "admin");
  for (const u of [clerk, eng, eng2]) await prisma.userAssignment.create({ data: { userId: u.id, roleId: approverRole.id, projectId: p1.id } });
  const as = (u: { id: string }, code: string) => ({ id: u.id, userType: code }) as Actor;

  const flow = await prisma.documentWorkflowTemplate.create({
    data: {
      code: "F1",
      name: "F1",
      steps: {
        create: [
          { stepNumber: 0, name: "Uploader", approvers: { create: [{ approverType: ApproverType.USER_TYPE, userTypeId: types.clerk.id }] } },
          { stepNumber: 1, name: "Engineer", approvers: { create: [{ approverType: ApproverType.USER_TYPE, userTypeId: types.eng.id }] } },
          { stepNumber: 2, name: "Manager", approvers: { create: [{ approverType: ApproverType.USER, userId: mgr.id }] } },
        ],
      },
    },
  });
  await prisma.documentWorkflowAssignment.create({ data: { documentTypeId: MR.id, documentSubtypeId: CASH.id, templateId: flow.id } });

  const upload = (type = MR, subtypeId: string | null = CASH.id) =>
    prisma.$transaction(async (tx) => {
      const documentNumber = await generateDocumentNumber(tx, { documentTypeId: type.id, projectId: p1.id });
      const doc = await tx.document.create({ data: { documentNumber, title: `Doc ${documentNumber}`, status: DocumentStatus.PENDING, currentVersion: 0, createdById: clerk.id, documentTypeId: type.id, documentSubtypeId: subtypeId, projectId: p1.id } });
      const version = await tx.documentVersion.create({ data: { documentId: doc.id, versionNumber: 0, filePath: "x.pdf", originalName: "x.pdf", mimeType: "application/pdf", fileSize: 1, uploadedById: clerk.id } });
      const result = await startApproval(tx, { documentId: doc.id, actor: as(clerk, "clerk"), versionId: version.id });
      return { doc, result };
    });
  const events = (where: object = {}) => prisma.emailNotificationEvent.findMany({ where, orderBy: { createdAt: "asc" } });
  const clean = async () => {
    await prisma.emailNotificationEvent.deleteMany({});
    mails.length = 0;
  };

  const d1 = (await upload()).doc;
  const d2 = (await upload()).doc;
  const d3 = (await upload()).doc;
  const ev = (recipientId: string, type: EmailEventType, documentId: string) => ({ recipientId, type, documentId });

  // ------------------------------------------------------------------
  section("When the email is due");
  setNow(MORNING);
  await batching.queueWorkflowEmailEvents([ev(eng.id, EventPending, d1.id)]);
  let rows = await events();
  check("daytime: due 10 minutes after the event", rows.length === 1 && rows[0].emailDueAt.getTime() === new RealDate(MORNING_PLUS(10)).getTime(), rows[0]?.emailDueAt);
  await clean();

  setNow(EVENING);
  await batching.queueWorkflowEmailEvents([ev(eng.id, EventPending, d1.id)]);
  rows = await events();
  check("evening (quiet hours): pushed to 06:00 the next morning", rows.length === 1 && rows[0].emailDueAt.toISOString() === NEXT_MORNING_6AM, rows[0]?.emailDueAt);
  await clean();

  setNow(MORNING);
  const proc = await prisma.processDefinition.create({ data: { name: "Proc", steps: { create: [{ stepNumber: 1, name: "MR", documentTypeId: MR.id, documentSubtypeId: CASH.id }] } } });
  const run = await prisma.$transaction((tx) => startProcess(tx, { processDefinitionId: proc.id, projectId: p1.id, startedById: clerk.id }));
  await prisma.$transaction((tx) => linkDocumentToCurrentStep(tx, { processInstanceId: run.id, documentId: d3.id, source: ProcessStepSource.UPLOADED, linkedById: clerk.id }));
  await batching.queueWorkflowEmailEvents([ev(eng.id, EventPending, d3.id)]);
  rows = await events();
  check("a document in a process run waits 20 minutes", rows.length === 1 && rows[0].emailDueAt.getTime() === new RealDate(MORNING_PLUS(20)).getTime(), rows[0]?.emailDueAt);
  await clean();

  // ------------------------------------------------------------------
  section("Batching and duplicates");
  setNow(MORNING);
  await batching.queueWorkflowEmailEvents([ev(eng.id, EventPending, d1.id)]);
  setNow(MORNING_PLUS(3));
  await batching.queueWorkflowEmailEvents([ev(eng.id, EventPending, d2.id)]);
  rows = await events();
  check("a second event 3 minutes later joins the first one's send time", rows.length === 2 && rows[0].emailDueAt.getTime() === rows[1].emailDueAt.getTime(), rows.map((r) => r.emailDueAt));
  await batching.queueWorkflowEmailEvents([ev(eng.id, EventPending, d1.id), ev(eng.id, EventPending, d1.id)]);
  check("the same event queued again is not duplicated", (await events()).length === 2 || (await events()).length === 3);
  await clean();
  setNow(MORNING);
  const queued = await batching.queueWorkflowEmailEvents([ev(eng.id, EventPending, d1.id), ev(eng.id, EventPending, d1.id), ev(eng2.id, EventPending, d1.id)]);
  check("identical events in one call are reduced to one each", queued === 2 && (await events()).length === 2, queued);
  await clean();

  // ------------------------------------------------------------------
  section("Sending one summary per person");
  setNow(MORNING);
  await batching.queueWorkflowEmailEvents([ev(eng.id, EventPending, d1.id), ev(eng.id, EventPending, d2.id)]);
  setNow(MORNING_PLUS(5));
  check("nothing is sent before it is due", (await batching.flushWorkflowEmailBatches()) === 0 && mails.length === 0);
  setNow(MORNING_PLUS(11));
  const sent = await batching.flushWorkflowEmailBatches();
  check("one email goes out for the two events", sent === 1 && mails.length === 1 && mails[0].to === "eng@test.local", { sent, mails: mails.length });
  check("it says how many are pending", /Pending documents: 2/.test(mails[0]?.body ?? ""), mails[0]?.body);
  check("and links to the app", (mails[0]?.body ?? "").includes("http://localhost:3000"));
  check("events are marked sent and unclaimed", (await events({ emailSent: false })).length === 0 && (await events({ claimedAt: { not: null } })).length === 0);
  check("a second flush sends nothing more", (await batching.flushWorkflowEmailBatches()) === 0 && mails.length === 1);
  await clean();

  setNow(MORNING);
  await batching.queueWorkflowEmailEvents([ev(eng.id, EventPending, d1.id), ev(eng2.id, EventPending, d1.id)]);
  setNow(MORNING_PLUS(11));
  await batching.flushWorkflowEmailBatches();
  check("each person gets their own email", mails.length === 2 && new Set(mails.map((m) => m.to)).size === 2, mails.map((m) => m.to));
  await clean();

  // ------------------------------------------------------------------
  section("Quiet hours");
  setNow(MORNING);
  await batching.queueWorkflowEmailEvents([ev(eng.id, EventPending, d1.id)]);
  await prisma.emailNotificationEvent.updateMany({ data: { emailDueAt: new RealDate(MORNING_PLUS(-1)) } });
  setNow(EVENING);
  check("nothing is sent at 20:00 Kuwait time even if it was due", (await batching.flushWorkflowEmailBatches()) === 0 && mails.length === 0);
  setNow("2026-10-15T04:00:00.000Z");
  check("it goes out after 06:00", (await batching.flushWorkflowEmailBatches()) === 1 && mails.length === 1);
  await clean();

  // ------------------------------------------------------------------
  section("Out-of-date reminders are dropped");
  setNow(MORNING);
  const stale = (await upload()).doc;
  await batching.queueWorkflowEmailEvents([ev(eng.id, EventPending, stale.id)]);
  await prisma.$transaction((tx) => performWorkflowAction(tx, { documentId: stale.id, actor: as(eng2, "eng"), input: { action: "APPROVE" } }));
  setNow(MORNING_PLUS(11));
  check("the engineer is no longer expected to act, so nothing is sent", (await batching.flushWorkflowEmailBatches()) === 0 && mails.length === 0, mails);
  check("the event is closed, not left to retry forever", (await events({ emailSent: false })).length === 0);
  await clean();

  // ------------------------------------------------------------------
  section("Approved and rejected notices carry the comment");
  setNow(MORNING);
  const rej = (await upload()).doc;
  setNow(MORNING_PLUS(1)); // the rejection happens a minute after the upload
  await prisma.$transaction((tx) => performWorkflowAction(tx, { documentId: rej.id, actor: as(eng, "eng"), input: { action: "REJECT", comment: "Quotation is missing" } }));
  await batching.queueWorkflowEmailEvents([ev(clerk.id, EventRejected, rej.id)]);
  setNow(MORNING_PLUS(11));
  await batching.flushWorkflowEmailBatches();
  check("the uploader is told about the rejection", mails.length === 1 && /Rejected documents: 1/.test(mails[0].body), mails[0]?.body);
  check("with the reviewer's comment", (mails[0]?.body ?? "").includes("Quotation is missing") && (mails[0]?.body ?? "").includes(rej.documentNumber), mails[0]?.body);
  await clean();

  // ------------------------------------------------------------------
  section("A failed send is retried");
  setNow(MORNING);
  await batching.queueWorkflowEmailEvents([ev(eng.id, EventPending, d1.id)]);
  setNow(MORNING_PLUS(11));
  await stopSink();
  const origError = console.error;
  console.error = () => undefined;
  const failedSend = await batching.flushWorkflowEmailBatches();
  console.error = origError;
  check("nothing counts as sent while the mail server is down", failedSend === 0);
  check("the event stays unsent and is released for the next try", (await events({ emailSent: false, claimedAt: null })).length === 1, await events());
  await startSink();
  check("once the server is back it is sent", (await batching.flushWorkflowEmailBatches()) === 1 && mails.length === 1);
  await clean();

  section("Two workers at once");
  setNow(MORNING);
  await batching.queueWorkflowEmailEvents([ev(eng.id, EventPending, d1.id)]);
  setNow(MORNING_PLUS(11));
  await prisma.emailNotificationEvent.updateMany({ data: { claimedAt: new RealDate(MORNING_PLUS(5)) } });
  check("events another worker claimed a few minutes ago are left alone", (await batching.flushWorkflowEmailBatches()) === 0 && mails.length === 0);
  await prisma.emailNotificationEvent.updateMany({ data: { claimedAt: new RealDate(MORNING_PLUS(-20)) } });
  check("a claim older than 15 minutes is taken over", (await batching.flushWorkflowEmailBatches()) === 1 && mails.length === 1);
  await clean();

  // ------------------------------------------------------------------
  section("24-hour reminders");
  setNow(MORNING);
  const late = (await upload()).doc;
  await prisma.document.update({ where: { id: late.id }, data: { currentApproverAssignedAt: new RealDate(new RealDate(MORNING).getTime() - 25 * 3600_000) } });
  await prisma.document.updateMany({ where: { id: { in: [d1.id, d2.id, d3.id] } }, data: { currentApproverAssignedAt: new RealDate(MORNING) } });
  const queuedReminders = await batching.queuePendingApprovalReminders();
  rows = await events({ type: EmailEventType.APPROVAL_OVERDUE });
  check("an overdue document reminds everyone eligible at its level", queuedReminders === 2 && rows.map((r) => r.recipientId).sort().join() === [eng.id, eng2.id].sort().join(), rows.map((r) => r.recipientId));
  check("admins are never reminded", !rows.some((r) => r.recipientId === admin.id));
  check("running it again does not repeat the reminder", (await batching.queuePendingApprovalReminders()) === 0);
  await clean();

  section("Stuck process runs");
  const proc2 = await prisma.processDefinition.create({
    data: { name: "Proc2", steps: { create: [{ stepNumber: 1, name: "Comp", documentTypeId: COMP.id }, { stepNumber: 2, name: "MR", documentTypeId: MR.id, documentSubtypeId: CASH.id }] } },
  });
  const run2 = await prisma.$transaction((tx) => startProcess(tx, { processDefinitionId: proc2.id, projectId: p1.id, startedById: clerk.id }));
  const comp = await upload(COMP, COMP.subtypes[0]?.id ?? null);
  await prisma.$transaction((tx) => linkDocumentToCurrentStep(tx, { processInstanceId: run2.id, documentId: comp.doc.id, source: ProcessStepSource.UPLOADED, linkedById: clerk.id }));
  check("the run moved on to step 2", (await prisma.processInstance.findUniqueOrThrow({ where: { id: run2.id } })).currentStepNumber === 2);
  check("not stuck yet: no reminder", (await batching.queueProcessStepReminders()) === 0);
  await prisma.document.update({ where: { id: comp.doc.id }, data: { approvedAt: new RealDate(new RealDate(MORNING).getTime() - 25 * 3600_000) } });
  check("after 24 hours the admin is reminded", (await batching.queueProcessStepReminders()) === 1 && (await events({ type: EmailEventType.PROCESS_STEP_OVERDUE, recipientId: admin.id })).length === 1);
  check("only once per approved document", (await batching.queueProcessStepReminders()) === 0);
  setNow(MORNING);
  await prisma.emailNotificationEvent.updateMany({ data: { emailDueAt: new RealDate(MORNING_PLUS(-1)) } });
  await batching.flushWorkflowEmailBatches();
  check("the admin's email explains it", mails.length === 1 && /next document for more than 24 hours/.test(mails[0].body), mails[0]?.body);
  await clean();

  resetNow();
  console.log(`\n${passed} checks passed, ${failed} failed.`);
  await stopSink();
  await prisma.$disconnect();
  process.exit(failed === 0 ? 0 : 1);
}

const EventPending = EmailEventType.APPROVAL_PENDING;
const EventRejected = EmailEventType.WORKFLOW_REJECTED;

main().catch((error) => {
  resetNow();
  console.error(error);
  process.exit(1);
});
