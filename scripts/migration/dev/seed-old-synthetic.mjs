#!/usr/bin/env node
// scripts/migration/dev/seed-old-synthetic.mjs
//
// TEST DATA ONLY. Generates a synthetic copy of the OLD system's data (SQL on stdout) plus matching dummy
// files on disk, so the audit and migration scripts can be rehearsed without real data.
//
//   node scripts/migration/dev/seed-old-synthetic.mjs --files /tmp/pmv-old-uploads --legacy /tmp/pmv-old-app > old-seed.sql
//   psql <olddb> -f old-seed.sql
//
// It deliberately contains the awkward cases found in the old code (hard-coded accounts, temp accounts, ERR
// escalation routes, AVK/Ready-Mix special flows, POs linked to several MRs, missing files...). Every deliberately
// planted problem is listed in PLANTED at the bottom of this file, so tests can assert it is detected.

import fs from "node:fs";
import path from "node:path";

function arg(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index !== -1 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}
const FILES_ROOT = arg("files", "/tmp/pmv-old-uploads");
const LEGACY_ROOT = arg("legacy", "/tmp/pmv-old-app");

const sql = [];
let idCounter = 0;
const id = (prefix = "c") => `${prefix}${String(++idCounter).padStart(7, "0")}x`;
const q = (value) => {
  if (value === null || value === undefined) return "NULL";
  if (value instanceof Date) return `'${value.toISOString()}'`;
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  if (typeof value === "number") return String(value);
  return `'${String(value).replace(/'/g, "''")}'`;
};
function ins(table, row) {
  const columns = Object.keys(row);
  sql.push(`INSERT INTO "${table}" (${columns.map((c) => `"${c}"`).join(", ")}) VALUES (${columns.map((c) => q(row[c])).join(", ")});`);
  return row.id;
}

// ---- time ------------------------------------------------------------------------------------
let clock = new Date("2025-11-03T08:00:00Z").getTime();
const tick = (minutes = 60) => new Date((clock += minutes * 60_000));

// ---- files -----------------------------------------------------------------------------------
const fileList = [];
function makeFile(relativePath, { size = 64, onDisk = true, base = FILES_ROOT, bytes } = {}) {
  const content = bytes ?? Buffer.from(`%PDF-1.4 synthetic ${relativePath}\n`.padEnd(size, "."));
  if (onDisk) {
    const full = path.join(base, ...relativePath.split("/"));
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  }
  fileList.push(relativePath);
  return { size: content.length };
}

sql.push("BEGIN;");
sql.push(`TRUNCATE "ErrNotification","ErrApprovalHistory","ErrFile","ErrDownload","Err","ErrUserAccess","ErrProject","PurchaseOrderInvoice","PurchaseOrderMrLink","PurchaseOrder","DocumentDownload","ApprovalHistory","DeletionRequest","DocumentVersion","Document","DocumentWorkflowStep","DocumentWorkflowTemplate","EmailNotificationEvent","Notification","AuditLog","TrustedDevice","OtpChallenge","PasswordResetToken","UserRoleAssignment","User" CASCADE;`);

