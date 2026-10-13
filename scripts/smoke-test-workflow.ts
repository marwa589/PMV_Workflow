/**
 * Integration smoke test for the dynamic workflow. Runs the real engine against a REAL, EMPTY test database.
 *
 *   1. Apply the schema (prisma migrate) and run:  node prisma/seed.mjs
 *   2. DATABASE_URL=postgresql://... npx tsx scripts/smoke-test-workflow.ts
 *
 * It creates its own fixtures (projects, users, flows). Never point it at a database with real data.
 */
import { ApprovalActionType, ApproverType, DocumentStatus, ProcessStatus, ProcessStepSource, StepStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { buildDocumentVisibilityWhere, canAccessDocument, userHasPermission } from "@/lib/auth/access";
import { getEligibleRecipients, loadDocScope, canUserUpload } from "@/lib/workflow/eligibility";
import { resolveFlow } from "@/lib/workflow/resolve-flow";
import { generateDocumentNumber, validateNamingPattern } from "@/lib/workflow/numbering";
import { performWorkflowAction, setDocumentArchived, startApproval, type WorkflowActor } from "@/lib/workflow/engine";
import { linkDocumentToCurrentStep, startProcess } from "@/lib/workflow/processes";
import { WorkflowError } from "@/lib/workflow/errors";
import { deleteDocumentRecords } from "@/lib/document-deletion";
import { getDocumentsForAdmin, getDocumentsForApprover, getDocumentsForClerk } from "@/lib/document-queries";
import { loadFieldDefinitions, normalizeFieldValues, saveFieldValues } from "@/lib/document-fields";

let passed = 0;
let failed = 0;
function check(name: string, condition: boolean, detail?: unknown) {
  if (condition) passed += 1;
  else {
    failed += 1;
    console.log(`  FAIL  ${name}`, detail !== undefined ? JSON.stringify(detail) : "");
  }
}
async function expectWorkflowError(name: string, status: number, run: () => Promise<unknown>) {
  try {
    await run();
    check(`${name} (expected error ${status})`, false);
  } catch (error) {
    check(name, error instanceof WorkflowError && error.status === status, error instanceof Error ? `${error.name}: ${error.message}` : error);
  }
}
const section = (title: string) => console.log(`\n== ${title}`);
const year = new Date().getUTCFullYear();

async function main() {
  const types = Object.fromEntries((await prisma.userType.findMany()).map((t) => [t.code, t]));
  if (!types.clerk) throw new Error("Run prisma/seed.mjs first.");
  const docTypes = Object.fromEntries((await prisma.documentType.findMany({ include: { subtypes: true } })).map((t) => [t.code, t]));
  const sub = (typeCode: string, code: string) => docTypes[typeCode].subtypes.find((s) => s.code === code)!;
  const approverRole = await prisma.role.findUniqueOrThrow({ where: { name: "Approver" } });
  const editorRole = await prisma.role.findUniqueOrThrow({ where: { name: "Editor" } });

  // ---------- fixtures ----------
  const location = await prisma.location.create({ data: { name: "KSA" } });
  const p1 = await prisma.project.create({ data: { code: "P1", name: "Project 1", locationId: location.id } });
  const p2 = await prisma.project.create({ data: { code: "P2", name: "Project 2", locationId: location.id } });
  const mk = (name: string, code: string) => prisma.user.create({ data: { name, email: `${name}@test.local`, passwordHash: "x", userTypeId: types[code].id } });
  const clerk1 = await mk("clerk1", "clerk");
  const clerk2 = await mk("clerk2", "clerk");
  const eng1 = await mk("eng1", "eng");
  const eng2 = await mk("eng2", "eng");
  const mgr = await mk("mgr", "manager");
  const admin = await mk("admin", "admin");
  const as = (u: { id: string }, code: string): WorkflowActor => ({ id: u.id, userType: code as WorkflowActor["userType"] });
  const assign = (userId: string, roleId: string, projectId: string | null) => prisma.userAssignment.create({ data: { userId, roleId, projectId } });
  await assign(clerk1.id, editorRole.id, p1.id);
  await assign(eng1.id, approverRole.id, p1.id);
  await assign(eng2.id, approverRole.id, p2.id);

  const flow = (code: string, levels: Array<Array<{ user?: string; type?: string }>>) =>
    prisma.documentWorkflowTemplate.create({
      data: {
        code, name: code,
        steps: {
          create: levels.map((entries, i) => ({
            stepNumber: i, name: i === 0 ? "Uploader" : `Level ${i}`,
            approvers: { create: entries.map((e) => (e.user ? { approverType: ApproverType.USER, userId: e.user } : { approverType: ApproverType.USER_TYPE, userTypeId: types[e.type!].id })) },
          })),
        },
      },
    });
  const f1 = await flow("F1", [[{ type: "clerk" }], [{ type: "eng" }], [{ user: mgr.id }]]);
  const MR = docTypes.MR; const CASH = sub("MR", "CASH");
  await prisma.documentWorkflowAssignment.create({ data: { documentTypeId: MR.id, documentSubtypeId: CASH.id, templateId: f1.id } });

  const upload = async (uploader: WorkflowActor, o: { type?: typeof MR; subtypeId?: string | null; projectId?: string | null } = {}) =>
    prisma.$transaction(async (tx) => {
      const type = o.type ?? MR;
      const projectId = o.projectId === undefined ? p1.id : o.projectId;
      const subtypeId = o.subtypeId === undefined ? CASH.id : o.subtypeId;
      const documentNumber = await generateDocumentNumber(tx, { documentTypeId: type.id, projectId });
      const doc = await tx.document.create({ data: { documentNumber, title: `Doc ${documentNumber}`, status: DocumentStatus.PENDING, currentVersion: 0, createdById: uploader.id, documentTypeId: type.id, documentSubtypeId: subtypeId, projectId } });
      const version = await tx.documentVersion.create({ data: { documentId: doc.id, versionNumber: 0, filePath: "x.pdf", originalName: "x.pdf", mimeType: "application/pdf", fileSize: 1, uploadedById: uploader.id } });
      const result = await startApproval(tx, { documentId: doc.id, actor: uploader, versionId: version.id });
      return { doc, result };
    });
  const act = (documentId: string, actor: WorkflowActor, input: Parameters<typeof performWorkflowAction>[1]["input"]) =>
    prisma.$transaction((tx) => performWorkflowAction(tx, { documentId, actor, input }));
  const load = (id: string) => prisma.document.findUniqueOrThrow({ where: { id }, include: { approvalSteps: { orderBy: { levelNumber: "asc" } }, approvals: { orderBy: { performedAt: "asc" } } } });

  // ---------- naming pattern ----------
  section("Naming pattern validation");
  check("default pattern accepted", validateNamingPattern("{TYPE}-{PROJECT}-{YYYY}-{SEQ:4}") === null);
  check("pattern without {PROJECT} rejected", validateNamingPattern("{TYPE}-{YYYY}-{SEQ:4}") !== null);
  check("unknown token rejected", validateNamingPattern("{TYPE}-{PROJECT}-{YYYY}-{SEQ:4}-{FOO}") !== null);

  // ---------- who may upload ----------
  section("Who may upload (flow with an uploader step)");
  const scope1 = { documentTypeId: MR.id, documentSubtypeId: CASH.id, projectId: p1.id };
  check("clerk with an assignment on the project can upload", await canUserUpload(prisma, as(clerk1, "clerk"), scope1));
  check("clerk with no assignment cannot upload", !(await canUserUpload(prisma, as(clerk2, "clerk"), scope1)));
  check("clerk cannot upload to a project they are not assigned to", !(await canUserUpload(prisma, as(clerk1, "clerk"), { ...scope1, projectId: p2.id })));
  check("engineer is not in the uploader step", !(await canUserUpload(prisma, as(eng1, "eng"), scope1)));
  check("admin can upload into any flow", await canUserUpload(prisma, as(admin, "admin"), scope1));

  // ---------- numbering + start ----------
  section("Upload: numbering and flow copied onto the document");
  const a = await upload(as(clerk1, "clerk"));
  const b = await upload(as(clerk1, "clerk"));
  check("first number", a.doc.documentNumber === `MR-P1-${year}-0001`, a.doc.documentNumber);
  check("second number", b.doc.documentNumber === `MR-P1-${year}-0002`, b.doc.documentNumber);
  const noProject = await upload(as(admin, "admin"), { projectId: null });
  check("no-project number drops {PROJECT}", noProject.doc.documentNumber === `MR-${year}-0001`, noProject.doc.documentNumber);
  // Consequence of rule A: a document with no project is not covered by a project-scoped assignment,
  // so a flow level that names only a user TYPE has nobody eligible for it.
  check("no-project document under a user-type flow has no eligible approver", noProject.result.effects.notifications.length === 0, noProject.result.effects.notifications);
  const dA = await load(a.doc.id);
  check("status pending at level 1", dA.status === DocumentStatus.PENDING && dA.currentWorkflowStep === 1);
  check("levels copied: 0 approved, 1 pending, 2 waiting", dA.approvalSteps.map((s) => s.status).join() === [StepStatus.APPROVED, StepStatus.PENDING, StepStatus.WAITING].join());
  check("SUBMITTED recorded", dA.approvals[0]?.action === ApprovalActionType.SUBMITTED);
  check("level-1 recipients are notified (eng1 only)", a.result.effects.notifications.map((n) => n.userId).join() === eng1.id, a.result.effects.notifications);
  const racing = await Promise.all(Array.from({ length: 5 }, () => prisma.$transaction((tx) => generateDocumentNumber(tx, { documentTypeId: MR.id, projectId: p2.id }))));
  check("5 parallel numbers are all different", new Set(racing).size === 5, racing);

  // ---------- eligibility (rule A) ----------
  section("Eligibility: named user anywhere, user type needs a matching assignment");
  await expectWorkflowError("engineer assigned to another project cannot approve", 403, () => act(a.doc.id, as(eng2, "eng"), { action: "APPROVE" }));
  await expectWorkflowError("manager cannot approve level 1", 403, () => act(a.doc.id, as(mgr, "manager"), { action: "APPROVE" }));
  await expectWorkflowError("admin is not an approver unless the flow names them", 403, () => act(a.doc.id, as(admin, "admin"), { action: "APPROVE" }));
  const scopeA = await loadDocScope(prisma, dA);
  const stepsA = await prisma.documentApprovalStep.findMany({ where: { documentId: a.doc.id }, include: { approvers: true }, orderBy: { levelNumber: "asc" } });
  const l1 = await getEligibleRecipients(prisma, stepsA[1].approvers, scopeA);
  check("recipients at level 1 = eng1 (not eng2, not admin)", l1.length === 1 && l1[0].id === eng1.id, l1.map((u) => u.id));

  // ---------- approve, delegation ----------
  section("Approve through the levels, with a delegation");
  const r1 = await act(a.doc.id, as(eng1, "eng"), { action: "APPROVE", comment: "ok" });
  check("approve at level 1 moves to level 2", r1.status === DocumentStatus.PENDING && r1.currentWorkflowStep === 2);
  check("manager notified", r1.effects.notifications.map((n) => n.userId).join() === mgr.id);
  await prisma.approvalDelegation.create({ data: { delegatorUserId: mgr.id, delegateUserId: eng2.id, createdById: admin.id } });
  const l2 = await getEligibleRecipients(prisma, stepsA[2].approvers, scopeA);
  check("delegate is notified with the manager", l2.map((u) => u.id).sort().join() === [mgr.id, eng2.id].sort().join(), l2.map((u) => u.id));
  const r2 = await act(a.doc.id, as(eng2, "eng"), { action: "APPROVE" });
  const dA2 = await load(a.doc.id);
  check("last approval makes it approved", r2.status === DocumentStatus.APPROVED && dA2.approvedAt !== null && dA2.currentWorkflowStep === null);
  const lastEvent = dA2.approvals.at(-1)!;
  check("delegated approval recorded on behalf of the manager", lastEvent.action === ApprovalActionType.DELEGATED_APPROVED && lastEvent.onBehalfOfUserId === mgr.id, lastEvent);
  check("creator gets approved notification + email", r2.effects.notifications.some((n) => n.userId === clerk1.id) && r2.effects.emailEvents.some((e) => e.recipientId === clerk1.id));

  // ---------- revision ----------
  section("Revision to any earlier step, including the uploader");
  const c = await upload(as(clerk1, "clerk"));
  await act(c.doc.id, as(eng1, "eng"), { action: "APPROVE" });
  await expectWorkflowError("revision needs a comment", 400, () => act(c.doc.id, as(mgr, "manager"), { action: "REQUEST_REVISION", comment: "", targetLevel: 1 }));
  await expectWorkflowError("revision target must be earlier", 400, () => act(c.doc.id, as(mgr, "manager"), { action: "REQUEST_REVISION", comment: "x", targetLevel: 2 }));
  const rv1 = await act(c.doc.id, as(mgr, "manager"), { action: "REQUEST_REVISION", comment: "redo level 1", targetLevel: 1 });
  const dC1 = await load(c.doc.id);
  check("sent back to level 1: pending, steps reset", rv1.status === DocumentStatus.PENDING && dC1.currentWorkflowStep === 1 && dC1.approvalSteps.map((s) => s.status).join() === [StepStatus.APPROVED, StepStatus.PENDING, StepStatus.WAITING].join(), dC1.approvalSteps.map((s) => s.status));
  check("revision number bumped, target recorded", dC1.revisionNumber === 2 && dC1.approvals.at(-1)?.revisionTargetLevel === 1);
  const rv0 = await act(c.doc.id, as(eng1, "eng"), { action: "REQUEST_REVISION", comment: "back to uploader", targetLevel: 0 });
  const dC0 = await load(c.doc.id);
  check("back to the uploader gives status revision", rv0.status === DocumentStatus.REVISION_REQUIRED && dC0.currentWorkflowStep === 0 && dC0.approvalSteps[0].status === StepStatus.REVISION);
  check("uploader is emailed", rv0.effects.emailEvents.some((e) => e.recipientId === clerk1.id));
  await expectWorkflowError("someone outside the uploader step cannot resubmit", 403, () => act(c.doc.id, as(clerk2, "clerk"), { action: "RESUBMIT" }));
  const rs = await act(c.doc.id, as(clerk1, "clerk"), { action: "RESUBMIT", comment: "fixed" });
  check("resubmit runs level 1 again", rs.status === DocumentStatus.PENDING && rs.currentWorkflowStep === 1);
  await act(c.doc.id, as(eng1, "eng"), { action: "APPROVE" });
  const fin = await act(c.doc.id, as(mgr, "manager"), { action: "APPROVE" });
  check("full second pass ends approved", fin.status === DocumentStatus.APPROVED);

  // ---------- reject, hold ----------
  section("Reject, hold and resume");
  const d = await upload(as(clerk1, "clerk"));
  const rj = await act(d.doc.id, as(eng1, "eng"), { action: "REJECT", comment: "no" });
  const dD = await load(d.doc.id);
  check("reject cancels and keeps the level", rj.status === DocumentStatus.CANCELLED && dD.currentWorkflowStep === 1 && dD.approvalSteps[1].status === StepStatus.REJECTED);
  check("rejection email to creator", rj.effects.emailEvents.some((e) => e.recipientId === clerk1.id && e.type === "WORKFLOW_REJECTED"));
  await expectWorkflowError("cannot approve a cancelled document", 409, () => act(d.doc.id, as(eng1, "eng"), { action: "APPROVE" }));
  const e = await upload(as(clerk1, "clerk"));
  await act(e.doc.id, as(eng1, "eng"), { action: "HOLD" });
  check("on hold", (await load(e.doc.id)).status === DocumentStatus.ON_HOLD);
  await expectWorkflowError("cannot approve while on hold", 409, () => act(e.doc.id, as(eng1, "eng"), { action: "APPROVE" }));
  await act(e.doc.id, as(eng1, "eng"), { action: "RESUME" });
  check("resumed to pending", (await load(e.doc.id)).status === DocumentStatus.PENDING);

  // ---------- concurrency ----------
  section("Two approvals at the same moment: exactly one wins");
  const g = await upload(as(clerk1, "clerk"));
  const settled = await Promise.allSettled([act(g.doc.id, as(eng1, "eng"), { action: "APPROVE" }), act(g.doc.id, as(eng1, "eng"), { action: "APPROVE" })]);
  const wins = settled.filter((s) => s.status === "fulfilled").length;
  check("exactly one succeeded", wins === 1, settled.map((s) => s.status));
  const dG = await load(g.doc.id);
  check("document advanced only one level", dG.currentWorkflowStep === 2, dG.currentWorkflowStep);

  // ---------- archive ----------
  section("Archive");
  await expectWorkflowError("cannot archive a pending document", 409, () => prisma.$transaction((tx) => setDocumentArchived(tx, { documentId: g.doc.id, actor: as(admin, "admin"), archived: true })));
  await prisma.$transaction((tx) => setDocumentArchived(tx, { documentId: a.doc.id, actor: as(admin, "admin"), archived: true }));
  check("approved document archived", (await load(a.doc.id)).status === DocumentStatus.ARCHIVED);
  await prisma.$transaction((tx) => setDocumentArchived(tx, { documentId: a.doc.id, actor: as(admin, "admin"), archived: false }));
  check("restored to approved", (await load(a.doc.id)).status === DocumentStatus.APPROVED);

  // ---------- flow resolution order ----------
  section("Flow resolution: most specific wins (confirmed order)");
  const ERR = docTypes.ERR; const REN = sub("ERR", "RENEWAL"); const RENT = sub("ERR", "RENTAL_ACTC");
  const fa = await flow("FA", [[{ type: "clerk" }], [{ type: "eng" }]]);
  const fb = await flow("FB", [[{ type: "clerk" }], [{ type: "manager" }]]);
  const fc = await flow("FC", [[{ type: "clerk" }], [{ user: mgr.id }]]);
  const which = async (subtypeId: string, projectId: string | null) => {
    const r = await resolveFlow(prisma, { documentTypeId: ERR.id, documentSubtypeId: subtypeId, projectId });
    return r.kind === "auto" ? "auto" : r.template.code;
  };
  check("nothing matches: auto-approve", (await which(REN.id, p1.id)) === "auto");
  await prisma.documentWorkflowAssignment.create({ data: { documentTypeId: ERR.id, templateId: null } });
  check("type row with no flow: auto-approve", (await which(REN.id, p1.id)) === "auto");
  await prisma.documentWorkflowAssignment.create({ data: { documentTypeId: ERR.id, documentSubtypeId: REN.id, templateId: fa.id } });
  check("4: sub type beats type", (await which(REN.id, p1.id)) === "FA" && (await which(RENT.id, p1.id)) === "auto");
  await prisma.documentWorkflowAssignment.create({ data: { documentTypeId: ERR.id, projectId: p1.id, templateId: fb.id } });
  check("project + type beats sub type alone", (await which(REN.id, p1.id)) === "FB" && (await which(RENT.id, p1.id)) === "FB");
  check("other project still uses the sub type row", (await which(REN.id, p2.id)) === "FA");
  await prisma.documentWorkflowAssignment.create({ data: { documentTypeId: ERR.id, documentSubtypeId: REN.id, projectId: p1.id, templateId: fc.id } });
  check("project + sub type is the most specific", (await which(REN.id, p1.id)) === "FC");

  // ---------- auto-approve + process ----------
  section("Auto-approve and process runs");
  const COMP = docTypes.COMP; const SP = sub("COMP", "SPARE_PARTS");
  check("no flow: clerk with an assignment may upload", await canUserUpload(prisma, as(clerk1, "clerk"), { documentTypeId: COMP.id, documentSubtypeId: SP.id, projectId: p1.id }));
  check("no flow: clerk without assignment may not", !(await canUserUpload(prisma, as(clerk2, "clerk"), { documentTypeId: COMP.id, documentSubtypeId: SP.id, projectId: p1.id })));
  const proc = await prisma.processDefinition.create({
    data: { name: "Procurement", steps: { create: [{ stepNumber: 1, name: "Comp sheet", documentTypeId: COMP.id }, { stepNumber: 2, name: "Material req", documentTypeId: MR.id, documentSubtypeId: CASH.id }] } },
  });
  const run = await prisma.$transaction((tx) => startProcess(tx, { processDefinitionId: proc.id, projectId: p1.id, reference: "Tyres", startedById: clerk1.id }));
  const comp = await upload(as(clerk1, "clerk"), { type: COMP, subtypeId: SP.id });
  check("no flow: approved on upload", comp.result.status === DocumentStatus.APPROVED && (await load(comp.doc.id)).approvals[0]?.action === ApprovalActionType.AUTO_APPROVED);
  await expectWorkflowError("wrong document type cannot fill the step", 400, () => prisma.$transaction((tx) => linkDocumentToCurrentStep(tx, { processInstanceId: run.id, documentId: a.doc.id, source: ProcessStepSource.EXISTING, linkedById: clerk1.id })));
  await prisma.$transaction((tx) => linkDocumentToCurrentStep(tx, { processInstanceId: run.id, documentId: comp.doc.id, source: ProcessStepSource.UPLOADED, linkedById: clerk1.id }));
  check("approved document moves the run to step 2", (await prisma.processInstance.findUniqueOrThrow({ where: { id: run.id } })).currentStepNumber === 2);
  const mr1 = await upload(as(clerk1, "clerk"));
  await prisma.$transaction((tx) => linkDocumentToCurrentStep(tx, { processInstanceId: run.id, documentId: mr1.doc.id, source: ProcessStepSource.UPLOADED, linkedById: clerk1.id }));
  const mr1b = await upload(as(clerk1, "clerk"));
  await expectWorkflowError("step already has a document in progress", 409, () => prisma.$transaction((tx) => linkDocumentToCurrentStep(tx, { processInstanceId: run.id, documentId: mr1b.doc.id, source: ProcessStepSource.UPLOADED, linkedById: clerk1.id })));
  await act(mr1.doc.id, as(eng1, "eng"), { action: "REJECT" });
  await prisma.$transaction((tx) => linkDocumentToCurrentStep(tx, { processInstanceId: run.id, documentId: mr1b.doc.id, source: ProcessStepSource.UPLOADED, linkedById: clerk1.id }));
  const links = await prisma.processStepDocument.findMany({ where: { processInstanceId: run.id }, orderBy: { linkedAt: "asc" } });
  check("rejected document stays as history, new one is current", links.filter((l) => l.isCurrent).length === 2 && links.some((l) => l.documentId === mr1.doc.id && !l.isCurrent), links.map((l) => [l.documentId === mr1.doc.id, l.isCurrent]));
  let dupBlocked = false;
  try { await prisma.processStepDocument.create({ data: { processInstanceId: run.id, processStepId: links[1].processStepId, documentId: comp.doc.id, source: ProcessStepSource.EXISTING, linkedById: clerk1.id, isCurrent: true } }); } catch { dupBlocked = true; }
  check("database allows only one current document per step", dupBlocked);
  await act(mr1b.doc.id, as(eng1, "eng"), { action: "APPROVE" });
  await act(mr1b.doc.id, as(mgr, "manager"), { action: "APPROVE" });
  const done = await prisma.processInstance.findUniqueOrThrow({ where: { id: run.id } });
  check("last step approved completes the run", done.status === ProcessStatus.COMPLETED && done.completedAt !== null);

  // ---------- visibility + queries ----------
  section("Visibility and dashboard queries");
  const open = await upload(as(clerk1, "clerk"));
  const vis = async (u: { id: string }, code: string) => prisma.document.count({ where: await buildDocumentVisibilityWhere({ userId: u.id, userType: code as WorkflowActor["userType"] }) });
  const total = await prisma.document.count();
  check("admin sees everything", (await vis(admin, "admin")) === total);
  check("clerk without assignments sees nothing", (await vis(clerk2, "clerk")) === 0);
  check("clerk sees what they uploaded", (await vis(clerk1, "clerk")) >= 5);
  check("access check agrees", (await canAccessDocument({ userId: eng1.id, userType: "eng" }, open.doc.id)) && !(await canAccessDocument({ userId: clerk2.id, userType: "clerk" }, open.doc.id)));
  const eng1View = await getDocumentsForApprover(eng1.id, "eng");
  check("engineer's pending list includes the open document", eng1View.pendingDocuments.some((x) => x.id === open.doc.id), eng1View.pendingDocuments.length);
  const eng2View = await getDocumentsForApprover(eng2.id, "eng");
  check("engineer at another project has no level-1 task, but is delegate for level 2", !eng2View.pendingDocuments.some((x) => x.id === open.doc.id));
  const row = eng1View.pendingDocuments.find((x) => x.id === open.doc.id);
  check("row shows status label and who it waits for", row?.statusLabel === "Pending Level 1" && row.currentApprover?.name === "Engineer", row);
  const clerkView = await getDocumentsForClerk(clerk1.id);
  check("clerk dashboard counts", clerkView.total >= 5 && clerkView.pending >= 1 && clerkView.approved >= 1 && clerkView.rejected >= 1, clerkView.total);
  const adminView = await getDocumentsForAdmin();
  check("admin dashboard groups users by type", adminView.usersByType.reduce((n, t) => n + t.count, 0) === 6);

  // ---------- permissions ----------
  section("Permissions");
  const analyst = await prisma.role.findUniqueOrThrow({ where: { name: "Viewer" } });
  await prisma.userAssignment.create({ data: { userId: eng2.id, roleId: analyst.id, documentTypeId: MR.id } });
  check("scoped permission matches its document type", await userHasPermission({ userId: eng2.id, userType: "eng" }, "documents.view", { documentTypeId: MR.id }));
  check("scoped permission does not match another type", !(await userHasPermission({ userId: eng2.id, userType: "eng" }, "documents.view", { documentTypeId: COMP.id })));
  check("role without the permission does not grant it", !(await userHasPermission({ userId: eng2.id, userType: "eng" }, "flows.manage")));
  check("admin type always has it", await userHasPermission({ userId: admin.id, userType: "admin" }, "flows.manage"));

  // ---------- custom fields ----------
  section("Custom fields");
  await prisma.documentType.update({ where: { id: MR.id }, data: { supportsLineItems: true } });
  await prisma.fieldDefinition.createMany({
    data: [
      { documentTypeId: MR.id, fieldKey: "mr_number", label: "MR number", dataType: "TEXT", isRequired: true, sortOrder: 1 },
      { documentTypeId: MR.id, fieldKey: "urgency", label: "Urgency", dataType: "SELECT", options: ["Low", "High"], sortOrder: 2 },
      { documentTypeId: MR.id, documentSubtypeId: CASH.id, fieldKey: "needed_by", label: "Needed by", dataType: "DATE", sortOrder: 3 },
      { documentTypeId: MR.id, fieldGroup: "LINE_ITEM", fieldKey: "qty", label: "Qty", dataType: "NUMBER", isRequired: true },
    ],
  });
  const defs = await loadFieldDefinitions(prisma, MR.id, CASH.id);
  check("loads header and line fields for the sub type", defs.length === 4);
  const bad = (h: Record<string, unknown>, l: Array<Record<string, unknown>> = []) => { try { normalizeFieldValues(defs, h, l, true); return null; } catch (error) { return error instanceof WorkflowError ? error.message : String(error); } };
  check("required header field enforced", bad({}) !== null);
  check("select value must be a listed choice", bad({ mr_number: "1", urgency: "Medium" }) !== null);
  check("bad date rejected", bad({ mr_number: "1", needed_by: "2026-02-31" }) !== null);
  check("unknown field rejected", bad({ mr_number: "1", nope: 1 }) !== null);
  check("line item required field enforced", bad({ mr_number: "1" }, [{}]) !== null);
  const ok = normalizeFieldValues(defs, { mr_number: "MR-77", urgency: "High", needed_by: "2026-12-01" }, [{ qty: "4" }, { qty: 2.5 }], true);
  await prisma.$transaction((tx) => saveFieldValues(tx, open.doc.id, ok));
  check("values and line items stored", (await prisma.documentFieldValue.count({ where: { documentId: open.doc.id } })) === 5 && (await prisma.documentLineItem.count({ where: { documentId: open.doc.id } })) === 2);

  // ---------- database rules ----------
  section("Database rules");
  let dupAssignment = false;
  try { await prisma.documentWorkflowAssignment.create({ data: { documentTypeId: ERR.id, templateId: null } }); } catch { dupAssignment = true; }
  check("duplicate flow assignment with empty columns is blocked", dupAssignment);
  let dupRole = false;
  try { await assign(eng1.id, approverRole.id, p1.id); } catch { dupRole = true; }
  check("duplicate role assignment is blocked", dupRole);
  let badEntry = false;
  try { await prisma.documentWorkflowStepApprover.create({ data: { stepId: (await prisma.documentWorkflowStep.findFirstOrThrow()).id, approverType: "USER", userId: mgr.id, userTypeId: types.eng.id } }); } catch { badEntry = true; }
  check("an approver entry cannot be both a user and a user type", badEntry);
  let selfDelegation = false;
  try { await prisma.approvalDelegation.create({ data: { delegatorUserId: mgr.id, delegateUserId: mgr.id, createdById: admin.id } }); } catch { selfDelegation = true; }
  check("a user cannot delegate to themselves", selfDelegation);

  // ---------- deletion ----------
  section("Deleting a document that sits in a process run");
  const paths = await prisma.$transaction((tx) => deleteDocumentRecords(tx, [mr1b.doc.id]));
  check("deleted without a foreign-key error", paths.length === 1 && (await prisma.document.count({ where: { id: mr1b.doc.id } })) === 0);

  console.log(`\n${passed} checks passed, ${failed} failed.`);
  await prisma.$disconnect();
  process.exit(failed === 0 ? 0 : 1);
}

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exit(1);
});
