#!/usr/bin/env node
// scripts/migration/stage4-documents.mjs
//
// STAGE 4: the documents module of the old system (Material Requisitions, Comparisons, Custody files): the document records,
// their file record, approval steps, approval history, per-user downloads, the audit log and the MR number.
// It does NOT copy files (Stage 6 does, using the file map written here) and does NOT link purchase orders / processes (later stage).
// Needs Stages 1 to 3. Runs in BATCHES: pick what to migrate with the filters, dry-run, check the plan, then --apply.
//
//   node scripts/migration/stage4-documents.mjs --old-url <old copy> --new-url <new db> --batch <name>
//        [--types MR,COMP,CUSTODY] [--projects AVK,AVR,RMX,KWT] [--from 2026-09-01] [--to 2026-10-01] [--limit 50] [--ids id1,id2]
//        [--mr-numbers file1.csv,file2.csv]   MR numbers from extract-mr-numbers.mjs (proposed + filled-in missing)
//        [--upload-root "<old uploads folder>"]  checks every file exists and records its real size
//        [--apply] [--out ./migration-output]
//
// Document numbers are assigned over ALL old documents (oldest first, per type + sub type + year), so a document gets the same
// new number no matter in which batch it is migrated. Already-migrated documents are skipped, so batches can be repeated.

import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { arg, flag, lit, openDb, stableId } from "./lib/db.mjs";

const OLD_URL = arg("old-url", "OLD_DATABASE_URL");
const NEW_URL = arg("new-url", "NEW_DATABASE_URL");
const BATCH = arg("batch");
const UPLOAD_ROOT = arg("upload-root", "OLD_UPLOAD_ROOT");
const OUT = arg("out") || "./migration-output";
const APPLY = flag("apply");
const csvList = (value) => (value ? value.split(",").map((s) => s.trim()).filter(Boolean) : null);
const F_TYPES = csvList(arg("types")), F_PROJECTS = csvList(arg("projects")), F_IDS = csvList(arg("ids"));
const F_FROM = arg("from"), F_TO = arg("to"), F_LIMIT = arg("limit") ? Number(arg("limit")) : null;
const MR_FILES = csvList(arg("mr-numbers"));
if (!OLD_URL || !NEW_URL || !BATCH) { console.error("Need --old-url, --new-url and --batch <name>."); process.exit(2); }
if (!F_TYPES && !F_PROJECTS && !F_IDS && !F_LIMIT && !F_FROM && !F_TO) { console.error("Choose what to migrate with --types / --projects / --from / --to / --limit / --ids."); process.exit(2); }

const TYPE_CODE = { MATERIAL_REQUISITION: "MR", COMPARISON: "COMP", CUSTODY: "CUSTODY" };
const LOCATION_PROJECT = { KUWAIT: "KWT", AVK: "AVK", AVR: "AVR" };
const LEGACY_AQUEEL = "aqueel.sayed@ahmadiah.com";
const clean = (e) => String(e ?? "").trim().toLowerCase();