// ---- users -----------------------------------------------------------------------------------
const HASH = "$2b$12$abcdefghijklmnopqrstuuYq9s2m0n5C9lD8mYV0p3QJ1Vz6x1r1e"; // fake bcrypt-shaped hash
const users = {};
function user(key, email, name, role, location = null, extra = {}) {
  users[key] = ins("User", { id: id("u"), name, email, passwordHash: HASH, role, location, createdAt: tick(1), updatedAt: tick(1), ...extra });
  return users[key];
}
user("admin", "admin@ahmadiah.com", "System Admin", "ADMIN");
user("dispatcher", "dispatcher.pmv@ahmadiah.com", "ERRO Almacen", "CLERK", "AVR");
user("mehieddine", "mohammad.mehieddine@ahmadiah.com", "Mohammad Mehieddine", "APPROVER_1", "AVR");
user("joemar", "joemar.paraiso@ahmadiah.com", "Joemar Paraiso", "APPROVER_1", "AVK");
user("bernabie", "bernabie.rocha@ahmadiah.com", "Bernabie Rocha", "CLERK", "AVK");
user("mahran", "mohamed.mahran@ahmadiah-sa.com", "Mohamed Mahran", "CLERK", "AVK");
user("omar", "omar.merzek@ahmadiah.com", "Omar Merzek", "CLERK", "KUWAIT");
user("george", "george.azzi@ahmadiah.com", "George Azzi", "APPROVER_2", "KUWAIT");
user("marc", "marc.baddour@ahmadiah.com", "Marc Baddour", "APPROVER_3", "KUWAIT");
user("aqueel", "aqueel.sayed@ahmadiah.com", "Aqueel Sayed", "CLERK", "KUWAIT");
user("mmahmoud", "mohamed.mahmoud@ahmadiah.com", "Mohamed Mahmoud", "CLERK", "KUWAIT");
user("shawky", "mohamed.shawky@ahmadiah.com", "Mohamed Shawky", "CLERK", "KUWAIT");
user("jad", "jad.kabalan@ahmadiah.com", "Jad Kabalan", "CLERK", "KUWAIT");
user("muneer", "muneer.kottappuram@ahmadiah.com", "Muneer Kottappuram", "CLERK", "KUWAIT");
user("ramzi", "ramzi@ahmadiah.com", "Ramzi Abou Chakra", "ERR_USER");
user("elie", "elie.azzam@ahmadiah.com", "Elie Azzam", "ERR_USER");
user("reine", "reine.alsouki@ahmadiah.com", "Reine Al Souki", "ERR_USER");
// edmond.houeiss@ahmadiah.com is deliberately NOT created (named in the code, missing in the database)
user("dir1", "director.alpha@ahmadiah.com", "Alpha Director", "ERR_USER");
user("dir2", "director.beta@ahmadiah.com", "Beta Director", "ERR_USER");
user("pm1", "pm.alpha@ahmadiah.com", "Alpha Project Manager", "ERR_USER");
user("acting", "acting.ceo@ahmadiah.com", "Acting CEO", "ERR_USER");
user("ceo", "ceo@ahmadiah.com", "The CEO", "ERR_USER");
user("errviewer", "err.viewer@ahmadiah.com", "ERR Viewer", "ERR_USER");
user("ksa", "ksa.viewer@ahmadiah.com", "KSA Viewer", "KSA_VIEWER");
user("noerracc", "err.noaccess@ahmadiah.com", "ERR No Access", "ERR_USER"); // planted: ERR_USER without access rows
user("nolocation", "clerk.nolocation@ahmadiah.com", "Clerk No Location", "CLERK"); // planted: clerk without location
user("tempdoc", "aqueel.sayed@example.com", "Aqueel (temp)", "CLERK", "KUWAIT"); // planted: temp account that owns a document
user("temporphan", "orphan@role-migration.local", "Orphan", "CLERK"); // planted: temp account, no records
user("dupcase", "Jad.Kabalan@Ahmadiah.com", "Jad Duplicate", "CLERK", "KUWAIT"); // planted: email differing only by case
ins("UserRoleAssignment", { id: id("ura"), userId: users.joemar, role: "CLERK" });
ins("UserRoleAssignment", { id: id("ura"), userId: users.marc, role: "APPROVER_2" });
sql.push(`UPDATE "User" SET "signaturePath" = 'signatures/marc.png', "signatureFileSize" = 40, "signatureMimeType" = 'image/png', "signatureOriginalName" = 'marc.png', "signatureUpdatedAt" = NOW() WHERE id = ${q(users.marc)};`);
makeFile("signatures/marc.png", { size: 40 });

// ---- ERR projects and access -----------------------------------------------------------------
const projects = {};
function project(key, name, country, directorKey) {
  projects[key] = ins("ErrProject", { id: id("p"), name, country, directorId: directorKey ? users[directorKey] : null, isActive: true, createdAt: tick(1), updatedAt: tick(1) });
}
project("alpha", "Project Alpha", "KUWAIT", "dir1");
project("beta", "Project Beta", "KUWAIT", "dir2");
project("gamma", "Project Gamma", "KUWAIT", "dir1");
project("riyadh", "Riyadh Metro", "KSA", null); // planted: KSA project
project("orphan", "Orphan Project", "KUWAIT", null); // planted: no director/manager

function access(userKey, role, projectKey = null) {
  ins("ErrUserAccess", { id: id("ea"), userId: users[userKey], role, projectId: projectKey ? projects[projectKey] : null, isActive: true, createdAt: tick(1), updatedAt: tick(1) });
}
access("dir1", "PROJECT_DIRECTOR", "alpha");
access("dir1", "PROJECT_DIRECTOR", "gamma");
access("dir2", "PROJECT_DIRECTOR", "beta");
access("pm1", "PROJECT_MANAGER", "alpha");
access("reine", "UPLOADER");
access("aqueel", "UPLOADER", "beta");
access("acting", "ACTING_CEO");
access("ceo", "CEO");
access("errviewer", "VIEWER");
access("ksa", "VIEWER", "riyadh");

