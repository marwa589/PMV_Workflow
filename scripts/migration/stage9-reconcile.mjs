#!/usr/bin/env node
// scripts/migration/stage9-reconcile.mjs
//
// STAGE 9: reconciliation. READ-ONLY on both databases and on the folders. Compares the old system with what was migrated and writes a
// report with PASS / FAIL / NOTE per check. Run it after every batch and again after the final cutover.
//
//   node scripts/migration/stage9-reconcile.mjs --old-url <old copy> --new-url <new db> [--new-root "<new UPLOAD_PATH>"] [--out ./migration-output]
//
// Checks: (1) every old record is migrated or has a stated reason, (2) status of each migrated document, (3) approval steps agree with the
// status, (4) numbers and MR numbers are unique, (5) files: every recorded file is on disk with the recorded size, no stray files,
// (6) downloads, (7) process runs, (8) what is still pending and where.

import fs from "node:fs";
import path from "node:path";
import { arg, openDb } from "./lib/db.mjs";

const OLD_URL = arg("old-url", "OLD_DATABASE_URL"), NEW_URL = arg("new-url", "NEW_DATABASE_URL"), NEW_ROOT = arg("new-root", "NEW_UPLOAD_ROOT"), OUT = arg("out") || "./migration-output";
if (!OLD_URL || !NEW_URL) { console.error("Need --old-url and --new-url."); process.exit(2); }
const oldDb = await openDb(OLD_URL, { readOnly: true });
const newDb = await openDb(NEW_URL, { readOnly: true });
const results = []; // { level: PASS|FAIL|NOTE, title, detail[] }
const check = (ok, title, detail = []) => results.push({ level: ok ? "PASS" : "FAIL", title, detail });
const note = (title, detail = []) => results.push({ level: "NOTE", title, detail });
const csvCell = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
const extra = []; // rows for the CSV of problems

// ---- Old side --------------------------------------------------------------------------------------------------------------
const oldDocs = await oldDb.select(`SELECT id, "documentNumber" AS num, "documentType"::text AS dtype, status::text AS status FROM "Document"`);
const oldPos = await oldDb.select(`SELECT id, "poNumber" AS num FROM "PurchaseOrder"`);
const oldInv = await oldDb.select(`SELECT id, "originalName" AS num FROM "PurchaseOrderInvoice"`);
const oldErrs = await oldDb.select(`SELECT id, "documentNumber" AS num, status::text AS status FROM "Err"`);
const oldErrQuot = (await oldDb.select(`SELECT count(*)::int AS n FROM "ErrFile" WHERE kind = 'QUOTATION'`))[0].n;
const oldDl = (await oldDb.select(`SELECT count(*)::int AS n FROM "DocumentDownload"`))[0].n;
const oldErrDl = (await oldDb.select(`SELECT count(*)::int AS n FROM "ErrDownload"`))[0].n;
await oldDb.close();

// ---- New side --------------------------------------------------------------------------------------------------------------
const map = await newDb.select(`SELECT old_id, old_number, new_number, doc_type FROM migration.document_map`);
const mapIds = new Map(map.map((m) => [m.old_id, m]));
const newDocs = await newDb.select(`SELECT d.id, d."documentNumber" AS num, d.status::text AS status, d."currentWorkflowStep" AS step, d."isReference", t.code AS tcode FROM "Document" d JOIN "DocumentType" t ON t.id = d."documentTypeId"`);
const newById = new Map(newDocs.map((d) => [d.id, d]));

// (1) Coverage
{
  const groups = [["MR/COMP/CUSTODY documents", oldDocs.map((d) => ({ ...d })), ["MR", "COMP", "CUSTODY"]], ["Purchase orders", oldPos, ["PO"]], ["PO invoices", oldInv, ["INV"]], ["ERRs", oldErrs, ["ERR"]]];
  for (const [label, rows, types] of groups) {
    const migratedRows = rows.filter((r) => mapIds.has(r.id) && types.includes(mapIds.get(r.id).doc_type));
    const notMigrated = rows.filter((r) => !mapIds.has(r.id));
    note(`${label}: ${rows.length} in the old system, ${migratedRows.length} migrated, ${notMigrated.length} not migrated`, notMigrated.slice(0, 30).map((r) => `not migrated: ${r.num}`));
    for (const r of notMigrated) extra.push(["NOT_MIGRATED", label, r.num, ""]);
  }
  const ghost = map.filter((m) => !newById.has(m.old_id) && m.doc_type !== "INV");
  check(ghost.length === 0, "Every row of the migration map exists as a document in the new system", ghost.slice(0, 20).map((m) => `${m.old_number} -> ${m.new_number} is missing`));
  const qt = newDocs.filter((d) => d.tcode === "QT").length;
  check(qt === oldErrQuot || qt <= oldErrQuot, `Quotation documents: ${qt} in the new system, ${oldErrQuot} quotation files in the old system (equal when every ERR is migrated)`);
}

