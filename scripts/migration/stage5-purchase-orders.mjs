#!/usr/bin/env node
// scripts/migration/stage5-purchase-orders.mjs
//
// STAGE 5: purchase orders and their invoices.
//   - Each old PO becomes a document of type PO (Approved, no approval steps: the old system had none), with its file,
//     the received date and who received it.
//   - Each old PO invoice becomes a document of type Invoice (Approved), in the project of its PO.
//   - The project of a PO is the project of the FIRST MR linked to it (by link date); a PO with no MR goes to the Kuwait project.
//   - The links PO <-> MR and PO <-> invoice are saved in the "migration" schema, for the process stage (one run per MR).
//   - A PO linked to an MR that was dropped as a duplicate is linked to the kept copy (give the duplicates CSV from Stage 4).
// It does NOT copy files (Stage 6). Needs Stage 4 for the MRs. Dry run by default; --apply writes.
//
//   node scripts/migration/stage5-purchase-orders.mjs --old-url <old copy> --new-url <new db> --batch <name>
//        --duplicates <stage4-...-duplicates-dropped.csv>  [--from 2026-09-01] [--to 2026-10-01] [--limit 50] [--all]
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
const DUP_FILES = (arg("duplicates") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
const F_FROM = arg("from"), F_TO = arg("to"), F_LIMIT = arg("limit") ? Number(arg("limit")) : null, F_ALL = flag("all");
if (!OLD_URL || !NEW_URL || !BATCH) { console.error("Need --old-url, --new-url and --batch <name>."); process.exit(2); }
if (!F_FROM && !F_TO && !F_LIMIT && !F_ALL) { console.error("Choose what to migrate with --from / --to / --limit, or --all."); process.exit(2); }
if (DUP_FILES.length === 0) { console.error("Always pass --duplicates (the stage4-...-duplicates-dropped.csv file): POs linked to a dropped duplicate MR need it."); process.exit(2); }

const clean = (e) => String(e ?? "").trim().toLowerCase();
function safeFolder(value) {
  const original = value.trim();
  let safe = original.replace(/[%<>:"/\\|?*\u0000-\u001f]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0")}`);
  safe = safe.replace(/[. ]+$/g, (end) => Array.from(end, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`).join(""));
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(safe)) safe = `%${safe.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0")}${safe.slice(1)}`;
  if (safe.length <= 96) return safe;
  return `${safe.slice(0, 96 - 12 - 1)}-${createHash("sha256").update(original).digest("hex").slice(0, 12)}`;
}
const storageFolder = (location, project, type) => ["Documents", safeFolder(location || "No Location"), safeFolder(project || "No Project"), safeFolder(type)].join("/");
const safeFileName = (n) => n.replace(/[\\/:*?"<>|]/g, "_");
function newFileName(originalName, number, versionNumber, extension) {
  let base = originalName.replace(/\.[^.]+$/, "").replace(/-(?:v\d+|DOC-\d+|signed)(?=-|$)/gi, "").replace(/-+$/, "").trim();
  if (!base) base = "Document";
  return safeFileName(`${base}-v${versionNumber}-${number}`) + (extension ? `.${extension}` : "");
}
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

// ---- Read ---------------------------------------------------------------------------------------------------------------
const oldDb = await openDb(OLD_URL, { readOnly: true });
const newDb = await openDb(NEW_URL);
const pos = await oldDb.select(`SELECT p.id, p."poNumber", p."originalName", p.description, p."filePath", p."mimeType", p."fileSize", p."uploadedAt", p."uploadedById", p."receivedAt", p."receivedById", u.email AS uploader_email
  FROM "PurchaseOrder" p JOIN "User" u ON u.id = p."uploadedById" ORDER BY p."uploadedAt", p.id`);
const links = await oldDb.select(`SELECT l.id, l."purchaseOrderId", l."documentId", l."createdAt", d."documentNumber" AS doc_number FROM "PurchaseOrderMrLink" l JOIN "Document" d ON d.id = l."documentId" ORDER BY l."createdAt", l.id`);
const invoices = await oldDb.select(`SELECT i.id, i."purchaseOrderId", i."documentId", i."originalName", i."filePath", i."mimeType", i."fileSize", i."uploadedAt", i."uploadedById", d."documentNumber" AS doc_number
  FROM "PurchaseOrderInvoice" i LEFT JOIN "Document" d ON d.id = i."documentId" ORDER BY i."uploadedAt", i.id`);
await oldDb.close();

const q = (sql) => newDb.select(sql);
const typesNew = new Map((await q(`SELECT id, code, "numberingCode", "namingPattern" FROM "DocumentType" WHERE code IN ('PO','INV')`)).map((t) => [t.code, t]));
if (!typesNew.get("PO") || !typesNew.get("INV")) { console.error("The document types PO and INV are missing in the new database."); process.exit(1); }
const projectsNew = new Map((await q(`SELECT p.id, p.code, l.name AS location FROM "Project" p LEFT JOIN "Location" l ON l.id = p."locationId"`)).map((p) => [p.code, p]));
const usersNew = new Set((await q(`SELECT id FROM "User"`)).map((u) => u.id));
const docMap = new Map((await q(`SELECT old_id, old_number, new_number, project_code, doc_type FROM migration.document_map`).catch(() => [])).map((r) => [r.old_number, r]));
const migratedRows = new Map((await q(`SELECT old_id, old_number, new_number FROM migration.document_map WHERE doc_type IN ('PO','INV')`).catch(() => [])).map((r) => [r.old_id, r]));
const kept = new Map(); // dropped duplicate MR number -> kept MR number
for (const f of DUP_FILES) {
  const rows = parseCsv(fs.readFileSync(f, "utf8").replace(/^﻿/, ""));
  const h = rows[0].map((x) => x.trim()); const iD = h.indexOf("document_number"), iK = h.indexOf("kept_copy");
  if (iD < 0 || iK < 0) { console.error(`${f}: expected columns document_number and kept_copy.`); process.exit(2); }
  for (const r of rows.slice(1)) if (r[iD]) kept.set(r[iD].trim(), r[iK].trim());
}

// ---- Resolve MR links and projects ---------------------------------------------------------------------------------------
const resolveMr = (docNumber) => docMap.get(docNumber) ?? (kept.has(docNumber) ? docMap.get(kept.get(docNumber)) : null) ?? null;
const linksByPo = new Map();
for (const l of links) { if (!linksByPo.has(l.purchaseOrderId)) linksByPo.set(l.purchaseOrderId, []); linksByPo.get(l.purchaseOrderId).push(l); }
const poById = new Map(pos.map((p) => [p.id, p]));
for (const p of pos) {
  p.links = (linksByPo.get(p.id) ?? []).map((l) => ({ ...l, resolved: resolveMr(l.doc_number) }));
  const first = p.links.find((l) => l.resolved);
  p.projectCode = first ? first.resolved.project_code : "KWT";
  p.projectNote = !p.links.length ? "no MR linked: Kuwait project" : !first ? "no linked MR was migrated: Kuwait project" : null;
  if (p.links.some((l) => !l.resolved)) p.unresolved = p.links.filter((l) => !l.resolved).map((l) => l.doc_number);
}
for (const i of invoices) { i.po = poById.get(i.purchaseOrderId); i.projectCode = i.po?.projectCode ?? "KWT"; }

// ---- New numbers over the FULL old set (oldest first, per type + project + year) -------------------------------------------
const seq = new Map(); const counterMax = new Map();
function numberFor(type, projectCode, date) {
  const year = new Date(date).getUTCFullYear();
  const scope = `${type.code}|${projectCode}|${year}`;
  const n = (seq.get(scope) ?? 0) + 1; seq.set(scope, n);
  counterMax.set(scope, { type, projectCode, year, last: n });
  return (type.namingPattern || "{TYPE}-{PROJECT}-{YYYY}-{SEQ:4}").replace(/\{TYPE\}/g, type.numberingCode || type.code).replace(/\{PROJECT\}/g, projectCode)
    .replace(/\{YYYY\}/g, String(year)).replace(/\{SEQ:(\d+)\}/g, (_m, w) => String(n).padStart(Number(w), "0")).replace(/\{SEQ\}/g, String(n));
}
for (const p of pos) p.newNumber = numberFor(typesNew.get("PO"), p.projectCode, p.uploadedAt);
for (const i of invoices) i.newNumber = numberFor(typesNew.get("INV"), i.projectCode, i.uploadedAt);

// Safety: already-migrated POs / invoices must keep their number.
{
  const all = new Map([...pos, ...invoices].map((x) => [x.id, x]));
  const bad = [...migratedRows.values()].filter((r) => all.get(r.old_id)?.newNumber !== r.new_number);
  if (bad.length) {
    console.error(`STOP: ${bad.length} already-migrated PO/invoice(s) would get a different number:`);
    for (const r of bad.slice(0, 30)) console.error(`  ${r.old_number}: migrated as ${r.new_number}, now ${all.get(r.old_id)?.newNumber ?? "missing"}`);
    console.error("Nothing was written. Remove them with stage4-reset-docs.mjs (--numbers old PO numbers) and run the batch again.");
    process.exit(3);
  }
}

// ---- Select the batch ------------------------------------------------------------------------------------------------------
const inRange = (d) => (!F_FROM || new Date(d) >= new Date(F_FROM)) && (!F_TO || new Date(d) < new Date(F_TO));
let selPos = pos.filter((p) => !migratedRows.has(p.id) && inRange(p.uploadedAt));
if (F_LIMIT) selPos = selPos.slice(0, F_LIMIT);
let selInv = invoices.filter((i) => !migratedRows.has(i.id) && inRange(i.uploadedAt) && (!F_LIMIT || selPos.some((p) => p.id === i.purchaseOrderId) || migratedRows.has(i.purchaseOrderId)));
const blocked = [];
const items = [];
const addItem = (kind, x, oldNumber, extra) => {
  const fail = (reason) => blocked.push({ kind, oldNumber, reason });
  if (!usersNew.has(x.uploadedById)) return fail("uploader is not in the new database");
  if (!x.filePath) return fail("no file path");
  const proj = projectsNew.get(x.projectCode);
  if (!proj) return fail(`project ${x.projectCode} is missing in the new database`);
  if (kind === "PO" && x.unresolved?.length && !x.links.some((l) => l.resolved)) return fail(`its linked MR(s) ${x.unresolved.join(", ")} are not migrated (excluded or not yet migrated)`);
  const type = typesNew.get(kind === "PO" ? "PO" : "INV");
  const ext = path.extname(x.originalName).replace(".", "") || path.extname(x.filePath).replace(".", "");
  const folder = storageFolder(proj.location, x.projectCode, type.code);
  const newPath = `${folder}/${newFileName(x.originalName, x.newNumber, 1, ext)}`;
  let size = x.fileSize, exists = null, resolvedOld = null;
  if (UPLOAD_ROOT) {
    const candidates = [path.join(UPLOAD_ROOT, x.filePath), path.join(UPLOAD_ROOT, x.filePath.replace(/\/ /g, "/_"))];
    const found = candidates.find((c) => fs.existsSync(c));
    exists = Boolean(found); if (found) { size = fs.statSync(found).size; resolvedOld = path.relative(UPLOAD_ROOT, found).replaceAll("\\", "/"); }
  }
  items.push({ kind, x, oldNumber, proj, type, ext, folder, newPath, size, exists, resolvedOld, ...extra });
};
for (const p of selPos) addItem("PO", p, p.poNumber, {});
for (const i of selInv) {
  if (!i.po) { blocked.push({ kind: "INV", oldNumber: i.originalName, reason: "its purchase order does not exist" }); continue; }
  addItem("INV", i, `${i.po.poNumber} / ${i.originalName}`, {});
}

// ---- Statements ----------------------------------------------------------------------------------------------------------------
const dt = (v) => lit(v ? new Date(v) : null);
const st = [];
st.push(`CREATE SCHEMA IF NOT EXISTS migration`);
st.push(`CREATE TABLE IF NOT EXISTS migration.document_map (old_id text PRIMARY KEY, old_number text NOT NULL, new_number text NOT NULL, doc_type text NOT NULL, project_code text NOT NULL, batch text NOT NULL, migrated_at timestamptz NOT NULL DEFAULT now())`);
st.push(`CREATE TABLE IF NOT EXISTS migration.file_map (version_id text PRIMARY KEY, document_id text NOT NULL, old_path text NOT NULL, resolved_old_path text, new_path text NOT NULL, original_name text NOT NULL, db_size bigint, disk_size bigint, exists_on_disk boolean, copied_at timestamptz)`);
st.push(`CREATE TABLE IF NOT EXISTS migration.po_mr_link (po_id text NOT NULL, old_mr_number text NOT NULL, kept_mr_old_id text, link_created_at timestamptz, position int NOT NULL, PRIMARY KEY (po_id, old_mr_number))`);
st.push(`CREATE TABLE IF NOT EXISTS migration.po_invoice_link (invoice_id text PRIMARY KEY, po_id text NOT NULL, old_mr_number text)`);
for (const it of items) {
  const { x, proj, type } = it;
  const received = it.kind === "PO" && x.receivedAt;
  const title = x.originalName.replace(/\.[^.]+$/, "");
  st.push(`INSERT INTO "Document" (id, "documentNumber", title, description, status, "currentVersion", "revisionNumber", "createdAt", "updatedAt", "approvedAt", "createdById", "documentTypeId", "documentSubtypeId", "projectId", "workflowTemplateId", "currentWorkflowStep", "currentApproverAssignedAt", "isReference", "receivedAt", "receivedById")
    VALUES (${lit(x.id)}, ${lit(x.newNumber)}, ${lit(title)}, ${lit(x.description ?? null)}, 'APPROVED'::"DocumentStatus", 1, 1, ${dt(x.uploadedAt)}, ${dt(received ? x.receivedAt : x.uploadedAt)}, ${dt(x.uploadedAt)}, ${lit(x.uploadedById)}, ${lit(type.id)}, NULL, ${lit(proj.id)}, NULL, NULL, NULL, FALSE, ${dt(received ? x.receivedAt : null)}, ${lit(received && usersNew.has(x.receivedById) ? x.receivedById : null)})`);
  const vid = stableId("povers", x.id);
  st.push(`INSERT INTO "DocumentVersion" (id, "documentId", "versionNumber", "revisionNumber", "filePath", "storageFolder", "originalName", extension, "mimeType", "fileSize", "uploadedAt", "uploadedById")
    VALUES (${lit(vid)}, ${lit(x.id)}, 1, 1, ${lit(it.newPath)}, ${lit(it.folder)}, ${lit(x.originalName)}, ${lit(it.ext || null)}, ${lit(x.mimeType)}, ${lit(it.size)}, ${dt(x.uploadedAt)}, ${lit(x.uploadedById)})`);
  st.push(`INSERT INTO migration.file_map (version_id, document_id, old_path, resolved_old_path, new_path, original_name, db_size, disk_size, exists_on_disk) VALUES (${lit(vid)}, ${lit(x.id)}, ${lit(x.filePath)}, ${lit(it.resolvedOld)}, ${lit(it.newPath)}, ${lit(x.originalName)}, ${lit(x.fileSize)}, ${lit(it.size)}, ${lit(it.exists)})`);
  st.push(`INSERT INTO "ApprovalHistory" (id, "documentId", action, comments, "performedAt", "performedById", "versionId", "outputVersionId", "revisionNumber", "levelNumber", "fromStatus", "toStatus", "revisionTargetLevel")
    VALUES (${lit(stableId("pohist", x.id))}, ${lit(x.id)}, 'AUTO_APPROVED'::"ApprovalActionType", NULL, ${dt(x.uploadedAt)}, ${lit(x.uploadedById)}, NULL, NULL, 1, 0, NULL, 'APPROVED'::"DocumentStatus", NULL)`);
  st.push(`INSERT INTO migration.document_map (old_id, old_number, new_number, doc_type, project_code, batch) VALUES (${lit(x.id)}, ${lit(it.kind === "PO" ? x.poNumber : it.oldNumber)}, ${lit(x.newNumber)}, ${lit(it.kind)}, ${lit(x.projectCode)}, ${lit(BATCH)})`);
  if (it.kind === "PO") {
    x.links.forEach((l, idx) => st.push(`INSERT INTO migration.po_mr_link (po_id, old_mr_number, kept_mr_old_id, link_created_at, position) VALUES (${lit(x.id)}, ${lit(l.doc_number)}, ${lit(l.resolved?.old_id ?? null)}, ${dt(l.createdAt)}, ${idx + 1}) ON CONFLICT DO NOTHING`));
  } else {
    st.push(`INSERT INTO migration.po_invoice_link (invoice_id, po_id, old_mr_number) VALUES (${lit(x.id)}, ${lit(x.purchaseOrderId)}, ${lit(x.doc_number ?? null)}) ON CONFLICT DO NOTHING`);
  }
}
if (items.length) for (const c of counterMax.values()) {
  const t = c.type; const p = projectsNew.get(c.projectCode); if (!p) continue;
  const scope = `"documentTypeId" = ${lit(t.id)} AND "documentSubtypeId" IS NULL AND "projectId" = ${lit(p.id)} AND "periodYear" = ${c.year}`;
  st.push(`UPDATE "DocumentNumberCounter" SET "lastValue" = GREATEST("lastValue", ${c.last}) WHERE ${scope}`);
  st.push(`INSERT INTO "DocumentNumberCounter" (id, "documentTypeId", "documentSubtypeId", "projectId", "periodYear", "lastValue") SELECT ${lit(stableId("counter", `${t.code}||${c.projectCode}|${c.year}`))}, ${lit(t.id)}, NULL, ${lit(p.id)}, ${c.year}, ${c.last} WHERE NOT EXISTS (SELECT 1 FROM "DocumentNumberCounter" WHERE ${scope})`);
}
const countDocs = async () => (await newDb.select(`SELECT count(*)::int AS n FROM "Document"`))[0].n;
const before = await countDocs();
await newDb.runAll(st, APPLY);
const after = APPLY ? await countDocs() : null;
await newDb.close();

// ---- Plan -----------------------------------------------------------------------------------------------------------------------
const tally = (arr, key) => { const m = new Map(); for (const i of arr) { const k = key(i); m.set(k, (m.get(k) ?? 0) + 1); } return [...m.entries()].sort(); };
const poItems = items.filter((i) => i.kind === "PO"), invItems = items.filter((i) => i.kind === "INV");
const missing = items.filter((i) => i.exists === false);
const sizeDiff = items.filter((i) => i.exists && Number(i.x.fileSize) !== i.size);
const noLink = poItems.filter((i) => !i.x.links.length), partial = poItems.filter((i) => i.x.unresolved?.length && i.x.links.some((l) => l.resolved));
const lines = [
  `# Stage 5 plan: batch "${BATCH}" (${APPLY ? "APPLIED" : "DRY RUN - nothing was written"})`, "",
  `Purchase orders in this batch: ${selPos.length}. Invoices: ${selInv.length}. Ready: ${poItems.length} POs + ${invItems.length} invoices. Blocked: ${blocked.length}. Already migrated earlier: ${migratedRows.size}.`,
  `New database: ${before} documents before${after !== null ? `, ${after} after` : ""}.`, "",
  "## Ready, by type / project", "", "| Type | Project | Documents |", "| --- | --- | --- |", ...tally(items, (i) => `${i.kind} | ${i.x.projectCode}`).map(([k, n]) => `| ${k} | ${n} |`), "",
  `Received POs: ${poItems.filter((i) => i.x.receivedAt).length} of ${poItems.length}. POs with no MR link (Kuwait project): ${noLink.length}. POs with some linked MRs not migrated: ${partial.length}.`, "",
  "## Blocked", "", blocked.length ? tally(blocked, (b) => `${b.kind}: ${b.reason}`).map(([r, n]) => `- ${n} x ${r}`).join("\n") : "None.", "",
  "## Files", "", UPLOAD_ROOT ? `${items.length} files; ${missing.length} missing on disk (migrated without the file, re-upload later); ${sizeDiff.length} have a different size on disk (disk size is recorded).` : "Not checked (no --upload-root).",
  ...(missing.length ? ["", ...missing.slice(0, 40).map((i) => `- ${i.kind} ${i.oldNumber} -> ${i.x.newNumber}: ${i.x.filePath}`)] : []), "",
  "## Sample of new numbers", "", "| Old | New | Type | Project | Received |", "| --- | --- | --- | --- | --- |",
  ...items.slice(0, 12).map((i) => `| ${i.oldNumber} | ${i.x.newNumber} | ${i.kind} | ${i.x.projectCode} | ${i.kind === "PO" && i.x.receivedAt ? "yes" : ""} |`),
];
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, `stage5-${BATCH}-plan.md`), lines.join("\n"));
const csvc = (cells) => cells.map((c) => `"${String(c ?? "").replace(/"/g, '""')}"`).join(",");
fs.writeFileSync(path.join(OUT, `stage5-${BATCH}-document-map.csv`), "﻿" + [csvc(["old_number", "new_number", "type", "project", "uploader", "linked_mrs"]), ...items.map((i) => csvc([i.oldNumber, i.x.newNumber, i.kind, i.x.projectCode, i.x.uploader_email ?? "", i.kind === "PO" ? i.x.links.map((l) => l.doc_number).join(" + ") : (i.x.doc_number ?? "")]))].join("\n"));
fs.writeFileSync(path.join(OUT, `stage5-${BATCH}-blocked.csv`), "﻿" + [csvc(["type", "old_number", "reason"]), ...blocked.map((b) => csvc([b.kind, b.oldNumber, b.reason]))].join("\n"));
if (UPLOAD_ROOT) fs.writeFileSync(path.join(OUT, `stage5-${BATCH}-file-issues.csv`), "﻿" + [csvc(["type", "old_number", "new_number", "issue", "size_in_old_database", "size_on_disk", "file"]), ...items.filter((i) => i.exists === false || (i.exists && Number(i.x.fileSize) !== i.size)).map((i) => csvc([i.kind, i.oldNumber, i.x.newNumber, i.exists === false ? "MISSING" : "SIZE_DIFFERS", i.x.fileSize, i.exists === false ? "" : i.size, i.x.filePath]))].join("\n"));
console.log(lines.join("\n"));
console.log(`\nWritten to ${OUT}`);