// ---- workflow template (database-configured flow) --------------------------------------------
const tpl = ins("DocumentWorkflowTemplate", { id: id("t"), name: "Kuwait MR", location: "KUWAIT", documentType: "MATERIAL_REQUISITION", documentSubtype: null, projectName: null, isActive: true, createdAt: tick(1), updatedAt: tick(1) });
ins("DocumentWorkflowStep", { id: id("ts"), templateId: tpl, stepNumber: 1, role: "APPROVER_2", approverUserId: users.george, isRequired: true });
ins("DocumentWorkflowStep", { id: id("ts"), templateId: tpl, stepNumber: 2, role: "APPROVER_3", approverUserId: users.marc, isRequired: true });

// ---- documents -------------------------------------------------------------------------------
let docSeq = 0;
let custodySeq = 0;
const docs = {};

/**
 * chain: the people who approve in order. status:
 *   APPROVED | REJECTED | PENDING_n (n approvals done) | REVISION
 */
function addDoc(key, o) {
  const created = tick(30);
  const number = o.number ?? (o.type === "CUSTODY" ? `C${String(++custodySeq).padStart(4, "0")}` : `DOC-${String(++docSeq).padStart(4, "0")}`);
  const chain = o.chain ?? [];
  let status = "APPROVED";
  let approverId = null;
  let stepNo = null;
  if (o.status === "REJECTED") status = "REJECTED";
  else if (o.status === "REVISION") status = "REVISION_REQUIRED";
  else if (o.status?.startsWith("PENDING_")) {
    const done = Number(o.status.split("_")[1]);
    status = `PENDING_APPROVER_${Math.min(done + 1, 3)}`;
    approverId = users[chain[done]];
    stepNo = done + 1;
  }
  const docId = id("d");
  docs[key] = docId;
  ins("Document", {
    id: docId,
    documentNumber: number,
    title: o.title ?? `${key} document`,
    description: o.description ?? null,
    status,
    currentVersion: o.versions ? o.versions - 1 : 0,
    createdAt: created,
    updatedAt: created,
    createdById: users[o.by],
    currentApproverId: approverId,
    uploaderLocation: o.location ?? null,
    projectName: o.projectName ?? null,
    workflowTemplateId: o.template ? tpl : null,
    currentWorkflowStep: o.template ? stepNo : null,
    documentType: o.type,
    comparisonType: o.type === "COMPARISON" ? o.sub : null,
    mrType: o.type === "MATERIAL_REQUISITION" ? o.sub : null,
    currentApproverAssignedAt: approverId ? tick(5) : null,
    mrNumber: o.mrNumber ?? null,
    relatedComparisonId: o.linkTo ? docs[o.linkTo] : null,
    lastActiveStage: status,
  });
  const versions = o.versions ?? 1;
  const versionIds = [];
  for (let v = 0; v < versions; v += 1) {
    const folder = o.folder ?? "MRs/KSA/AVR/MRs Cash";
    const rel = `${folder}/${o.title ?? key}-v${v}-${number}.pdf`;
    const missing = o.missingFile === v;
    const mismatch = o.sizeMismatch === v;
    const f = makeFile(rel, { size: 80 + v, onDisk: !missing });
    versionIds.push(
      ins("DocumentVersion", {
        id: id("v"), documentId: docId, versionNumber: v, filePath: rel, storageFolder: folder, originalName: `${o.title ?? key}.pdf`, extension: "pdf",
        mimeType: "application/pdf", fileSize: mismatch ? f.size + 7 : f.size, uploadedAt: tick(1), uploadedById: users[o.by],
      }),
    );
  }
  ins("ApprovalHistory", { id: id("h"), documentId: docId, action: "SUBMITTED", comments: "Submitted by Clerk", performedAt: tick(1), performedById: users[o.by], versionId: versionIds[0] });
  const done = o.status?.startsWith("PENDING_") ? Number(o.status.split("_")[1]) : status === "APPROVED" ? chain.length : o.status === "REJECTED" ? Math.max(chain.length - 1, 0) : Math.max(chain.length - 1, 0);
  for (let i = 0; i < done; i += 1) {
    ins("ApprovalHistory", { id: id("h"), documentId: docId, action: "APPROVED", comments: null, performedAt: tick(20), performedById: users[chain[i]], versionId: versionIds[versionIds.length - 1] });
  }
  if (o.status === "REJECTED") ins("ApprovalHistory", { id: id("h"), documentId: docId, action: "REJECTED", comments: "Not acceptable", performedAt: tick(20), performedById: users[chain[done]] });
  if (o.status === "REVISION") ins("ApprovalHistory", { id: id("h"), documentId: docId, action: "REQUESTED_REVISION", comments: "Fix the totals", performedAt: tick(20), performedById: users[chain[done]] });
  if (o.downloadedBy) for (const who of o.downloadedBy) ins("DocumentDownload", { id: id("dd"), documentId: docId, userId: users[who], downloadedAt: tick(10) });
  return docId;
}