// (2) Status
{
  const expected = (oldStatus) => (oldStatus.startsWith("PENDING") ? ["PENDING", "ON_HOLD"] : { APPROVED: ["APPROVED"], REJECTED: ["CANCELLED"], REVISION_REQUIRED: ["REVISION_REQUIRED"], ARCHIVED: ["ARCHIVED", "APPROVED"] }[oldStatus] ?? []);
  const errExp = (s) => ({ PENDING: ["PENDING"], ON_HOLD: ["ON_HOLD"], REVISION_REQUIRED: ["REVISION_REQUIRED"], REJECTED: ["CANCELLED"], APPROVED: ["APPROVED"] }[s] ?? []);
  const bad = [];
  for (const d of oldDocs) { const n = newById.get(d.id); if (n && mapIds.has(d.id) && !expected(d.status).includes(n.status)) bad.push(`${d.num}: old ${d.status}, new ${n.status}`); }
  for (const e of oldErrs) { const n = newById.get(e.id); if (n && !errExp(e.status).includes(n.status)) bad.push(`${e.num}: old ${e.status}, new ${n.status}`); }
  for (const p of [...oldPos, ...oldInv]) { const n = newById.get(p.id); if (n && n.status !== "APPROVED") bad.push(`${p.num}: should be APPROVED, is ${n.status}`); }
  check(bad.length === 0, "Status of every migrated document matches its old status", bad.slice(0, 30));
  for (const b of bad) extra.push(["STATUS", "", b, ""]);
}

// (3) Approval steps
{
  const steps = await newDb.select(`SELECT d.id, d."documentNumber" AS num, d.status::text AS status, d."currentWorkflowStep" AS cur,
      count(s.id)::int AS n, count(s.id) FILTER (WHERE s.status = 'APPROVED')::int AS approved, count(s.id) FILTER (WHERE s.status = 'PENDING')::int AS pending,
      count(s.id) FILTER (WHERE s.status = 'REJECTED')::int AS rejected, count(s.id) FILTER (WHERE s.status = 'REVISION')::int AS revision,
      (SELECT count(*) FROM "ApprovalHistory" h WHERE h."documentId" = d.id)::int AS history,
      (SELECT count(*) FROM "ApprovalHistory" h WHERE h."documentId" = d.id AND h.action IN ('SUBMITTED','AUTO_APPROVED'))::int AS starts
    FROM "Document" d LEFT JOIN "DocumentApprovalStep" s ON s."documentId" = d.id WHERE d.id IN (SELECT old_id FROM migration.document_map) GROUP BY d.id`);
  const bad = [];
  for (const s of steps) {
    if (s.starts < 1) bad.push(`${s.num}: no SUBMITTED / AUTO_APPROVED history entry`);
    if (s.n === 0) { if (s.status !== "APPROVED") bad.push(`${s.num}: no approval steps but status ${s.status}`); continue; }
    if (s.status === "APPROVED" && s.approved !== s.n) bad.push(`${s.num}: APPROVED but ${s.approved} of ${s.n} steps approved`);
    if (s.status === "PENDING" && s.pending !== 1) bad.push(`${s.num}: PENDING but ${s.pending} pending steps`);
    if (s.status === "ON_HOLD" && s.pending !== 1) bad.push(`${s.num}: ON_HOLD but ${s.pending} pending steps`);
    if (s.status === "CANCELLED" && s.rejected !== 1) bad.push(`${s.num}: CANCELLED but ${s.rejected} rejected steps`);
    if (s.status === "REVISION_REQUIRED" && s.revision < 1 && s.cur !== 0) bad.push(`${s.num}: REVISION_REQUIRED but no step is in revision`);
  }
  check(bad.length === 0, `Approval steps and history agree with the status (${steps.length} documents checked)`, bad.slice(0, 30));
  for (const b of bad) extra.push(["STEPS", "", b, ""]);
}

