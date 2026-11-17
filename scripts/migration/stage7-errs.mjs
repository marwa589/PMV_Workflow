#!/usr/bin/env node
// scripts/migration/stage7-errs.mjs
//
// STAGE 7: Equipment Rental / Purchase Requests (ERR) of the old system.
//   - every old ERR becomes an ERR document (sub type = old ERR type) with its approval steps, history, versions and downloads;
//   - every old QUOTATION file becomes its own approved Quotation (QT) reference document in the ERR's project;
//   - every ERR gets a run in the "ERR to Receipt" process (created by Stage 6): the ERR is the first step and its first
//     quotation is the reference document of that step. Further quotations are recorded in migration.err_quotation_link
//     (a step holds only one reference document until the multi-reference change is built).
//   Old stages "escalated to Acting CEO / CEO" are not supported (none exist in the data): such ERRs are blocked and listed.
//   Needs Stages 1 to 3 and Stage 6 (the process trees). Does NOT copy files (later stage uses migration.file_map).
//   Dry run by default (nothing is written); --apply writes. Numbers are computed over ALL old ERRs, so every batch gives stable numbers.
//
//   node scripts/migration/stage7-errs.mjs --old-url <old copy> --new-url <new db> --batch <name>
//        [--from 2025-01-01] [--to 2026-01-01] [--limit 50] [--projects KWT,...] [--ids id1,id2] [--all]
//        [--upload-root "<old uploads folder>"] [--apply] [--out ./migration-output]

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
const csvList = (v) => (v ? v.split(",").map((s) => s.trim()).filter(Boolean) : null);
const F_PROJECTS = csvList(arg("projects")), F_IDS = csvList(arg("ids")), F_FROM = arg("from"), F_TO = arg("to");
const F_LIMIT = arg("limit") ? Number(arg("limit")) : null, F_ALL = flag("all");
if (!OLD_URL || !NEW_URL || !BATCH) { console.error("Need --old-url, --new-url and --batch <name>."); process.exit(2); }
if (!F_PROJECTS && !F_IDS && !F_LIMIT && !F_FROM && !F_TO && !F_ALL) { console.error("Choose what to migrate with --from / --to / --limit / --projects / --ids, or --all."); process.exit(2); }

const clean = (e) => String(e ?? "").trim().toLowerCase();
const dt = (v) => lit(v ? new Date(v) : null);
const csvCell = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;

// ---- same helpers as the new system (and Stage 4) -------------------------------------------------------------------
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

// ---- Read the old database ------------------------------------------------------------------------------------------------
const oldDb = await openDb(OLD_URL, { readOnly: true });
const errs = await oldDb.select(`SELECT e.id, e."documentNumber", e.title, e.description, e.type::text AS etype, e.status::text AS status, e."currentStage"::text AS stage,
    e."revisionNumber", e."createdAt", e."updatedAt", e."approvedAt", e."createdById", e."projectId", e."projectNameSnapshot", cu.email AS creator_email
  FROM "Err" e JOIN "User" cu ON cu.id = e."createdById" ORDER BY e."createdAt", e.id`);
const files = await oldDb.select(`SELECT f.id, f."errId", f.kind::text AS kind, f."versionNumber", f."revisionNumber", f."filePath", f."storageFolder", f."originalName", f."mimeType", f."fileSize", f."uploadedById", f."createdAt"
  FROM "ErrFile" f ORDER BY f."errId", f."createdAt", f.id`);
const history = await oldDb.select(`SELECT h.id, h."errId", h.action::text AS action, h.stage::text AS stage, h.comments, h."revisionNumber", h."inputFileId", h."outputFileId", h."performedAt", h."performedById", u.email AS actor
  FROM "ErrApprovalHistory" h JOIN "User" u ON u.id = h."performedById" ORDER BY h."errId", h."performedAt", h.id`);
const downloads = await oldDb.select(`SELECT "errId", "userId", "downloadedAt" FROM "ErrDownload"`);
await oldDb.close();

// ---- Read the new database -------------------------------------------------------------------------------------------------
const newDb = await openDb(NEW_URL);
const q = (sql) => newDb.select(sql);
const migratedRows = await q(`SELECT old_id, old_number, new_number FROM migration.document_map`).catch(() => []);
const migrated = new Set(migratedRows.map((r) => r.old_id));
const projectMap = new Map((await q(`SELECT old_err_project_id, project_code FROM migration.project_map`).catch(() => [])).map((r) => [r.old_err_project_id, r.project_code]));
if (projectMap.size === 0) { console.error("The project map is empty (apply Stage 1 first)."); process.exit(1); }
const projectsNew = new Map((await q(`SELECT p.id, p.code, l.name AS location FROM "Project" p LEFT JOIN "Location" l ON l.id = p."locationId"`)).map((p) => [p.code, p]));
const typesNew = new Map((await q(`SELECT id, code, "numberingCode" FROM "DocumentType"`)).map((t) => [t.code, t]));
for (const c of ["ERR", "QT"]) if (!typesNew.get(c)) { console.error(`Document type ${c} is missing in the new database.`); process.exit(1); }
const subtypesNew = new Map((await q(`SELECT s.id, s.code, s."numberingCode", t.code AS type_code FROM "DocumentSubtype" s JOIN "DocumentType" t ON t.id = s."documentTypeId"`)).map((s) => [`${s.type_code}:${s.code}`, s]));
const usersNew = new Map((await q(`SELECT id, email FROM "User"`)).map((u) => [u.id, clean(u.email)]));
const tplRows = await q(`SELECT t.id, t.code, s."stepNumber", s.name, s."signatureRequired", sa."approverType"::text AS approver_type, sa."userId", sa."userTypeId"
  FROM "DocumentWorkflowTemplate" t JOIN "DocumentWorkflowStep" s ON s."templateId" = t.id LEFT JOIN "DocumentWorkflowStepApprover" sa ON sa."stepId" = s.id WHERE t.code IN ('ERR-PD-MARC','ERR-MARC-ONLY') ORDER BY t.code, s."stepNumber"`);