const AVR = "MRs/KSA/AVR";
const AVK = "MRs/KSA/AVK";
const KWT = "MRs/Kuwait";
// AVR (hard-coded: A1 Mehieddine > A2 George > A3 Marc)
addDoc("avrComp", { by: "dispatcher", location: "AVR", type: "COMPARISON", sub: "OTHER", chain: ["mehieddine", "george", "marc"], folder: `${AVR}/Comparisons`, downloadedBy: ["marc"] });
addDoc("avrMr", { by: "dispatcher", location: "AVR", type: "MATERIAL_REQUISITION", sub: "CASH", chain: ["mehieddine", "george", "marc"], linkTo: "avrComp", mrNumber: "MR-100", folder: `${AVR}/MRs Cash` });
addDoc("avrMrCredit", { by: "dispatcher", location: "AVR", type: "MATERIAL_REQUISITION", sub: "CREDIT", chain: ["mehieddine", "george", "marc"], mrNumber: "MR-101", folder: `${AVR}/MRs Credit`, versions: 2 });
// AVK (Joemar > George > Marc for comparisons; MR from Bernabie = Ramzi > Marc)
addDoc("avkComp", { by: "bernabie", location: "AVK", type: "COMPARISON", sub: "SPARE_PARTS", chain: ["joemar", "george", "marc"], folder: `${AVK}/Comparisons` });
addDoc("avkMr", { by: "bernabie", location: "AVK", type: "MATERIAL_REQUISITION", sub: "CREDIT", chain: ["ramzi", "marc"], linkTo: "avkComp", mrNumber: "MR-200", folder: `${AVK}/MRs Credit` });
addDoc("avkMr2", { by: "mahran", location: "AVK", type: "MATERIAL_REQUISITION", sub: "CASH", chain: ["ramzi", "marc"], mrNumber: "MR-200", folder: `${AVK}/MRs Cash` }); // planted: duplicate MR number
// Kuwait (configured template for MRs; hard-coded George > Marc for comparisons)
addDoc("kwComp", { by: "aqueel", location: "KUWAIT", type: "COMPARISON", sub: "SPARE_PARTS", chain: ["george", "marc"], folder: `${KWT}/Comparisons` });
addDoc("kwMr", { by: "aqueel", location: "KUWAIT", type: "MATERIAL_REQUISITION", sub: "CASH", chain: ["george", "marc"], template: true, linkTo: "kwComp", mrNumber: "MR-300", folder: `${KWT}/MRs Cash` });
addDoc("kwMr2", { by: "mmahmoud", location: "KUWAIT", type: "MATERIAL_REQUISITION", sub: "CREDIT", chain: ["george", "marc"], template: true, mrNumber: "MR-301", folder: `${KWT}/MRs Credit` });
addDoc("kwMrNoNumber", { by: "shawky", location: "KUWAIT", type: "MATERIAL_REQUISITION", sub: "CASH", chain: ["george", "marc"], template: true, folder: `${KWT}/MRs Cash` }); // planted: MR without MR number
// Ready Mix Khobar (single approver: Elie)
addDoc("rmComp", { by: "dispatcher", location: "AVR", projectName: "Ready Mix Khobar", type: "COMPARISON", sub: "OTHER", chain: ["elie"], folder: "MRs/KSA/Ready Mix Khobar/Comparisons" });
addDoc("rmMr", { by: "dispatcher", location: "AVR", projectName: "Ready Mix Khobar", type: "MATERIAL_REQUISITION", sub: "CASH", chain: ["elie"], linkTo: "rmComp", mrNumber: "MR-400", folder: "MRs/KSA/Ready Mix Khobar/MRs Cash" });
// Custody (Marc only)
addDoc("custody1", { by: "dispatcher", location: "AVR", type: "CUSTODY", sub: null, chain: ["marc"], folder: "Custody Files/AVR" });
addDoc("custody2", { by: "dispatcher", location: "AVR", type: "CUSTODY", sub: null, chain: ["marc"], folder: "Custody Files/AVR" });
// In flight
addDoc("flightA2", { by: "aqueel", location: "KUWAIT", type: "MATERIAL_REQUISITION", sub: "CASH", chain: ["george", "marc"], status: "PENDING_0", template: true, mrNumber: "MR-310", folder: `${KWT}/MRs Cash` });
addDoc("flightA3", { by: "dispatcher", location: "AVR", type: "COMPARISON", sub: "OTHER", chain: ["mehieddine", "george", "marc"], status: "PENDING_2", folder: `${AVR}/Comparisons` });
addDoc("flightA1", { by: "dispatcher", location: "AVR", type: "MATERIAL_REQUISITION", sub: "CASH", chain: ["mehieddine", "george", "marc"], status: "PENDING_0", mrNumber: "MR-102", folder: `${AVR}/MRs Cash` });
addDoc("revision1", { by: "jad", location: "KUWAIT", type: "COMPARISON", sub: "OTHER", chain: ["george", "marc"], status: "REVISION", folder: `${KWT}/Comparisons`, versions: 2 });
addDoc("rejected1", { by: "jad", location: "KUWAIT", type: "MATERIAL_REQUISITION", sub: "CASH", chain: ["george", "marc"], status: "REJECTED", template: true, mrNumber: "MR-302", folder: `${KWT}/MRs Cash` });
// Planted problems
addDoc("tempOwned", { by: "tempdoc", location: "KUWAIT", type: "COMPARISON", sub: "OTHER", chain: ["george", "marc"], folder: `${KWT}/Comparisons` }); // temp account owns a document
addDoc("oddNumber", { by: "omar", location: "KUWAIT", type: "COMPARISON", sub: "OTHER", chain: ["george", "marc"], number: "DOC-12", folder: `${KWT}/Comparisons` }); // number not following the pattern
addDoc("missingFile", { by: "omar", location: "KUWAIT", type: "COMPARISON", sub: "OTHER", chain: ["george", "marc"], folder: `${KWT}/Comparisons`, missingFile: 0 });
addDoc("sizeMismatch", { by: "omar", location: "KUWAIT", type: "COMPARISON", sub: "OTHER", chain: ["george", "marc"], folder: `${KWT}/Comparisons`, sizeMismatch: 0 });
// A document whose location differs from its uploader's current location
sql.push(`UPDATE "Document" SET "uploaderLocation" = 'AVR' WHERE id = ${q(docs.kwComp)};`);