// (4) Numbers
{
  const dup = await newDb.select(`SELECT "documentNumber" AS num, count(*)::int AS n FROM "Document" GROUP BY 1 HAVING count(*) > 1`);
  check(dup.length === 0, "Document numbers are unique", dup.slice(0, 20).map((d) => `${d.num} x${d.n}`));
  const mrDup = await newDb.select(`SELECT m.v AS mr, array_agg(d."documentNumber") AS docs FROM "Document" d JOIN "DocumentFieldValue" f ON f."documentId" = d.id JOIN "FieldDefinition" fd ON fd.id = f."fieldDefinitionId" AND fd."fieldKey" = 'mrNumber',
      LATERAL jsonb_array_elements_text(coalesce(f."valueJson", to_jsonb(ARRAY[f."valueText"]))) AS m(v) WHERE d.status <> 'CANCELLED' GROUP BY 1 HAVING count(*) > 1`);
  check(mrDup.length === 0, "No MR number is used by two active MR documents", mrDup.slice(0, 20).map((r) => `${r.mr}: ${r.docs.join(", ")}`));
  const noMr = await newDb.select(`SELECT d."documentNumber" AS num FROM "Document" d JOIN "DocumentType" t ON t.id = d."documentTypeId" AND t.code = 'MR' WHERE NOT EXISTS (SELECT 1 FROM "DocumentFieldValue" f JOIN "FieldDefinition" fd ON fd.id = f."fieldDefinitionId" AND fd."fieldKey" = 'mrNumber' WHERE f."documentId" = d.id)`);
  check(noMr.length === 0, "Every MR document has an MR number", noMr.slice(0, 20).map((r) => r.num));
  const counters = await newDb.select(`SELECT t.code, c."periodYear" AS y, c."lastValue" AS last, s.code AS sub, p.code AS project,
      coalesce((SELECT max(substring(d."documentNumber" from '([0-9]+)$')::int) FROM "Document" d WHERE d."documentTypeId" = c."documentTypeId" AND d."documentSubtypeId" IS NOT DISTINCT FROM c."documentSubtypeId" AND d."projectId" IS NOT DISTINCT FROM c."projectId" AND d."documentNumber" LIKE '%-' || c."periodYear" || '-%'), 0) AS used
    FROM "DocumentNumberCounter" c JOIN "DocumentType" t ON t.id = c."documentTypeId" LEFT JOIN "DocumentSubtype" s ON s.id = c."documentSubtypeId" LEFT JOIN "Project" p ON p.id = c."projectId"`);
  const low = counters.filter((c) => c.last < c.used);
  check(low.length === 0, "Number counters are not behind the highest migrated number (new uploads will not collide)", low.slice(0, 20).map((c) => `${c.code} ${c.sub ?? c.project} ${c.y}: counter ${c.last}, highest used ${c.used}`));
}

// (5) Files
{
  const versions = await newDb.select(`SELECT v.id, v."filePath", v."fileSize", d."documentNumber" AS num, m.exists_on_disk, m.copied_at FROM "DocumentVersion" v JOIN "Document" d ON d.id = v."documentId" LEFT JOIN migration.file_map m ON m.version_id = v.id WHERE d.id IN (SELECT old_id FROM migration.document_map)`);
  const uncopied = versions.filter((v) => !v.copied_at);
  note(`Files recorded for migrated documents: ${versions.length}; copied: ${versions.length - uncopied.length}; not copied (missing in the old folder, re-upload): ${uncopied.length}`, uncopied.slice(0, 30).map((v) => `${v.num}: ${v.filePath}`));
  for (const v of uncopied) extra.push(["FILE_NOT_COPIED", "", v.num, v.filePath]);
  if (NEW_ROOT) {
    const bad = []; const known = new Set();
    for (const v of versions.filter((x) => x.copied_at)) {
      known.add(v.filePath.toLowerCase());
      const f = path.join(NEW_ROOT, v.filePath);
      if (!fs.existsSync(f)) bad.push(`${v.num}: copied but not on disk: ${v.filePath}`);
      else if (Number(v.fileSize) !== fs.statSync(f).size) bad.push(`${v.num}: size in database ${v.fileSize}, on disk ${fs.statSync(f).size}`);
    }
    check(bad.length === 0, "Every copied file is on disk in the new folder with the size recorded in the database", bad.slice(0, 30));
    for (const b of bad) extra.push(["FILE", "", b, ""]);
    const docsRoot = path.join(NEW_ROOT, "Documents"); const strays = [];
    const walk = (dir) => { for (const e of fs.existsSync(dir) ? fs.readdirSync(dir, { withFileTypes: true }) : []) { const p = path.join(dir, e.name); if (e.isDirectory()) walk(p); else if (!known.has(path.relative(NEW_ROOT, p).replaceAll("\\", "/").toLowerCase())) strays.push(path.relative(NEW_ROOT, p)); } };
    walk(docsRoot);
    note(`Files in the new folder's Documents tree that no migrated document points to: ${strays.length} (new uploads made after the migration are expected here)`, strays.slice(0, 20));
  } else note("File check on disk skipped (no --new-root).");
}