const templates = new Map();
for (const r of tplRows) {
  if (!templates.has(r.code)) templates.set(r.code, { id: r.id, code: r.code, steps: new Map() });
  const t = templates.get(r.code);
  if (!t.steps.has(r.stepNumber)) t.steps.set(r.stepNumber, { n: r.stepNumber, name: r.name, signatureRequired: r.signatureRequired, approvers: [] });
  if (r.approver_type) t.steps.get(r.stepNumber).approvers.push({ type: r.approver_type, userId: r.userId, userTypeId: r.userTypeId });
}
if (templates.size < 2) { console.error("The ERR approval flows are missing (apply Stage 3)."); process.exit(1); }
const tree = (await q(`SELECT d.id, d."currentVersion", s.id AS root_step_id FROM "ProcessDefinition" d JOIN "ProcessStep" s ON s."processDefinitionId" = d.id AND s."stepNumber" = 1 AND s."versionNumber" = d."currentVersion" WHERE d.name = 'ERR to Receipt'`))[0];
if (!tree) { console.error('The process tree "ERR to Receipt" does not exist yet (run Stage 6 first; it creates all process trees).'); process.exit(1); }
const doneRuns = new Set((await q(`SELECT run_id FROM migration.process_run_map`).catch(() => [])).map((r) => r.run_id));

// ---- Numbers over the FULL old set ---------------------------------------------------------------------------------------------
const filesByErr = new Map();
for (const f of files) { if (!filesByErr.has(f.errId)) filesByErr.set(f.errId, []); filesByErr.get(f.errId).push(f); }
const historyByErr = new Map();
for (const h of history) { if (!historyByErr.has(h.errId)) historyByErr.set(h.errId, []); historyByErr.get(h.errId).push(h); }
const projectCodeOf = (e) => (e.projectId ? projectMap.get(e.projectId) ?? null : "KWT");
const seqByScope = new Map(); const counterMax = new Map();
for (const e of errs) { // already ordered by createdAt, id
  e.projectCode = projectCodeOf(e);
  const year = new Date(e.createdAt).getUTCFullYear();
  const sub = subtypesNew.get(`ERR:${e.etype}`);
  if (!sub) { e.problem = `ERR sub type ${e.etype} does not exist in the new system`; continue; }
  const scope = `ERR|${e.etype}|${year}`;
  const seq = (seqByScope.get(scope) ?? 0) + 1; seqByScope.set(scope, seq);
  e.newNumber = `${typesNew.get("ERR").numberingCode || "ERR"}-${sub.numberingCode || sub.code}-${year}-${String(seq).padStart(4, "0")}`;
  counterMax.set(scope, { typeCode: "ERR", subCode: e.etype, projectCode: null, year, last: seq });
}
const errById = new Map(errs.map((e) => [e.id, e]));
const quotations = files.filter((f) => f.kind === "QUOTATION" && errById.get(f.errId)?.projectCode).sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt) || (a.id < b.id ? -1 : 1));
for (const f of quotations) {
  const e = errById.get(f.errId);
  const year = new Date(f.createdAt).getUTCFullYear();
  const scope = `QT||${e.projectCode}|${year}`;
  const seq = (seqByScope.get(scope) ?? 0) + 1; seqByScope.set(scope, seq);
  f.newNumber = `${typesNew.get("QT").numberingCode || "QT"}-${e.projectCode}-${year}-${String(seq).padStart(4, "0")}`;
  counterMax.set(scope, { typeCode: "QT", subCode: null, projectCode: e.projectCode, year, last: seq });
}

// Safety: a document that is already migrated must keep its number.
{
  const now = new Map([...errs.map((e) => [e.id, e.newNumber]), ...quotations.map((f) => [f.id, f.newNumber])]);
  const mismatches = migratedRows.filter((r) => now.has(r.old_id) && now.get(r.old_id) !== r.new_number);
  if (mismatches.length) {
    console.error(`STOP: ${mismatches.length} already-migrated ERR / quotation(s) would get a different number now:`);
    for (const r of mismatches.slice(0, 30)) console.error(`  ${r.old_number}: migrated as ${r.new_number}, now ${now.get(r.old_id)}`);
    console.error("Nothing was written."); process.exit(3);
  }
}