// A legacy "uploads/..." path file (stored relative to the old app folder)
{
  const rel = "uploads/legacy-doc.pdf";
  makeFile(rel, { base: LEGACY_ROOT, size: 90 });
  const legacyDoc = addDoc("legacy", { by: "omar", location: "KUWAIT", type: "COMPARISON", sub: "OTHER", chain: ["george", "marc"], folder: `${KWT}/Comparisons` });
  sql.push(`UPDATE "DocumentVersion" SET "filePath" = ${q(rel)}, "fileSize" = 90 WHERE "documentId" = ${q(legacyDoc)};`);
}
// Two versions pointing at the same file (planted: shared path)
{
  const sharedPath = `${KWT}/Comparisons/shared.pdf`;
  makeFile(sharedPath, { size: 70 });
  for (const key of ["sharedA", "sharedB"]) {
    const d = addDoc(key, { by: "omar", location: "KUWAIT", type: "COMPARISON", sub: "OTHER", chain: ["george", "marc"], folder: `${KWT}/Comparisons` });
    sql.push(`UPDATE "DocumentVersion" SET "filePath" = ${q(sharedPath)}, "fileSize" = 70 WHERE "documentId" = ${q(d)};`);
  }
}
// An orphan file on disk that no record points to
makeFile("orphans/forgotten.pdf", { size: 50 });
sql.push(`INSERT INTO "DocumentNumberSequence" (id, "lastNumber", "updatedAt") VALUES (1, ${docSeq + 5}, NOW()) ON CONFLICT (id) DO UPDATE SET "lastNumber" = EXCLUDED."lastNumber";`);
sql.push(`INSERT INTO "CustodyFileSequence" (id, "nextNumber", "updatedAt") VALUES (1, ${custodySeq + 1}, NOW()) ON CONFLICT (id) DO UPDATE SET "nextNumber" = EXCLUDED."nextNumber";`);