// (6) Downloads
{
  const n = (await newDb.select(`SELECT count(*)::int AS n FROM "DocumentDownload" WHERE "documentId" IN (SELECT old_id FROM migration.document_map)`))[0].n;
  note(`Downloads: ${n} in the new system for migrated documents; old system has ${oldDl} document downloads and ${oldErrDl} ERR downloads (users that were not migrated and documents that were not migrated are left out)`);
}

// (7) Process runs
{
  const runs = await newDb.select(`SELECT pd.name, pi.status::text AS status, count(*)::int AS n FROM "ProcessInstance" pi JOIN "ProcessDefinition" pd ON pd.id = pi.\"processDefinitionId\" GROUP BY 1, 2 ORDER BY 1, 2`);
  note("Process runs", runs.map((r) => `${r.name} / ${r.status}: ${r.n}`));
  const orphan = await newDb.select(`SELECT d."documentNumber" AS num FROM "Document" d JOIN "DocumentType" t ON t.id = d."documentTypeId" WHERE t.code IN ('MR','ERR') AND d.id IN (SELECT old_id FROM migration.document_map) AND NOT EXISTS (SELECT 1 FROM "ProcessStepDocument" l WHERE l."documentId" = d.id)`);
  check(orphan.length === 0, "Every migrated MR and ERR is in a process run", orphan.slice(0, 20).map((r) => r.num));
  const badRef = await newDb.select(`SELECT count(*)::int AS n FROM "ProcessStepDocument" l WHERE l."referenceDocumentId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "Document" r WHERE r.id = l."referenceDocumentId")`);
  check(badRef[0].n === 0, "Every reference document of a process step exists");
  const multi = await newDb.select(`SELECT count(DISTINCT err_id)::int AS n FROM migration.err_quotation_link WHERE position > 1`).catch(() => [{ n: 0 }]);
  note(`ERRs with more than one quotation (only the first is attached to the process step until the multi-reference change is built): ${multi[0].n}`);
}

// (8) What is still waiting
{
  const waiting = await newDb.select(`SELECT t.code AS tcode, d.status::text AS status, d."currentWorkflowStep" AS step, count(*)::int AS n FROM "Document" d JOIN "DocumentType" t ON t.id = d."documentTypeId" WHERE d.status IN ('PENDING','ON_HOLD','REVISION_REQUIRED') AND d.id IN (SELECT old_id FROM migration.document_map) GROUP BY 1, 2, 3 ORDER BY 1, 2, 3`);
  note("Migrated documents that are still waiting (they continue in the new system; at cutover they are re-migrated from a fresh copy)", waiting.map((w) => `${w.tcode} ${w.status} at level ${w.step}: ${w.n}`));
}
await newDb.close();

// ---- Report ---------------------------------------------------------------------------------------------------------------------
const fails = results.filter((r) => r.level === "FAIL").length;
const lines = [`# Stage 9 reconciliation report`, "", `Result: ${fails === 0 ? "ALL CHECKS PASSED" : `${fails} CHECK(S) FAILED`}.`, ""];
for (const r of results) { lines.push(`- **${r.level}** ${r.title}`); for (const d of r.detail.slice(0, 30)) lines.push(`    - ${d}`); if (r.detail.length > 30) lines.push(`    - ... and ${r.detail.length - 30} more`); }
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, "stage9-reconcile-report.md"), lines.join("\n"));
fs.writeFileSync(path.join(OUT, "stage9-reconcile-problems.csv"), "﻿" + ["kind,group,item,detail", ...extra.map((r) => r.map(csvCell).join(","))].join("\n"));
console.log(lines.join("\n"));
console.log(`\nWritten to ${OUT}`);
if (fails) process.exitCode = 1;