// ---- Select the batch ------------------------------------------------------------------------------------------------------------
let selected = errs.filter((e) => !migrated.has(e.id));
if (F_PROJECTS) selected = selected.filter((e) => F_PROJECTS.includes(e.projectCode));
if (F_IDS) selected = selected.filter((e) => F_IDS.includes(e.id) || F_IDS.includes(e.documentNumber));
if (F_FROM) selected = selected.filter((e) => new Date(e.createdAt) >= new Date(F_FROM));
if (F_TO) selected = selected.filter((e) => new Date(e.createdAt) < new Date(F_TO));
if (F_LIMIT) selected = selected.slice(0, F_LIMIT);

// ---- Rebuild steps and history ---------------------------------------------------------------------------------------------------------
const blocked = []; const specials = []; const built = [];
const resolveFile = (f) => {
  if (!UPLOAD_ROOT) return { exists: null, size: f.fileSize, resolvedOld: null };
  const cands = [f.filePath, f.filePath.replace(/\/ /g, "/_")].map((c) => path.join(UPLOAD_ROOT, c));
  const found = cands.find((c) => fs.existsSync(c));
  return { exists: Boolean(found), size: found ? fs.statSync(found).size : f.fileSize, resolvedOld: found ? path.relative(UPLOAD_ROOT, found).replaceAll("\\", "/") : null };
};
const extOf = (f) => path.extname(f.originalName).replace(".", "") || path.extname(f.filePath).replace(".", "");