// ---- ERRs ------------------------------------------------------------------------------------
let errSeq = 0;
const errs = {};
/**
 * route: the stage:actor decisions that happened.
 */
function addErr(key, o) {
  const created = tick(40);
  const number = `ERR-${String(++errSeq).padStart(6, "0")}`;
  const errId = id("e");
  errs[key] = errId;
  ins("Err", {
    id: errId, documentNumber: number, title: o.title ?? key, type: o.type, status: o.status ?? "APPROVED", currentStage: o.stage ?? "PMV_MANAGER",
    nextApprovalPath: o.nextPath ?? null, createdById: users[o.by], projectDirectorId: users[o.director], currentApproverId: o.current ? users[o.current] : null,
    currentApproverAssignedAt: o.current ? tick(3) : null, revisionNumber: o.revisions ?? 1, createdAt: created, updatedAt: created,
    approvedAt: o.status === "APPROVED" || !o.status ? tick(1) : null, projectId: o.project ? projects[o.project] : null, projectNameSnapshot: o.project ? null : o.snapshot ?? null,
  });
  const folder = o.project ? `ERRs/Kuwait/${key}` : `ERRs/MARC Only/${o.type}/${key}`;
  const files = [];
  const addFile = (kind, version, name, missing = false) => {
    const rel = `${folder}/${name}`;
    const f = makeFile(rel, { size: 100 + version, onDisk: !missing });
    return ins("ErrFile", { id: id("ef"), errId, kind, versionNumber: version, revisionNumber: 1, filePath: rel, storageFolder: folder, originalName: name, mimeType: "application/pdf", fileSize: f.size, uploadedById: users[o.by], createdAt: tick(1) });
  };
  const pdf = addFile("ERR_PDF", 1, `${key}.pdf`);
  for (let i = 1; i <= (o.quotations ?? 0); i += 1) addFile("QUOTATION", i, `${key}-quotation-${i}.pdf`);
  if (o.release) addFile("RELEASE_VOUCHER", 1, `${key}-release.pdf`);
  if (o.receipt) addFile("RECEIPT_VOUCHER", 1, `${key}-receipt.pdf`);
  if (o.attachment) addFile("ATTACHMENT", 1, `${key}-attachment.pdf`);
  ins("ErrApprovalHistory", { id: id("eh"), errId, performedById: users[o.by], action: "SUBMITTED", stage: null, revisionNumber: 1, outputFileId: pdf, performedAt: tick(1) });
  for (const step of o.route ?? []) {
    const [action, stage, actor] = step.split(":");
    ins("ErrApprovalHistory", { id: id("eh"), errId, performedById: users[actor], action, stage, revisionNumber: 1, inputFileId: pdf, outputFileId: pdf, performedAt: tick(15) });
  }
  if (o.pendingEmail) {
    ins("ErrNotification", { id: id("en"), errId, recipientId: users[o.pendingEmail], type: "APPROVAL_PENDING", eventKey: `${errId}-pending`, title: "ERR awaiting review", message: number, emailEnabled: true, nextEmailAt: tick(1) });
  }
  if (o.downloadedBy) for (const who of o.downloadedBy) ins("ErrDownload", { id: id("ed"), errId, userId: users[who], downloadedAt: tick(10) });
}
addErr("rentalActc", { type: "RENTAL_ACTC", by: "reine", director: "dir1", project: "alpha", route: ["APPROVED:PROJECT_DIRECTOR:dir1", "FINALIZED_APPROVAL:PMV_MANAGER:marc"], quotations: 1, release: true, receipt: true, downloadedBy: ["reine"] });
addErr("purchaseFull", { type: "PURCHASE", by: "reine", director: "dir1", project: "alpha", route: ["APPROVED:PROJECT_DIRECTOR:dir1", "ESCALATED_TO_ACTING_CEO:PMV_MANAGER:marc", "ESCALATED_TO_CEO:ACTING_CEO:acting", "FINALIZED_APPROVAL:CEO:ceo"], quotations: 2, nextPath: "ACTING_CEO_THEN_CEO" });
addErr("purchaseFinalize", { type: "PURCHASE", by: "reine", director: "dir2", project: "beta", route: ["APPROVED:PROJECT_DIRECTOR:dir2", "FINALIZED_APPROVAL:PMV_MANAGER:marc"], quotations: 3, attachment: true });
addErr("purchaseCeoOnly", { type: "PURCHASE", by: "reine", director: "dir2", project: "beta", route: ["APPROVED:PROJECT_DIRECTOR:dir2", "ESCALATED_TO_CEO:PMV_MANAGER:marc", "FINALIZED_APPROVAL:CEO:ceo"], nextPath: "CEO" });
addErr("renewalPending", { type: "RENEWAL", by: "aqueel", director: "dir2", project: "beta", status: "PENDING", stage: "PMV_MANAGER", current: "marc", route: ["APPROVED:PROJECT_DIRECTOR:dir2"], pendingEmail: "marc" });
addErr("onHold", { type: "RENTAL_EXTERNAL", by: "reine", director: "dir1", project: "gamma", status: "ON_HOLD", stage: "PROJECT_DIRECTOR", current: "dir1", route: ["PUT_ON_HOLD:PROJECT_DIRECTOR:dir1"] });
addErr("revisionErr", { type: "RENTAL_ACTC", by: "reine", director: "dir1", project: "alpha", status: "REVISION_REQUIRED", stage: "PMV_MANAGER", route: ["APPROVED:PROJECT_DIRECTOR:dir1", "REQUESTED_REVISION:PMV_MANAGER:marc"], revisions: 2 });
addErr("rejectedErr", { type: "RENTAL_ACTC", by: "reine", director: "dir1", project: "gamma", status: "REJECTED", stage: "PROJECT_DIRECTOR", route: ["REJECTED:PROJECT_DIRECTOR:dir1"] });
addErr("noProject", { type: "PURCHASE", by: "reine", director: "dir1", snapshot: "Legacy Project X", route: ["APPROVED:PROJECT_DIRECTOR:dir1", "FINALIZED_APPROVAL:PMV_MANAGER:marc"] }); // planted: ERR without a project
addErr("ksaErr", { type: "RENTAL_ACTC", by: "reine", director: "dir1", project: "riyadh", route: ["APPROVED:PROJECT_DIRECTOR:dir1", "FINALIZED_APPROVAL:PMV_MANAGER:marc"] });
sql.push(`DELETE FROM "ErrFile" WHERE kind = 'ERR_PDF' AND "errId" = ${q(errs.noProject)} AND FALSE;`); // (kept for symmetry; E8 planted below)
// planted: an ERR with no ERR_PDF at all
{
  const eid = id("e");
  ins("Err", { id: eid, documentNumber: `ERR-${String(++errSeq).padStart(6, "0")}`, title: "No pdf", type: "RENEWAL", status: "PENDING", currentStage: "PROJECT_DIRECTOR", createdById: users.reine, projectDirectorId: users.dir1, currentApproverId: users.dir1, projectId: projects.alpha, updatedAt: tick(1) });
}
sql.push(`INSERT INTO "ErrSequence" (id, "nextNumber", "updatedAt") VALUES (1, ${errSeq + 1}, NOW()) ON CONFLICT (id) DO UPDATE SET "nextNumber" = EXCLUDED."nextNumber";`);