// ---- same helpers as the new system (src/lib/storage-layout.ts, src/lib/files.ts) ----------------------------------
function safeFolder(value) {
  const original = value.trim();
  let safe = original.replace(/[%<>:"/\\|?*\u0000-\u001f]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0")}`);
  safe = safe.replace(/[. ]+$/g, (end) => Array.from(end, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`).join(""));
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(safe)) safe = `%${safe.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0")}${safe.slice(1)}`;
  if (safe.length <= 96) return safe;
  return `${safe.slice(0, 96 - 12 - 1)}-${createHash("sha256").update(original).digest("hex").slice(0, 12)}`;
}
const storageFolder = (location, project, type, sub) => ["Documents", safeFolder(location || "No Location"), safeFolder(project || "No Project"), safeFolder(type), ...(sub ? [safeFolder(sub)] : [])].join("/");
const safeFileName = (n) => n.replace(/[\\/:*?"<>|]/g, "_");
function newFileName(originalName, number, versionNumber, extension) {
  let base = originalName.replace(/\.[^.]+$/, "").replace(/-(?:v\d+|DOC-\d+|signed)(?=-|$)/gi, "").replace(/-+$/, "").trim();
  if (!base) base = "Document";
  return safeFileName(`${base}-v${versionNumber}-${number}`) + (extension ? `.${extension}` : "");
}

// ---- Read -------------------------------------------------------------------------------------------------------------
const oldDb = await openDb(OLD_URL, { readOnly: true });
const newDb = await openDb(NEW_URL);

const docTypesSql = `('MATERIAL_REQUISITION','COMPARISON','CUSTODY')`;
const allDocs = await oldDb.select(`SELECT d.id, d."documentNumber", d.title, d.description, d.status::text AS status, d."currentVersion", d."createdAt", d."updatedAt", d."createdById",
    d."currentApproverId", d."currentApproverAssignedAt", d."documentType"::text AS dtype, coalesce(d."comparisonType"::text, d."mrType"::text, d."documentSubtype") AS subtype,
    d."mrNumber", d."projectName", coalesce(d."uploaderLocation"::text, cu.location::text) AS location, cu.email AS creator_email, ca.email AS approver_email
  FROM "Document" d JOIN "User" cu ON cu.id = d."createdById" LEFT JOIN "User" ca ON ca.id = d."currentApproverId"
  WHERE d."documentType" IN ${docTypesSql} ORDER BY d."createdAt", d.id`);
const versions = await oldDb.select(`SELECT v.id, v."documentId", v."versionNumber", v."filePath", v."storageFolder", v."originalName", v.extension, v."mimeType", v."fileSize", v."uploadedAt", v."uploadedById"
  FROM "DocumentVersion" v JOIN "Document" d ON d.id = v."documentId" WHERE d."documentType" IN ${docTypesSql} ORDER BY v."documentId", v."versionNumber"`);
const history = await oldDb.select(`SELECT h.id, h."documentId", h.action::text AS action, h.comments, h."performedAt", h."performedById", h."versionId", u.email AS actor
  FROM "ApprovalHistory" h JOIN "Document" d ON d.id = h."documentId" JOIN "User" u ON u.id = h."performedById" WHERE d."documentType" IN ${docTypesSql} ORDER BY h."documentId", h."performedAt", h.id`);
const downloads = await oldDb.select(`SELECT x."documentId", x."userId", x."downloadedAt" FROM "DocumentDownload" x JOIN "Document" d ON d.id = x."documentId" WHERE d."documentType" IN ${docTypesSql}`);
const auditLogs = await oldDb.select(`SELECT a.id, a."documentId", a."performedById", a.action, a.details, a."createdAt" FROM "AuditLog" a JOIN "Document" d ON d.id = a."documentId" WHERE d."documentType" IN ${docTypesSql} ORDER BY a."createdAt"`);
await oldDb.close();

const q = (sql) => newDb.select(sql);
const migratedRows = await q(`SELECT old_id, old_number, new_number FROM migration.document_map`).catch(() => []);
const migrated = new Set(migratedRows.map((r) => r.old_id));
const projectsNew = new Map((await q(`SELECT p.id, p.code, l.name AS location FROM "Project" p LEFT JOIN "Location" l ON l.id = p."locationId"`)).map((p) => [p.code, p]));
const typesNew = new Map((await q(`SELECT id, code, "numberingCode" FROM "DocumentType"`)).map((t) => [t.code, t]));
const subtypesNew = new Map((await q(`SELECT s.id, s.code, s."numberingCode", t.code AS type_code FROM "DocumentSubtype" s JOIN "DocumentType" t ON t.id = s."documentTypeId"`)).map((s) => [`${s.type_code}:${s.code}`, s]));
const usersNew = new Map((await q(`SELECT id, email FROM "User"`)).map((u) => [u.id, clean(u.email)]));
const tplRows = await q(`SELECT t.id, t.code, s."stepNumber", s.name, s."signatureRequired", sa."approverType"::text AS approver_type, sa."userId", sa."userTypeId"
  FROM "DocumentWorkflowTemplate" t JOIN "DocumentWorkflowStep" s ON s."templateId" = t.id LEFT JOIN "DocumentWorkflowStepApprover" sa ON sa."stepId" = s.id ORDER BY t.code, s."stepNumber"`);
const templates = new Map();
for (const r of tplRows) {
  if (!templates.has(r.code)) templates.set(r.code, { id: r.id, code: r.code, steps: new Map() });
  const t = templates.get(r.code);
  if (!t.steps.has(r.stepNumber)) t.steps.set(r.stepNumber, { n: r.stepNumber, name: r.name, signatureRequired: r.signatureRequired, approvers: [] });
  if (r.approver_type) t.steps.get(r.stepNumber).approvers.push({ type: r.approver_type, userId: r.userId, userTypeId: r.userTypeId, email: r.userId ? usersNew.get(r.userId) : null });
}
const mrField = (await q(`SELECT f.id FROM "FieldDefinition" f JOIN "DocumentType" t ON t.id = f."documentTypeId" WHERE t.code = 'MR' AND f."fieldKey" = 'mrNumber'`))[0];
if (!mrField) { console.error("The MR Number field is missing (apply Stage 1)."); process.exit(1); }
if (templates.size === 0) { console.error("No approval flows found (apply Stage 3)."); process.exit(1); }

// ---- MR numbers ------------------------------------------------------------------------------------------------------
function parseCsv(text) {
  const rows = []; let row = [], cell = "", inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) { if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') inQ = false; else cell += c; }
    else if (c === '"') inQ = true; else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") { if (c === "\r" && text[i + 1] === "\n") i++; row.push(cell); rows.push(row); row = []; cell = ""; }
    else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}
const csvMr = new Map();
for (const file of MR_FILES ?? []) {
  const rows = parseCsv(fs.readFileSync(file, "utf8").replace(/^﻿/, ""));
  const header = rows[0].map((h) => h.trim());
  const iDoc = header.indexOf("document_number");
  const iNum = header.findIndex((h) => h === "MR_NUMBER_FILL_IN" || h.startsWith("proposed_mr_number"));
  if (iDoc < 0 || iNum < 0) { console.error(`${file}: expected columns document_number and MR_NUMBER_FILL_IN / proposed_mr_number(s).`); process.exit(2); }
  for (const r of rows.slice(1)) if (r[iDoc] && r[iNum]?.trim()) csvMr.set(r[iDoc].trim(), r[iNum].trim());
}

// ---- Owner decisions, MR numbers, duplicates ---------------------------------------------------------------------------
const decisions = JSON.parse(fs.readFileSync(new URL("./decisions/documents.json", import.meta.url), "utf8"));
for (const [doc, num] of Object.entries(decisions.mrNumbers ?? {})) csvMr.set(doc, num);
for (const d of allDocs) {
  d.type = TYPE_CODE[d.dtype];
  d.projectCode = d.projectName === "Ready Mix Khobar" ? "RMX" : LOCATION_PROJECT[d.location] ?? "KWT";
  if (d.type === "MR") {
    const raw = (d.mrNumber && d.mrNumber.trim()) || csvMr.get(d.documentNumber) || "";
    // "15738" (5 digits, no prefix) is stored as "MR15738" (owner decision); "MR16110 rev." is the revised copy of MR16110.
    d.isRevised = false;
    d.mrList = [...new Set(raw.split(/\s*(?:\+|,|;|\/)\s*/).map((x) => x.trim()).filter(Boolean).map((x) => {
      const m = /^(MR)?\s*(\d{5,6})\s*(rev\.?)?$/i.exec(x);
      if (!m) return x;
      if (m[3]) d.isRevised = true;
      return m[2].length === 5 ? `MR${m[2]}` : m[1] ? `MR${m[2]}` : m[2];
    }))];
  }
}
// Documents the owner excluded are not migrated at all and take no new number.
const excludedDocs = []; // {d, reason}
for (const d of allDocs) if (decisions.exclude?.[d.documentNumber]) { d.excluded = true; excludedDocs.push({ d, reason: decisions.exclude[d.documentNumber] }); }
// Same MR number on several documents = the same document uploaded again. Keep ONE approved copy (the earliest) and drop the rest.
// A group with no approved copy is not decided automatically: its documents are blocked until the owner says which to keep.
const duplicatesDropped = []; // {d, keptNumber, reason}
const mrGroups = new Map();
for (const d of allDocs) if (d.type === "MR" && !d.excluded && d.mrList.length) { const key = [...d.mrList].sort().join("+"); if (!mrGroups.has(key)) mrGroups.set(key, []); mrGroups.get(key).push(d); }
for (const [key, group] of mrGroups) {
  if (group.length < 2) continue;
  const approved = group.filter((x) => x.status === "APPROVED");
  if (approved.length === 0) { for (const x of group) x.problem = `MR ${key.replaceAll("+", " + ")} is on ${group.length} documents and none is approved: say which one to keep (${group.map((g) => g.documentNumber).join(", ")})`; continue; }
  // Keep the revised copy when there is one (the latest revision), otherwise the earliest approved copy.
  const revised = approved.filter((x) => x.isRevised);
  if (!revised.length && group.some((x) => x.isRevised)) { for (const x of group) x.problem = `MR ${key.replaceAll("+", " + ")}: the revised copy is not approved (${group.map((g) => `${g.documentNumber} ${g.status}`).join(", ")}): say which one to keep`; continue; }
  const keep = revised.length ? revised[revised.length - 1] : approved[0]; // allDocs is ordered by createdAt
  for (const x of group) if (x !== keep) { x.excluded = true; duplicatesDropped.push({ d: x, keptNumber: keep.documentNumber, reason: `same MR number as ${keep.documentNumber}` }); }
}
// An MR number inside a multi-number document that also appears on another kept document is reported, not decided.
const numberOwners = new Map();
for (const d of allDocs) if (d.type === "MR" && !d.excluded) for (const n of d.mrList ?? []) { if (!numberOwners.has(n)) numberOwners.set(n, []); numberOwners.get(n).push(d); }
for (const [n, owners] of numberOwners) if (owners.length > 1) for (const x of owners) x.problem ??= `MR ${n} is also on ${owners.filter((o) => o !== x).map((o) => o.documentNumber).join(", ")} (overlapping MR numbers): needs a decision`;
for (const d of allDocs) if (d.type === "MR" && !d.excluded && d.mrList.length && d.mrList.some((n) => !/^(\d{6}|MR\d{5,6})$/i.test(n))) d.problem ??= `MR number "${d.mrList.join(" + ")}" does not look right (expected 6 digits, or MR followed by digits as stored in the old system): confirm the number`;
if (!(MR_FILES && MR_FILES.length) && allDocs.some((d) => d.type === "MR" && !d.excluded && d.mrList.length === 0)) {
  console.error("Always pass --mr-numbers (the MR numbers CSV), even for Comparison or Custody batches: the numbering of all documents depends on which MRs are duplicates. Nothing was written.");
  process.exit(4);
}
const numberedDocs = allDocs.filter((d) => !d.excluded);

// ---- New numbers over the FULL old set --------------------------------------------------------------------------------
const byId = new Map(allDocs.map((d) => [d.id, d]));
const seqByScope = new Map(); // scope -> last seq
const counterMax = new Map(); // scope key -> {typeCode, subCode, projectCode|null, year, last}
for (const d of numberedDocs) { // already ordered by createdAt, id
  const year = new Date(d.createdAt).getUTCFullYear();
  const subKey = d.subtype ? `${d.type}:${d.subtype}` : null;
  const t = typesNew.get(d.type);
  if (!t) continue;
  if (d.subtype) {
    const s = subtypesNew.get(subKey);
    if (!s) { d.problem = `sub type ${subKey} does not exist in the new system`; continue; }
    const scope = `${d.type}|${d.subtype}|${year}`;
    const seq = (seqByScope.get(scope) ?? 0) + 1; seqByScope.set(scope, seq);
    d.newNumber = `${t.numberingCode || t.code}-${s.numberingCode || s.code}-${year}-${String(seq).padStart(4, "0")}`;
    counterMax.set(scope, { typeCode: d.type, subCode: d.subtype, projectCode: null, year, last: seq });
  } else {
    const scope = `${d.type}||${d.projectCode}|${year}`;
    const seq = (seqByScope.get(scope) ?? 0) + 1; seqByScope.set(scope, seq);
    d.newNumber = `${t.numberingCode || t.code}-${d.projectCode}-${year}-${String(seq).padStart(4, "0")}`;
    counterMax.set(scope, { typeCode: d.type, subCode: null, projectCode: d.projectCode, year, last: seq });
  }
}

// Safety: a document that is already migrated must keep its number. If a decision changed the numbering since then, stop.
{
  const numbered = new Map(numberedDocs.map((d) => [d.id, d]));
  const mismatches = migratedRows.filter((r) => { const d = numbered.get(r.old_id); return !d || d.newNumber !== r.new_number; });
  if (mismatches.length) {
    console.error(`STOP: ${mismatches.length} already-migrated document(s) would get a different number (or are now excluded) after the latest decisions:`);
    for (const r of mismatches.slice(0, 30)) console.error(`  ${r.old_number}: migrated as ${r.new_number}, now ${numbered.get(r.old_id)?.newNumber ?? "excluded/dropped"}`);
    console.error("Remove those documents with stage4-reset-docs.mjs and run their batch again, then continue. Nothing was written.");
    process.exit(3);
  }
}

// ---- Select the batch ------------------------------------------------------------------------------------------------
let selected = numberedDocs.filter((d) => !migrated.has(d.id));
if (F_TYPES) selected = selected.filter((d) => F_TYPES.includes(d.type));
if (F_PROJECTS) selected = selected.filter((d) => F_PROJECTS.includes(d.projectCode));
if (F_IDS) selected = selected.filter((d) => F_IDS.includes(d.id) || F_IDS.includes(d.documentNumber));
if (F_FROM) selected = selected.filter((d) => new Date(d.createdAt) >= new Date(F_FROM));
if (F_TO) selected = selected.filter((d) => new Date(d.createdAt) < new Date(F_TO));
if (F_LIMIT) selected = selected.slice(0, F_LIMIT);

// Kuwait: before this moment Aqueel alone approved (first time George approved a Kuwait MR / Comparison).
const historyByDoc = new Map();
for (const h of history) { if (!historyByDoc.has(h.documentId)) historyByDoc.set(h.documentId, []); historyByDoc.get(h.documentId).push(h); }
let cutover = null;
for (const d of allDocs) {
  if (d.projectCode !== "KWT" || (d.type !== "MR" && d.type !== "COMP")) continue;
  if ((historyByDoc.get(d.id) ?? []).some((h) => h.action === "APPROVED" && clean(h.actor) === "george.azzi@ahmadiah.com")) {
    if (!cutover || new Date(d.createdAt) < cutover) cutover = new Date(d.createdAt);
  }
}

function templateCodeFor(d, approvers) {
  if (d.projectCode === "KWT") {
    if (d.type === "CUSTODY") return null;
    const aqueelApproved = approvers.includes(LEGACY_AQUEEL) && !approvers.includes("george.azzi@ahmadiah.com");
    const beforeCutover = cutover && new Date(d.createdAt) < cutover && approvers.length === 0;
    return aqueelApproved || beforeCutover ? "KWT-LEGACY-2026-09" : "KWT-MR-COMP";
  }
  return { AVR: { MR: "AVR-MR", COMP: "AVR-COMP", CUSTODY: "AVR-CUSTODY" }, AVK: { MR: "AVK-MR", COMP: "AVK-COMP" }, RMX: { MR: "RMX-MR", COMP: "RMX-COMP" } }[d.projectCode]?.[d.type] ?? null;
}

// ---- Rebuild approval steps and history for each document ---------------------------------------------------------------
const blocked = []; // {doc, reason}
const specials = []; // notes shown in the plan
const built = [];
for (const d of selected) {
  const fail = (reason) => blocked.push({ d, reason });
  if (d.problem) { fail(d.problem); continue; }
  const hs = historyByDoc.get(d.id) ?? [];
  const approversSeen = [...new Set(hs.filter((h) => h.action === "APPROVED").map((h) => clean(h.actor)))];
  const templateCode = templateCodeFor(d, approversSeen);
  const tpl = templateCode ? templates.get(templateCode) : null;
  if (!tpl) { fail(`no approval flow for ${d.type} in project ${d.projectCode}`); continue; }
  for (const email of [d.creator_email]) if (![...usersNew.values()].includes(clean(email))) { fail(`uploader ${email} is not in the new database`); }
  if (blocked.some((b) => b.d === d)) continue;

  // MR number is mandatory for MRs.
  let mrNumber = null;
  if (d.type === "MR") {
    mrNumber = d.mrList.length ? d.mrList : null;
    if (!mrNumber) { fail("MR number missing (fill it in the missing-numbers CSV and pass --mr-numbers)"); continue; }
  }

  const levels = [...tpl.steps.values()].filter((s) => s.n > 0).sort((a, b) => a.n - b.n);
  const levelOfActor = (email) => levels.find((s) => s.approvers.some((a) => a.email === clean(email)))?.n ?? null;
  const steps = new Map(); // level -> {status, actedBy, actedAt, comment}
  for (const s of levels) steps.set(s.n, { status: "WAITING", actedById: null, actedAt: null, comment: null });
  const events = []; // new history rows
  let lastLevel = 0, revisionNumber = 1, approvedAt = null, status, currentStep = null, revisionTarget = null;
  events.push({ id: stableId("history-submit", d.id), action: "SUBMITTED", comments: null, at: d.createdAt, by: d.createdById, level: 0, from: null, to: "PENDING", versionId: null, revisionNumber: 1 });

  let ok = true;
  for (const h of hs) {
    if (h.action === "SUBMITTED") continue;
    let level = levelOfActor(h.actor);
    if (h.action === "APPROVED") {
      if (level === null) level = levels.find((s) => s.n > lastLevel)?.n ?? null;
      if (level === null) { fail(`approval by ${h.actor} does not fit the flow ${tpl.code}`); ok = false; break; }
      for (const s of levels) if (s.n < level && steps.get(s.n).status !== "APPROVED") { steps.set(s.n, { status: "APPROVED", actedById: null, actedAt: h.performedAt, comment: "Skipped in the old system (migrated)" }); specials.push(`${d.documentNumber}: level ${s.n} (${s.approvers.map((a) => a.email).join(", ")}) was not approved in the old system; marked as passed`); }
      steps.set(level, { status: "APPROVED", actedById: h.performedById, actedAt: h.performedAt, comment: h.comments });
      lastLevel = level;
      const isLast = level === levels[levels.length - 1].n;
      events.push({ id: h.id, action: "APPROVED", comments: h.comments, at: h.performedAt, by: h.performedById, level, from: "PENDING", to: isLast ? "APPROVED" : "PENDING", outputVersionOld: h.versionId, revisionNumber });
      if (isLast) approvedAt = h.performedAt;
    } else if (h.action === "REJECTED") {
      if (level === null) level = levels.find((s) => s.n > lastLevel)?.n ?? levels[0].n;
      steps.set(level, { status: "REJECTED", actedById: h.performedById, actedAt: h.performedAt, comment: h.comments });
      lastLevel = level; currentStep = level;
      events.push({ id: h.id, action: "REJECTED", comments: h.comments, at: h.performedAt, by: h.performedById, level, from: "PENDING", to: "CANCELLED", outputVersionOld: h.versionId, revisionNumber });
    } else if (h.action === "REQUESTED_REVISION") {
      if (level === null) level = levels.find((s) => s.n > lastLevel)?.n ?? levels[0].n;
      const target = [...levels].map((s) => s.n).filter((n) => n < level).pop() ?? 0;
      revisionTarget = target; lastLevel = target; currentStep = target;
      events.push({ id: h.id, action: "REQUESTED_REVISION", comments: h.comments, at: h.performedAt, by: h.performedById, level, from: "PENDING", to: "REVISION_REQUIRED", target, outputVersionOld: null, revisionNumber });
      revisionNumber += 1;
    }
  }
  if (!ok) continue;

  const old = d.status;
  if (old === "APPROVED" || old === "ARCHIVED") {
    for (const s of levels) if (steps.get(s.n).status !== "APPROVED") steps.set(s.n, { status: "APPROVED", actedById: null, actedAt: approvedAt ?? d.updatedAt, comment: "Passed in the old system (migrated)" });
    status = old === "ARCHIVED" ? "ARCHIVED" : "APPROVED"; currentStep = null;
  } else if (old === "REJECTED") {
    status = "CANCELLED";
    if (currentStep === null) { currentStep = levels[0].n; steps.set(currentStep, { status: "REJECTED", actedById: null, actedAt: d.updatedAt, comment: "Rejected in the old system (migrated)" }); }
  } else if (old === "REVISION_REQUIRED") {
    status = "REVISION_REQUIRED";
    if (revisionTarget === null) { fail("revision required but no revision request in the history"); continue; }
    currentStep = revisionTarget;
    if (revisionTarget > 0) steps.set(revisionTarget, { status: "REVISION", actedById: null, actedAt: null, comment: null });
    for (const s of levels) if (s.n < revisionTarget) steps.set(s.n, { ...steps.get(s.n), status: "APPROVED" });
  } else { // PENDING_APPROVER_n
    status = "PENDING";
    let pending = d.approver_email ? levelOfActor(d.approver_email) : null;
    if (pending === null) pending = levels.find((s) => s.n > lastLevel)?.n ?? null;
    if (pending === null) { fail("could not find the level this document is waiting at"); continue; }
    currentStep = pending;
    for (const s of levels) {
      if (s.n < pending && steps.get(s.n).status !== "APPROVED") { steps.set(s.n, { status: "APPROVED", actedById: null, actedAt: d.createdAt, comment: "Passed in the old system (migrated)" }); specials.push(`${d.documentNumber}: level ${s.n} marked as passed (no approval in history)`); }
      if (s.n === pending) steps.set(s.n, { status: "PENDING", actedById: null, actedAt: null, comment: null });
      if (s.n > pending) steps.set(s.n, { status: "WAITING", actedById: null, actedAt: null, comment: null });
    }
  }

  // Files: the old system kept only the latest version.
  const vs = versions.filter((v) => v.documentId === d.id);
  if (vs.length === 0) { fail("no file version"); continue; }
  const proj = projectsNew.get(d.projectCode);
  const subCode = d.subtype ?? null;
  const folder = storageFolder(proj.location, d.projectCode, d.type, subCode);
  const fileRows = vs.map((v) => {
    const ext = (v.extension || path.extname(v.originalName).replace(".", "") || path.extname(v.filePath).replace(".", "")).replace(/^\./, "");
    const newPath = `${folder}/${newFileName(v.originalName, d.newNumber, v.versionNumber, ext)}`;
    let size = v.fileSize, exists = null;
    if (UPLOAD_ROOT) {
      const candidates = [path.join(UPLOAD_ROOT, v.filePath), path.join(UPLOAD_ROOT, v.filePath.replace(/\/ /g, "/_")), path.join(UPLOAD_ROOT, v.filePath.replace(/\/ /g, "/_").replace(/^_/, "_"))];
      const found = candidates.find((c) => fs.existsSync(c));
      exists = Boolean(found);
      if (found) size = fs.statSync(found).size;
      v.resolvedOld = found ? path.relative(UPLOAD_ROOT, found).replaceAll("\\", "/") : null;
    }
    return { v, ext, newPath, size, exists };
  });
  built.push({ d, tpl, levels, steps, events, status, currentStep, approvedAt, revisionNumber, mrNumber, files: fileRows, folder, location: proj.location });
}

// ---- Statements -----------------------------------------------------------------------------------------------------------
const statements = [];
statements.push(`CREATE SCHEMA IF NOT EXISTS migration`);
statements.push(`CREATE TABLE IF NOT EXISTS migration.document_map (old_id text PRIMARY KEY, old_number text NOT NULL, new_number text NOT NULL, doc_type text NOT NULL, project_code text NOT NULL, batch text NOT NULL, migrated_at timestamptz NOT NULL DEFAULT now())`);
statements.push(`CREATE TABLE IF NOT EXISTS migration.file_map (version_id text PRIMARY KEY, document_id text NOT NULL, old_path text NOT NULL, resolved_old_path text, new_path text NOT NULL, original_name text NOT NULL, db_size bigint, disk_size bigint, exists_on_disk boolean, copied_at timestamptz)`);
const dt = (v) => lit(v ? new Date(v) : null);
for (const b of built) {
  const { d, tpl, steps, events, files } = b;
  const proj = projectsNew.get(d.projectCode);
  const type = typesNew.get(d.type);
  const sub = d.subtype ? subtypesNew.get(`${d.type}:${d.subtype}`) : null;
  statements.push(`INSERT INTO "Document" (id, "documentNumber", title, description, status, "currentVersion", "revisionNumber", "createdAt", "updatedAt", "approvedAt", "createdById", "documentTypeId", "documentSubtypeId", "projectId", "workflowTemplateId", "currentWorkflowStep", "currentApproverAssignedAt", "isReference")
    VALUES (${lit(d.id)}, ${lit(d.newNumber)}, ${lit(d.title)}, ${lit(d.description)}, ${lit(b.status)}::"DocumentStatus", ${lit(d.currentVersion)}, ${lit(b.revisionNumber)}, ${dt(d.createdAt)}, ${dt(d.updatedAt)}, ${dt(b.approvedAt)}, ${lit(d.createdById)}, ${lit(type.id)}, ${lit(sub?.id ?? null)}, ${lit(proj.id)}, ${lit(tpl.id)}, ${lit(b.currentStep)}, ${dt(b.status === "PENDING" || b.status === "REVISION_REQUIRED" ? d.currentApproverAssignedAt ?? d.updatedAt : null)}, FALSE)`);
  // level 0 (uploader) + approval levels
  const stepRows = [{ n: 0, name: "Uploader", signatureRequired: true, status: b.status === "REVISION_REQUIRED" && b.currentStep === 0 ? "REVISION" : "APPROVED", actedById: b.status === "REVISION_REQUIRED" && b.currentStep === 0 ? null : d.createdById, actedAt: b.status === "REVISION_REQUIRED" && b.currentStep === 0 ? null : d.createdAt, comment: null, approvers: tpl.steps.get(0)?.approvers ?? [{ type: "USER", userId: d.createdById }] },
    ...b.levels.map((s) => ({ n: s.n, name: s.name, signatureRequired: s.signatureRequired, ...steps.get(s.n), approvers: s.approvers }))];
  for (const s of stepRows) {
    const sid = stableId("docstep", `${d.id}:${s.n}`);
    statements.push(`INSERT INTO "DocumentApprovalStep" (id, "documentId", "levelNumber", name, "signatureRequired", status, "actedById", "actedAt", comment) VALUES (${lit(sid)}, ${lit(d.id)}, ${s.n}, ${lit(s.name)}, ${lit(s.signatureRequired)}, ${lit(s.status)}::"StepStatus", ${lit(s.actedById)}, ${dt(s.actedAt)}, ${lit(s.comment)})`);
    for (const a of s.approvers) {
      statements.push(`INSERT INTO "DocumentApprovalStepApprover" (id, "stepId", "approverType", "userTypeId", "userId") VALUES (${lit(stableId("docapprover", `${sid}:${a.userId ?? a.userTypeId}`))}, ${lit(sid)}, ${lit(a.userId ? "USER" : "USER_TYPE")}::"ApproverType", ${lit(a.userTypeId ?? null)}, ${lit(a.userId ?? null)})`);
    }
  }
  for (const f of files) {
    const v = f.v;
    statements.push(`INSERT INTO "DocumentVersion" (id, "documentId", "versionNumber", "revisionNumber", "filePath", "storageFolder", "originalName", extension, "mimeType", "fileSize", "uploadedAt", "uploadedById")
      VALUES (${lit(v.id)}, ${lit(d.id)}, ${lit(v.versionNumber)}, ${lit(b.revisionNumber)}, ${lit(f.newPath)}, ${lit(b.folder)}, ${lit(v.originalName)}, ${lit(f.ext || null)}, ${lit(v.mimeType)}, ${lit(f.size)}, ${dt(v.uploadedAt)}, ${lit(v.uploadedById)})`);
    statements.push(`INSERT INTO migration.file_map (version_id, document_id, old_path, resolved_old_path, new_path, original_name, db_size, disk_size, exists_on_disk) VALUES (${lit(v.id)}, ${lit(d.id)}, ${lit(v.filePath)}, ${lit(v.resolvedOld ?? null)}, ${lit(f.newPath)}, ${lit(v.originalName)}, ${lit(v.fileSize)}, ${lit(f.size)}, ${lit(f.exists)})`);
  }
  const versionIds = new Set(files.map((f) => f.v.id));
  for (const e of events) {
    statements.push(`INSERT INTO "ApprovalHistory" (id, "documentId", action, comments, "performedAt", "performedById", "versionId", "outputVersionId", "revisionNumber", "levelNumber", "fromStatus", "toStatus", "revisionTargetLevel")
      VALUES (${lit(e.id)}, ${lit(d.id)}, ${lit(e.action)}::"ApprovalActionType", ${lit(e.comments ?? null)}, ${dt(e.at)}, ${lit(e.by)}, NULL, ${lit(e.outputVersionOld && versionIds.has(e.outputVersionOld) ? e.outputVersionOld : null)}, ${lit(e.revisionNumber)}, ${lit(e.level)}, ${e.from ? lit(e.from) + '::"DocumentStatus"' : "NULL"}, ${lit(e.to)}::"DocumentStatus", ${lit(e.target ?? null)})`);
  }
  if (b.mrNumber) {
    statements.push(`INSERT INTO "DocumentFieldValue" (id, "documentId", "fieldDefinitionId", "valueText", "valueJson") VALUES (${lit(stableId("mrnumber", d.id))}, ${lit(d.id)}, ${lit(mrField.id)}, ${lit(b.mrNumber.join(" + "))}, ${lit(JSON.stringify(b.mrNumber))}::jsonb)`);
  }
  for (const x of downloads.filter((x) => x.documentId === d.id)) {
    statements.push(`INSERT INTO "DocumentDownload" (id, "documentId", "userId", "downloadedAt") VALUES (${lit(stableId("download", `${d.id}:${x.userId}`))}, ${lit(d.id)}, ${lit(x.userId)}, ${dt(x.downloadedAt)}) ON CONFLICT ("documentId", "userId") DO NOTHING`);
  }
  for (const a of auditLogs.filter((a) => a.documentId === d.id && usersNew.has(a.performedById))) {
    statements.push(`INSERT INTO "AuditLog" (id, "documentId", "performedById", action, details, "createdAt") VALUES (${lit(a.id)}, ${lit(d.id)}, ${lit(a.performedById)}, ${lit(a.action)}, ${lit(a.details)}, ${dt(a.createdAt)}) ON CONFLICT (id) DO NOTHING`);
  }
  statements.push(`INSERT INTO migration.document_map (old_id, old_number, new_number, doc_type, project_code, batch) VALUES (${lit(d.id)}, ${lit(d.documentNumber)}, ${lit(d.newNumber)}, ${lit(d.type)}, ${lit(d.projectCode)}, ${lit(BATCH)})`);
}
// Counters: set to the highest number of the FULL old set so new uploads continue after it (never lowered).
if (built.length > 0) {
  for (const c of counterMax.values()) {
    const t = typesNew.get(c.typeCode); const s = c.subCode ? subtypesNew.get(`${c.typeCode}:${c.subCode}`) : null; const p = c.projectCode ? projectsNew.get(c.projectCode) : null;
    if (!t || (c.subCode && !s) || (c.projectCode && !p)) continue;
    // No ON CONFLICT: the unique index on the counter may not exist in every database, so update-then-insert.
    const scope = `"documentTypeId" = ${lit(t.id)} AND "documentSubtypeId" IS NOT DISTINCT FROM ${lit(s?.id ?? null)} AND "projectId" IS NOT DISTINCT FROM ${lit(p?.id ?? null)} AND "periodYear" = ${c.year}`;
    statements.push(`UPDATE "DocumentNumberCounter" SET "lastValue" = GREATEST("lastValue", ${c.last}) WHERE ${scope}`);
    statements.push(`INSERT INTO "DocumentNumberCounter" (id, "documentTypeId", "documentSubtypeId", "projectId", "periodYear", "lastValue") SELECT ${lit(stableId("counter", `${c.typeCode}|${c.subCode}|${c.projectCode}|${c.year}`))}, ${lit(t.id)}, ${lit(s?.id ?? null)}, ${lit(p?.id ?? null)}, ${c.year}, ${c.last} WHERE NOT EXISTS (SELECT 1 FROM "DocumentNumberCounter" WHERE ${scope})`);
  }
}

const countDocs = async () => (await newDb.select(`SELECT count(*)::int AS n FROM "Document"`))[0].n;
const before = await countDocs();
await newDb.runAll(statements, APPLY);
const after = APPLY ? await countDocs() : null;
await newDb.close();

// ---- Plan -------------------------------------------------------------------------------------------------------------------
const tally = (items, key) => { const m = new Map(); for (const i of items) { const k = key(i); m.set(k, (m.get(k) ?? 0) + 1); } return [...m.entries()].sort(); };
const missingFiles = built.flatMap((b) => b.files.filter((f) => f.exists === false).map((f) => `${b.d.documentNumber} -> ${b.d.newNumber}: ${f.v.filePath}`));
const sizeDiffs = built.flatMap((b) => b.files.filter((f) => f.exists && Number(f.v.fileSize) !== f.size)).length;
const mapCsv = ["old_number,new_number,type,project,status,uploader", ...built.map((b) => `${b.d.documentNumber},${b.d.newNumber},${b.d.type},${b.d.projectCode},${b.status},${b.d.creator_email}`)].join("\n");
const blockedCsv = ["document_number,type,project,title,reason", ...blocked.map(({ d, reason }) => [d.documentNumber, d.type, d.projectCode, `"${String(d.title).replace(/"/g, '""')}"`, `"${reason}"`].join(","))].join("\n");
const lines = [
  `# Stage 4 plan: batch "${BATCH}" (${APPLY ? "APPLIED" : "DRY RUN - nothing was written"})`, "",
  `Documents in this batch: ${selected.length}. Ready to migrate: ${built.length}. Blocked (will NOT be migrated): ${blocked.length}. Already migrated earlier: ${[...migrated].length}.`,
  `New database: ${before} documents before${after !== null ? `, ${after} after` : ""}.`, "",
  "## Ready, by type / project / new status", "", "| Type | Project | Status | Flow | Documents |", "| --- | --- | --- | --- | --- |",
  ...tally(built, (b) => `${b.d.type} | ${b.d.projectCode} | ${b.status} | ${b.tpl.code}`).map(([k, n]) => `| ${k} | ${n} |`), "",
  "## Blocked", "", blocked.length ? tally(blocked, (x) => x.reason).map(([r, n]) => `- ${n} x ${r}`).join("\n") : "None.", "",
  ...(excludedDocs.length || duplicatesDropped.length ? ["## Not migrated by decision (whole old system, not only this batch)", "",
    ...excludedDocs.map(({ d, reason }) => `- ${d.documentNumber}: ${reason}`),
    ...(duplicatesDropped.length ? [`- ${duplicatesDropped.length} duplicate MR documents are not migrated (the same MR number was uploaded again; one approved copy is kept). List: stage4-${BATCH}-duplicates-dropped.csv`] : []), ""] : []),
  `The full list is in stage4-${BATCH}-blocked.csv. The old-number to new-number table is stage4-${BATCH}-document-map.csv.`, "",
  "## Files", "", UPLOAD_ROOT ? `${built.reduce((n, b) => n + b.files.length, 0)} files; ${missingFiles.length} missing on disk (the document is migrated without its file, re-upload later); ${sizeDiffs} have a different size on disk (disk size is recorded).` : "Not checked (no --upload-root).",
  ...(missingFiles.length ? ["", ...missingFiles.slice(0, 40).map((m) => `- ${m}`)] : []), "",
  "## Special cases (approval steps rebuilt from incomplete history)", "", specials.length ? [...new Set(specials)].slice(0, 60).map((s) => `- ${s}`).join("\n") : "None.", "",
  "## Sample of new numbers", "", "| Old | New | Type | Project | Status |", "| --- | --- | --- | --- | --- |",
  ...built.slice(0, 12).map((b) => `| ${b.d.documentNumber} | ${b.d.newNumber} | ${b.d.type} | ${b.d.projectCode} | ${b.status} |`),
];
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, `stage4-${BATCH}-plan.md`), lines.join("\n"));
fs.writeFileSync(path.join(OUT, `stage4-${BATCH}-document-map.csv`), mapCsv);
fs.writeFileSync(path.join(OUT, `stage4-${BATCH}-blocked.csv`), "﻿" + blockedCsv);
if (UPLOAD_ROOT) {
  const issueRows = built.flatMap((b) => b.files.filter((f) => f.exists === false || (f.exists && Number(f.v.fileSize) !== f.size)).map((f) => [b.d.documentNumber, b.d.newNumber, b.status, f.exists === false ? "MISSING" : "SIZE_DIFFERS", f.v.fileSize ?? "", f.exists === false ? "" : f.size, `"${String(f.v.filePath).replace(/"/g, '""')}"`].join(",")));
  fs.writeFileSync(path.join(OUT, `stage4-${BATCH}-file-issues.csv`), "\ufeff" + ["document_number,new_number,new_status,issue,size_in_old_database,size_on_disk,file", ...issueRows].join("\n"));
}
fs.writeFileSync(path.join(OUT, `stage4-${BATCH}-duplicates-dropped.csv`), "﻿" + ["document_number,status,created,mr_numbers,kept_copy", ...duplicatesDropped.map(({ d, keptNumber }) => [d.documentNumber, d.status, new Date(d.createdAt).toISOString().slice(0, 10), `"${d.mrList.join(" + ")}"`, keptNumber].join(","))].join("\n"));
console.log(lines.join("\n"));
console.log(`\nWritten to ${OUT}`);