for (const e of selected) {
  const fail = (reason) => blocked.push({ e, reason });
  if (e.problem) { fail(e.problem); continue; }
  if (!e.projectCode || !projectsNew.get(e.projectCode)) { fail("its old project is not in the project map"); continue; }
  if (![...usersNew.values()].includes(clean(e.creator_email))) { fail(`uploader ${e.creator_email} is not in the new database`); continue; }
  const fs_ = filesByErr.get(e.id) ?? [];
  const odd = fs_.filter((f) => !["ERR_PDF", "QUOTATION"].includes(f.kind));
  if (odd.length) { fail(`has ${odd.length} file(s) of kind ${[...new Set(odd.map((f) => f.kind))].join("/")} that the new system does not take (attachments / vouchers)`); continue; }
  const pdfs = fs_.filter((f) => f.kind === "ERR_PDF").sort((a, b) => a.versionNumber - b.versionNumber || new Date(a.createdAt) - new Date(b.createdAt));
  if (!pdfs.length) { fail("no ERR PDF file"); continue; }
  const hs = historyByErr.get(e.id) ?? [];
  if (hs.some((h) => h.action.startsWith("ESCALATED") || h.action.endsWith("VOUCHER_ADDED")) || ["ACTING_CEO", "CEO"].includes(e.stage)) { fail("it was escalated to the Acting CEO / CEO or has vouchers (not supported)"); continue; }
  if (hs.some((h) => !usersNew.has(h.performedById) && !([...usersNew.values()].includes(clean(h.actor))))) { fail("a history entry was made by a user that is not in the new database"); continue; }

  const tpl = templates.get(e.projectCode === "KWT" ? "ERR-MARC-ONLY" : "ERR-PD-MARC");
  const levels = [...tpl.steps.values()].filter((s) => s.n > 0).sort((a, b) => a.n - b.n);
  const pdLevel = levels[0].n, lastLevel = levels[levels.length - 1].n, single = levels.length === 1;
  const levelOfStage = (stage) => (stage === "PROJECT_DIRECTOR" ? pdLevel : lastLevel);
  const steps = new Map(levels.map((s) => [s.n, { status: "WAITING", actedById: null, actedAt: null, comment: null }]));
  const events = []; let cur = "PENDING", approvedAt = null, revisionTarget = null, rejectedLevel = null, sawSubmit = false;
  const fileIds = new Set(pdfs.map((f) => f.id)); const fileOrNull = (id) => (id && fileIds.has(id) ? id : null);
  let ok = true;
  for (const h of hs) {
    const base = { id: h.id, comments: h.comments, at: h.performedAt, by: h.performedById, revisionNumber: h.revisionNumber ?? 1, inVersion: fileOrNull(h.inputFileId), outVersion: fileOrNull(h.outputFileId) };
    const lvl = h.stage ? levelOfStage(h.stage) : 0;
    if (single && h.stage === "PROJECT_DIRECTOR" && ["APPROVED"].includes(h.action) && clean(h.actor) !== "marc") specials.push(`${e.documentNumber}: approved by the project director in the old system, but this project's flow is Marc only`);
    switch (h.action) {
      case "SUBMITTED": sawSubmit = true; events.push({ ...base, action: "SUBMITTED", level: 0, from: null, to: "PENDING" }); cur = "PENDING"; break;
      case "APPROVED":
        if (single && h.stage === "PROJECT_DIRECTOR") { events.push({ ...base, action: "COMMENTED", level: 0, from: cur, to: cur, comments: `Approved by the project director (old system)${h.comments ? ": " + h.comments : ""}` }); break; }
        steps.set(lvl, { status: "APPROVED", actedById: h.performedById, actedAt: h.performedAt, comment: h.comments });
        events.push({ ...base, action: "APPROVED", level: lvl, from: "PENDING", to: "PENDING" }); cur = "PENDING"; break;
      case "FINALIZED_APPROVAL":
        steps.set(lastLevel, { status: "APPROVED", actedById: h.performedById, actedAt: h.performedAt, comment: h.comments });
        events.push({ ...base, action: "APPROVED", level: lastLevel, from: "PENDING", to: "APPROVED" }); cur = "APPROVED"; approvedAt = h.performedAt; break;
      case "REJECTED":
        steps.set(lvl, { status: "REJECTED", actedById: h.performedById, actedAt: h.performedAt, comment: h.comments }); rejectedLevel = lvl;
        events.push({ ...base, action: "REJECTED", level: lvl, from: "PENDING", to: "CANCELLED" }); cur = "CANCELLED"; break;
      case "REQUESTED_REVISION": {
        const target = h.stage === "PROJECT_DIRECTOR" || single ? 0 : pdLevel;
        revisionTarget = target;
        events.push({ ...base, action: "REQUESTED_REVISION", level: lvl, from: "PENDING", to: "REVISION_REQUIRED", target }); cur = "REVISION_REQUIRED";
        if (h.stage === "PMV_MANAGER" && !single) specials.push(`${e.documentNumber}: revision requested by the PMV manager goes back to level ${pdLevel} (project director)`);
        break; }
      case "PUT_ON_HOLD": events.push({ ...base, action: "PUT_ON_HOLD", level: lvl, from: "PENDING", to: "ON_HOLD" }); cur = "ON_HOLD"; break;
      case "RESUMED": events.push({ ...base, action: "RESUMED", level: lvl, from: "ON_HOLD", to: "PENDING" }); cur = "PENDING"; break;
      case "RESUBMITTED": events.push({ ...base, action: "RESUBMITTED", level: 0, from: "REVISION_REQUIRED", to: "PENDING" }); cur = "PENDING"; revisionTarget = null; break;
      case "COMMENTED": events.push({ ...base, action: "COMMENTED", level: lvl, from: cur, to: cur }); break;
      default: fail(`unknown history action ${h.action}`); ok = false;
    }
    if (!ok) break;
  }
  if (!ok) continue;
  if (!sawSubmit) events.unshift({ id: stableId("errhist-submit", e.id), action: "SUBMITTED", comments: null, at: e.createdAt, by: e.createdById, level: 0, from: null, to: "PENDING", revisionNumber: 1, inVersion: null, outVersion: pdfs[0].id });

  // Final state from the old status.
  let status, currentStep = null, lastActive = null;
  const stageLevel = levelOfStage(e.stage);
  const markBefore = (level) => { for (const s of levels) if (s.n < level && steps.get(s.n).status !== "APPROVED") { steps.set(s.n, { status: "APPROVED", actedById: null, actedAt: e.createdAt, comment: "Passed in the old system (migrated)" }); specials.push(`${e.documentNumber}: level ${s.n} marked as passed (no approval in history)`); } };
  if (e.status === "APPROVED") {
    status = "APPROVED";
    for (const s of levels) if (steps.get(s.n).status !== "APPROVED") { steps.set(s.n, { status: "APPROVED", actedById: null, actedAt: approvedAt ?? e.approvedAt ?? e.updatedAt, comment: "Passed in the old system (migrated)" }); specials.push(`${e.documentNumber}: level ${s.n} marked as passed (no approval in history)`); }
    approvedAt = approvedAt ?? e.approvedAt ?? e.updatedAt;
  } else if (e.status === "REJECTED") {
    status = "CANCELLED";
    currentStep = rejectedLevel ?? stageLevel;
    if (rejectedLevel === null) steps.set(currentStep, { status: "REJECTED", actedById: null, actedAt: e.updatedAt, comment: "Rejected in the old system (migrated)" });
    markBefore(currentStep);
  } else if (e.status === "REVISION_REQUIRED") {
    status = "REVISION_REQUIRED";
    if (revisionTarget === null) { fail("revision required but no revision request in the history"); continue; }
    currentStep = revisionTarget;
    if (revisionTarget > 0) steps.set(revisionTarget, { status: "REVISION", actedById: null, actedAt: null, comment: null });
    for (const s of levels) if (s.n < revisionTarget) steps.set(s.n, { ...steps.get(s.n), status: "APPROVED" });
  } else { // PENDING or ON_HOLD
    status = e.status === "ON_HOLD" ? "ON_HOLD" : "PENDING";
    if (status === "ON_HOLD") lastActive = "PENDING";
    currentStep = stageLevel;
    markBefore(currentStep);
    steps.set(currentStep, { status: "PENDING", actedById: null, actedAt: null, comment: null });
  }

  const proj = projectsNew.get(e.projectCode);
  const folder = storageFolder(proj.location, e.projectCode, "ERR", e.etype);
  const versionRows = pdfs.map((f) => { const r = resolveFile(f); const ext = extOf(f); return { f, ext, newPath: `${folder}/${newFileName(f.originalName, e.newNumber, f.versionNumber, ext)}`, ...r }; });
  const qtFolder = storageFolder(proj.location, e.projectCode, "QT", null);
  const qts = fs_.filter((f) => f.kind === "QUOTATION").sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt) || (a.id < b.id ? -1 : 1)).map((f) => { const r = resolveFile(f); const ext = extOf(f); return { f, ext, newPath: `${qtFolder}/${newFileName(f.originalName, f.newNumber, 0, ext)}`, ...r }; });
  built.push({ e, tpl, levels, steps, events, status, currentStep, lastActive, approvedAt, folder, qtFolder, versions: versionRows, qts, location: proj.location });
}