// ---- Purchase orders and invoices --------------------------------------------------------------
let poSeq = 0;
const pos = {};
function addPo(key, o) {
  const number = `PO-${String(++poSeq).padStart(6, "0")}`;
  const rel = `${o.folder}/${number}.pdf`;
  const f = makeFile(rel, { size: 120 });
  pos[key] = ins("PurchaseOrder", { id: id("po"), poNumber: number, originalName: `${number}.pdf`, description: null, filePath: rel, mimeType: "application/pdf", fileSize: f.size, uploadedAt: tick(30), uploadedById: users[o.by], receivedAt: o.received ? tick(60) : null, receivedById: o.received ? users.muneer : null });
  for (const mr of o.mrs ?? []) ins("PurchaseOrderMrLink", { id: id("pl"), purchaseOrderId: pos[key], documentId: docs[mr], createdAt: tick(2), createdById: users[o.by] });
}
addPo("poAvr", { by: "dispatcher", mrs: ["avrMr"], folder: `${AVR}/POs` });
addPo("poKwt", { by: "aqueel", mrs: ["kwMr", "kwMr2"], folder: `${KWT}/POs`, received: true });
addPo("poMixed", { by: "omar", mrs: ["kwMr", "avrMr"], folder: `${KWT}/POs` }); // planted: linked MRs in two locations
addPo("poUnlinked", { by: "omar", mrs: [], folder: `${KWT}/POs` }); // planted: PO without a link
addPo("poPendingMr", { by: "omar", mrs: ["flightA2"], folder: `${KWT}/POs` }); // planted: linked MR is not approved
sql.push(`INSERT INTO "PurchaseOrderSequence" (id, "nextNumber", "updatedAt") VALUES (1, ${poSeq + 1}, NOW()) ON CONFLICT (id) DO UPDATE SET "nextNumber" = EXCLUDED."nextNumber";`);