// ---- Statements ------------------------------------------------------------------------------------------------------------------------------
const st = [];
st.push(`CREATE SCHEMA IF NOT EXISTS migration`);
st.push(`CREATE TABLE IF NOT EXISTS migration.document_map (old_id text PRIMARY KEY, old_number text NOT NULL, new_number text NOT NULL, doc_type text NOT NULL, project_code text NOT NULL, batch text NOT NULL, migrated_at timestamptz NOT NULL DEFAULT now())`);
st.push(`CREATE TABLE IF NOT EXISTS migration.file_map (version_id text PRIMARY KEY, document_id text NOT NULL, old_path text NOT NULL, resolved_old_path text, new_path text NOT NULL, original_name text NOT NULL, db_size bigint, disk_size bigint, exists_on_disk boolean, copied_at timestamptz)`);
st.push(`CREATE TABLE IF NOT EXISTS migration.process_run_map (run_id text PRIMARY KEY, mr_old_id text NOT NULL, po_old_id text, process_name text NOT NULL, status text NOT NULL, batch text NOT NULL, migrated_at timestamptz NOT NULL DEFAULT now())`);
st.push(`CREATE TABLE IF NOT EXISTS migration.err_quotation_link (err_id text NOT NULL, quotation_file_id text NOT NULL, qt_document_id text NOT NULL, position int NOT NULL, is_step_reference boolean NOT NULL, PRIMARY KEY (err_id, quotation_file_id))`);
const addFileMap = (vid, did, f, newPath, it) => st.push(`INSERT INTO migration.file_map (version_id, document_id, old_path, resolved_old_path, new_path, original_name, db_size, disk_size, exists_on_disk) VALUES (${lit(vid)}, ${lit(did)}, ${lit(f.filePath)}, ${lit(it.resolvedOld ?? null)}, ${lit(newPath)}, ${lit(f.originalName)}, ${lit(f.fileSize)}, ${lit(it.size)}, ${lit(it.exists)})`);
for (const b of built) {
  const { e, tpl, steps, events } = b;
  const proj = projectsNew.get(e.projectCode); const type = typesNew.get("ERR"); const sub = subtypesNew.get(`ERR:${e.etype}`);
  const description = [e.description, e.projectId ? null : e.projectNameSnapshot ? `Old project name: ${e.projectNameSnapshot}` : null].filter(Boolean).join("\n") || null;
  const currentVersion = Math.max(...b.versions.map((v) => v.f.versionNumber));
  st.push(`INSERT INTO "Document" (id, "documentNumber", title, description, status, "currentVersion", "revisionNumber", "createdAt", "updatedAt", "approvedAt", "createdById", "documentTypeId", "documentSubtypeId", "projectId", "workflowTemplateId", "currentWorkflowStep", "currentApproverAssignedAt", "lastActiveStage", "isReference")
    VALUES (${lit(e.id)}, ${lit(e.newNumber)}, ${lit(e.title)}, ${lit(description)}, ${lit(b.status)}::"DocumentStatus", ${currentVersion}, ${lit(e.revisionNumber ?? 1)}, ${dt(e.createdAt)}, ${dt(e.updatedAt)}, ${dt(b.approvedAt)}, ${lit(e.createdById)}, ${lit(type.id)}, ${lit(sub.id)}, ${lit(proj.id)}, ${lit(tpl.id)}, ${lit(b.currentStep)}, ${dt(["PENDING", "ON_HOLD", "REVISION_REQUIRED"].includes(b.status) ? e.updatedAt : null)}, ${b.lastActive ? lit(b.lastActive) + '::"DocumentStatus"' : "NULL"}, FALSE)`);
  const stepRows = [{ n: 0, name: "Uploader", signatureRequired: true, status: b.status === "REVISION_REQUIRED" && b.currentStep === 0 ? "REVISION" : "APPROVED", actedById: b.status === "REVISION_REQUIRED" && b.currentStep === 0 ? null : e.createdById, actedAt: b.status === "REVISION_REQUIRED" && b.currentStep === 0 ? null : e.createdAt, comment: null, approvers: tpl.steps.get(0)?.approvers ?? [{ type: "USER", userId: e.createdById }] },
    ...b.levels.map((s) => ({ n: s.n, name: s.name, signatureRequired: s.signatureRequired, ...steps.get(s.n), approvers: s.approvers }))];
  for (const s of stepRows) {
    const sid = stableId("docstep", `${e.id}:${s.n}`);
    st.push(`INSERT INTO "DocumentApprovalStep" (id, "documentId", "levelNumber", name, "signatureRequired", status, "actedById", "actedAt", comment) VALUES (${lit(sid)}, ${lit(e.id)}, ${s.n}, ${lit(s.name)}, ${lit(s.signatureRequired)}, ${lit(s.status)}::"StepStatus", ${lit(s.actedById)}, ${dt(s.actedAt)}, ${lit(s.comment)})`);
    for (const a of s.approvers) st.push(`INSERT INTO "DocumentApprovalStepApprover" (id, "stepId", "approverType", "userTypeId", "userId") VALUES (${lit(stableId("docapprover", `${sid}:${a.userId ?? a.userTypeId}`))}, ${lit(sid)}, ${lit(a.userId ? "USER" : "USER_TYPE")}::"ApproverType", ${lit(a.userTypeId ?? null)}, ${lit(a.userId ?? null)})`);
  }
  for (const v of b.versions) {
    st.push(`INSERT INTO "DocumentVersion" (id, "documentId", "versionNumber", "revisionNumber", "filePath", "storageFolder", "originalName", extension, "mimeType", "fileSize", "uploadedAt", "uploadedById")
      VALUES (${lit(v.f.id)}, ${lit(e.id)}, ${lit(v.f.versionNumber)}, ${lit(v.f.revisionNumber ?? 1)}, ${lit(v.newPath)}, ${lit(b.folder)}, ${lit(v.f.originalName)}, ${lit(v.ext || null)}, ${lit(v.f.mimeType)}, ${lit(v.size)}, ${dt(v.f.createdAt)}, ${lit(v.f.uploadedById)})`);
    addFileMap(v.f.id, e.id, v.f, v.newPath, v);
  }
  for (const ev of events) {
    st.push(`INSERT INTO "ApprovalHistory" (id, "documentId", action, comments, "performedAt", "performedById", "versionId", "outputVersionId", "revisionNumber", "levelNumber", "fromStatus", "toStatus", "revisionTargetLevel")
      VALUES (${lit(ev.id)}, ${lit(e.id)}, ${lit(ev.action)}::"ApprovalActionType", ${lit(ev.comments ?? null)}, ${dt(ev.at)}, ${lit(ev.by)}, ${lit(ev.inVersion ?? null)}, ${lit(ev.outVersion ?? null)}, ${lit(ev.revisionNumber)}, ${lit(ev.level)}, ${ev.from ? lit(ev.from) + '::"DocumentStatus"' : "NULL"}, ${lit(ev.to)}::"DocumentStatus", ${lit(ev.target ?? null)})`);
  }
  for (const x of downloads.filter((x) => x.errId === e.id && usersNew.has(x.userId))) {
    st.push(`INSERT INTO "DocumentDownload" (id, "documentId", "userId", "downloadedAt") VALUES (${lit(stableId("download", `${e.id}:${x.userId}`))}, ${lit(e.id)}, ${lit(x.userId)}, ${dt(x.downloadedAt)}) ON CONFLICT ("documentId", "userId") DO NOTHING`);
  }
  st.push(`INSERT INTO migration.document_map (old_id, old_number, new_number, doc_type, project_code, batch) VALUES (${lit(e.id)}, ${lit(e.documentNumber)}, ${lit(e.newNumber)}, 'ERR', ${lit(e.projectCode)}, ${lit(BATCH)})`);

  // Quotations: one approved reference document each.
  const qtType = typesNew.get("QT");
  b.qts.forEach((qt, idx) => {
    const f = qt.f; const qid = f.id; // the old file id is the new document id (unique, stable)
    st.push(`INSERT INTO "Document" (id, "documentNumber", title, description, status, "currentVersion", "revisionNumber", "createdAt", "updatedAt", "approvedAt", "createdById", "documentTypeId", "documentSubtypeId", "projectId", "workflowTemplateId", "isReference")
      VALUES (${lit(qid)}, ${lit(f.newNumber)}, ${lit(f.originalName.replace(/\.[^.]+$/, "") || "Quotation")}, ${lit(`Quotation of ${e.newNumber}`)}, 'APPROVED'::"DocumentStatus", 0, 1, ${dt(f.createdAt)}, ${dt(f.createdAt)}, ${dt(f.createdAt)}, ${lit(f.uploadedById)}, ${lit(qtType.id)}, NULL, ${lit(proj.id)}, NULL, TRUE)`);
    const vid = stableId("qtversion", f.id);
    st.push(`INSERT INTO "DocumentVersion" (id, "documentId", "versionNumber", "revisionNumber", "filePath", "storageFolder", "originalName", extension, "mimeType", "fileSize", "uploadedAt", "uploadedById")
      VALUES (${lit(vid)}, ${lit(qid)}, 0, 1, ${lit(qt.newPath)}, ${lit(b.qtFolder)}, ${lit(f.originalName)}, ${lit(qt.ext || null)}, ${lit(f.mimeType)}, ${lit(qt.size)}, ${dt(f.createdAt)}, ${lit(f.uploadedById)})`);
    addFileMap(vid, qid, f, qt.newPath, qt);
    st.push(`INSERT INTO "ApprovalHistory" (id, "documentId", action, comments, "performedAt", "performedById", "versionId", "outputVersionId", "revisionNumber", "levelNumber", "fromStatus", "toStatus", "revisionTargetLevel")
      VALUES (${lit(stableId("qthist", f.id))}, ${lit(qid)}, 'AUTO_APPROVED'::"ApprovalActionType", NULL, ${dt(f.createdAt)}, ${lit(f.uploadedById)}, NULL, NULL, 1, 0, NULL, 'APPROVED'::"DocumentStatus", NULL)`);
    st.push(`INSERT INTO migration.document_map (old_id, old_number, new_number, doc_type, project_code, batch) VALUES (${lit(qid)}, ${lit(`${e.documentNumber} quotation ${idx + 1}`)}, ${lit(f.newNumber)}, 'QT', ${lit(e.projectCode)}, ${lit(BATCH)})`);
    st.push(`INSERT INTO migration.err_quotation_link (err_id, quotation_file_id, qt_document_id, position, is_step_reference) VALUES (${lit(e.id)}, ${lit(f.id)}, ${lit(qid)}, ${idx + 1}, ${idx === 0 ? "TRUE" : "FALSE"})`);
  });

  // Process run: ERR is the first step, the first quotation its reference document.
  const runId = stableId("errrun", e.id);
  if (!doneRuns.has(runId)) {
    const runStatus = b.status === "APPROVED" ? "COMPLETED" : b.status === "CANCELLED" ? "CANCELLED" : "IN_PROGRESS";
    b.runStatus = runStatus;
    st.push(`INSERT INTO "ProcessInstance" (id, "processDefinitionId", "projectId", reference, status, "currentStepNumber", "currentStepId", "stepVersion", "startedById", "startedAt", "completedAt")
      VALUES (${lit(runId)}, ${lit(tree.id)}, ${lit(proj.id)}, ${lit(e.newNumber)}, ${lit(runStatus)}::"ProcessStatus", 1, ${lit(b.status === "APPROVED" ? tree.root_step_id : null)}, ${tree.currentVersion}, ${lit(e.createdById)}, ${dt(e.createdAt)}, ${dt(runStatus === "COMPLETED" ? b.approvedAt : runStatus === "CANCELLED" ? e.updatedAt : null)})`);
    st.push(`INSERT INTO "ProcessStepDocument" (id, "processInstanceId", "processStepId", "documentId", source, "linkedById", "isCurrent", "linkedAt", "referenceDocumentId")
      VALUES (${lit(stableId("runlink", `${runId}:${e.id}`))}, ${lit(runId)}, ${lit(tree.root_step_id)}, ${lit(e.id)}, 'UPLOADED'::"ProcessStepSource", ${lit(e.createdById)}, TRUE, ${dt(e.createdAt)}, ${lit(b.qts[0]?.f.id ?? null)})`);
    st.push(`INSERT INTO migration.process_run_map (run_id, mr_old_id, po_old_id, process_name, status, batch) VALUES (${lit(runId)}, ${lit(e.id)}, NULL, 'ERR to Receipt', ${lit(runStatus)}, ${lit(BATCH)})`);
  }
}
if (built.length > 0) {
  for (const c of counterMax.values()) {
    const t = typesNew.get(c.typeCode); const s = c.subCode ? subtypesNew.get(`${c.typeCode}:${c.subCode}`) : null; const p = c.projectCode ? projectsNew.get(c.projectCode) : null;
    if (!t || (c.subCode && !s) || (c.projectCode && !p)) continue;
    const scope = `"documentTypeId" = ${lit(t.id)} AND "documentSubtypeId" IS NOT DISTINCT FROM ${lit(s?.id ?? null)} AND "projectId" IS NOT DISTINCT FROM ${lit(p?.id ?? null)} AND "periodYear" = ${c.year}`;
    st.push(`UPDATE "DocumentNumberCounter" SET "lastValue" = GREATEST("lastValue", ${c.last}) WHERE ${scope}`);
    st.push(`INSERT INTO "DocumentNumberCounter" (id, "documentTypeId", "documentSubtypeId", "projectId", "periodYear", "lastValue") SELECT ${lit(stableId("counter", `${c.typeCode}|${c.subCode}|${c.projectCode}|${c.year}`))}, ${lit(t.id)}, ${lit(s?.id ?? null)}, ${lit(p?.id ?? null)}, ${c.year}, ${c.last} WHERE NOT EXISTS (SELECT 1 FROM "DocumentNumberCounter" WHERE ${scope})`);
  }
}
const count = async () => (await newDb.select(`SELECT (SELECT count(*) FROM "Document" d JOIN "DocumentType" t ON t.id = d."documentTypeId" WHERE t.code = 'ERR')::int AS errs, (SELECT count(*) FROM "Document" d JOIN "DocumentType" t ON t.id = d."documentTypeId" WHERE t.code = 'QT')::int AS qts`))[0];
const before = await count();
await newDb.runAll(st, APPLY);
const after = APPLY ? await count() : null;
await newDb.close();

// ---- Plan ------------------------------------------------------------------------------------------------------------------------------------------
const tally = (arr, key) => { const m = new Map(); for (const i of arr) { const k = key(i); m.set(k, (m.get(k) ?? 0) + 1); } return [...m.entries()].sort(); };
const allFiles = built.flatMap((b) => [...b.versions, ...b.qts]);
const missing = allFiles.filter((f) => f.exists === false);
const sizeDiffs = allFiles.filter((f) => f.exists && Number(f.f.fileSize) !== f.size);
const multiQt = built.filter((b) => b.qts.length > 1);
const lines = [
  `# Stage 7 plan: batch "${BATCH}" (${APPLY ? "APPLIED" : "DRY RUN - nothing was written"})`, "",
  `ERRs in this batch: ${selected.length}. Ready: ${built.length}. Blocked (will NOT be migrated): ${blocked.length}. Already migrated earlier: ${errs.filter((e) => migrated.has(e.id)).length}.`,
  `Quotation documents to create: ${built.reduce((n, b) => n + b.qts.length, 0)}. ERR documents in the new database: ${before.errs} before${after ? `, ${after.errs} after` : ""}. Quotation documents: ${before.qts} before${after ? `, ${after.qts} after` : ""}.`, "",
  "## Ready, by type / project / new status", "", "| ERR type | Project | Status | Flow | ERRs |", "| --- | --- | --- | --- | --- |",
  ...tally(built, (b) => `${b.e.etype} | ${b.e.projectCode} | ${b.status} | ${b.tpl.code}`).map(([k, n]) => `| ${k} | ${n} |`), "",
  "## Process runs (ERR to Receipt)", "", ...tally(built, (b) => b.status === "APPROVED" ? "COMPLETED" : b.status === "CANCELLED" ? "CANCELLED" : "IN_PROGRESS").map(([k, n]) => `- ${k}: ${n}`), "",
  "## Quotations", "", `- ERRs with no quotation: ${built.filter((b) => b.qts.length === 0).length}`, `- ERRs with one quotation: ${built.filter((b) => b.qts.length === 1).length}`,
  `- ERRs with SEVERAL quotations: ${multiQt.length} (the first is the step's reference document; the others are saved as separate quotation documents and recorded in migration.err_quotation_link until the multi-reference change is built)`, "",
  "## Blocked", "", blocked.length ? tally(blocked, (x) => x.reason).map(([r, n]) => `- ${n} x ${r}`).join("\n") : "None.", "",
  `The list is in stage7-${BATCH}-blocked.csv; old and new numbers are in stage7-${BATCH}-document-map.csv; quotations in stage7-${BATCH}-quotations.csv.`, "",
  "## Files", "", UPLOAD_ROOT ? `${allFiles.length} files; ${missing.length} missing on disk (the document is migrated without its file, re-upload later); ${sizeDiffs.length} have a different size on disk (disk size is recorded).` : "Not checked (no --upload-root).",
  ...(missing.length ? ["", ...missing.slice(0, 30).map((m) => `- ${m.f.filePath}`)] : []), "",
  "## Special cases", "", specials.length ? [...new Set(specials)].slice(0, 60).map((s) => `- ${s}`).join("\n") : "None.", "",
  "## Sample of new numbers", "", "| Old | New | Type | Project | Status |", "| --- | --- | --- | --- | --- |",
  ...built.slice(0, 12).map((b) => `| ${b.e.documentNumber} | ${b.e.newNumber} | ${b.e.etype} | ${b.e.projectCode} | ${b.status} |`),
];
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, `stage7-${BATCH}-plan.md`), lines.join("\n"));
fs.writeFileSync(path.join(OUT, `stage7-${BATCH}-document-map.csv`), ["old_number,new_number,type,project,status,uploader", ...built.map((b) => `${b.e.documentNumber},${b.e.newNumber},${b.e.etype},${b.e.projectCode},${b.status},${b.e.creator_email}`)].join("\n"));
fs.writeFileSync(path.join(OUT, `stage7-${BATCH}-blocked.csv`), "﻿" + ["document_number,type,project,title,reason", ...blocked.map(({ e, reason }) => [e.documentNumber, e.etype, e.projectCode ?? "", csvCell(e.title), csvCell(reason)].join(","))].join("\n"));
fs.writeFileSync(path.join(OUT, `stage7-${BATCH}-quotations.csv`), "﻿" + ["err_old_number,err_new_number,quotation_number,quotation_file,is_step_reference", ...built.flatMap((b) => b.qts.map((qt, i) => [b.e.documentNumber, b.e.newNumber, qt.f.newNumber, csvCell(qt.f.originalName), i === 0].join(",")))].join("\n"));
if (UPLOAD_ROOT) fs.writeFileSync(path.join(OUT, `stage7-${BATCH}-file-issues.csv`), "﻿" + ["err_old_number,err_new_number,new_status,issue,size_in_old_database,size_on_disk,file", ...built.flatMap((b) => [...b.versions, ...b.qts].filter((f) => f.exists === false || (f.exists && Number(f.f.fileSize) !== f.size)).map((f) => [b.e.documentNumber, b.e.newNumber, b.status, f.exists === false ? "MISSING" : "SIZE_DIFFERS", f.f.fileSize ?? "", f.exists === false ? "" : f.size, csvCell(f.f.filePath)].join(",")))].join("\n"));
console.log(lines.join("\n"));
console.log(`\nWritten to ${OUT}`);