function addInvoice(o) {
  const rel = `${o.folder}/invoice-${++idCounter}.pdf`;
  const f = makeFile(rel, { size: 60 });
  ins("PurchaseOrderInvoice", { id: id("pi"), purchaseOrderId: o.po ? pos[o.po] : null, documentId: o.doc ? docs[o.doc] : null, originalName: "invoice.pdf", filePath: rel, mimeType: "application/pdf", fileSize: f.size, uploadedAt: tick(10), uploadedById: users.muneer });
}
addInvoice({ po: "poKwt", folder: `${KWT}/Invoices` });
addInvoice({ doc: "kwMr", folder: `${KWT}/Invoices` });

// ---- Notifications, e-mail events, audit, deletion ------------------------------------------------
const emailTypes = [
  ["APPROVAL_PENDING", "flightA2"],
  ["APPROVAL_PENDING", "kwMr"], // document already approved: stale
  ["WORKFLOW_APPROVED", "kwMr"],
  ["COMPARISON_MR_OVERDUE", "avrComp"],
  ["PURCHASE_ORDER_AVAILABLE", null],
  ["ERR_WORKFLOW_UPDATE", null],
];
for (const [type, docKey] of emailTypes) {
  ins("EmailNotificationEvent", { id: id("en"), recipientId: users.marc, type, documentId: docKey ? docs[docKey] : errs.renewalPending, emailDueAt: tick(5), emailSent: false });
}
ins("EmailNotificationEvent", { id: id("en"), recipientId: users.george, type: "APPROVAL_PENDING", documentId: docs.kwMr, emailDueAt: tick(5), emailSent: true });
ins("Notification", { id: id("n"), userId: users.marc, type: "PENDING_APPROVAL", title: "Document awaiting your review", message: "DOC-0001", documentId: docs.avrComp, isRead: true });
ins("Notification", { id: id("n"), userId: users.marc, type: "PENDING_APPROVAL", title: "Document awaiting your review", message: "ghost", documentId: "does-not-exist", isRead: false }); // planted: orphan notification
ins("AuditLog", { id: id("a"), documentId: docs.avrComp, performedById: users.marc, action: "DOCUMENT_APPROVED", details: "{}" });
ins("AuditLog", { id: id("a"), documentId: "gone", performedById: users.marc, action: "DOCUMENT_DELETED", details: "{}" });
ins("DeletionRequest", { id: id("dr"), documentId: docs.rejected1, requestedById: users.jad, approver3Id: users.marc, status: "PENDING", reason: "Duplicate" });
ins("TrustedDevice", { id: id("td"), userId: users.reine, tokenHash: "x", expiresAt: new Date("2027-01-01") });

sql.push("COMMIT;");
process.stdout.write(sql.join("\n") + "\n");
process.stderr.write(`Seed generated: ${docSeq} documents, ${custodySeq} custody, ${errSeq} ERRs, ${poSeq} POs, ${fileList.length} files.\n`);

// What the audit is expected to detect (used by the test script).
export const PLANTED = [
  "B3 temp account owning a document", "B4 case-colliding email", "B5 clerk without location", "B7 missing hard-coded account (edmond.houeiss)",
  "B10 ERR_USER without access rows", "C4 odd document number", "C9 location mismatch", "C15 duplicate/missing MR numbers", "E3 KSA project", "E4 project without director",
  "E5 ERR without project", "E8 ERR without PDF", "E9 attachment", "F3 PO across locations", "F4 PO linked to unapproved MR", 
  "H3 orphan notification", "I2 shared file path", "I3 missing file", "I4 size mismatch", "I6 orphan file on disk",
];
