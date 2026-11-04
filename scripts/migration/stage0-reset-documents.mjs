#!/usr/bin/env node
// scripts/migration/stage0-reset-documents.mjs
//
// CUTOVER RESET: removes EVERYTHING that Stages 4 to 8 migrated, so they can be run again from a fresh copy of the old system.
// It removes only what the migration created (found through the migration.* map tables): documents (with steps, history, versions,
// field values, downloads), process runs, the migrated files in the new upload folder, and the map tables themselves.
// It does NOT touch users, roles, projects, approval flows, process trees, document types or anything uploaded after the migration.
// Dry run by default; --apply deletes. Run it only when the new system is not in use.
//
//   node scripts/migration/stage0-reset-documents.mjs --new-url <new db> [--new-root "<new UPLOAD_PATH>"] [--apply]

import fs from "node:fs";
import path from "node:path";
import { arg, flag, openDb } from "./lib/db.mjs";

const NEW_URL = arg("new-url", "NEW_DATABASE_URL"), NEW_ROOT = arg("new-root", "NEW_UPLOAD_ROOT"), APPLY = flag("apply");
if (!NEW_URL) { console.error("Need --new-url."); process.exit(2); }
if (APPLY && !NEW_ROOT && !flag("keep-files")) { console.error("With --apply you must also give --new-root (the copied files are removed with the records), or --keep-files to leave the files."); process.exit(2); }
const db = await openDb(NEW_URL);
const one = async (sql) => (await db.select(sql))[0];
const has = async (t) => (await one(`SELECT to_regclass('migration.${t}') IS NOT NULL AS ok`)).ok;
if (!(await has("document_map"))) { console.log("Nothing to reset: the migration map does not exist."); await db.close(); process.exit(0); }

const nonMigrated = (await one(`SELECT count(*)::int AS n FROM "Document" WHERE id NOT IN (SELECT old_id FROM migration.document_map)`)).n;
const docs = (await one(`SELECT count(*)::int AS n FROM "Document" WHERE id IN (SELECT old_id FROM migration.document_map)`)).n;
const runs = (await has("process_run_map")) ? (await one(`SELECT count(*)::int AS n FROM "ProcessInstance" WHERE id IN (SELECT run_id FROM migration.process_run_map)`)).n : 0;
const otherRuns = (await has("process_run_map")) ? (await one(`SELECT count(*)::int AS n FROM "ProcessInstance" WHERE id NOT IN (SELECT run_id FROM migration.process_run_map)`)).n : (await one(`SELECT count(*)::int AS n FROM "ProcessInstance"`)).n;
const files = (await has("file_map")) ? await db.select(`SELECT new_path FROM migration.file_map`) : [];
console.log(`Migrated documents: ${docs}. Migrated process runs: ${runs}. Migrated files in the map: ${files.length}.`);
console.log(`Documents NOT made by the migration (kept): ${nonMigrated}. Process runs NOT made by the migration (kept): ${otherRuns}.`);
if (nonMigrated > 0) console.log("NOTE: the document number counters are kept because documents created after the migration exist.");

if (!APPLY) { console.log("\nDRY RUN - nothing was deleted. Add --apply to delete."); await db.close(); process.exit(0); }

const st = [];
if (await has("process_run_map")) st.push(`DELETE FROM "ProcessInstance" WHERE id IN (SELECT run_id FROM migration.process_run_map)`);
st.push(`DELETE FROM "AuditLog" WHERE "documentId" IN (SELECT old_id FROM migration.document_map)`);
st.push(`DELETE FROM "Document" WHERE id IN (SELECT old_id FROM migration.document_map)`); // steps, history, versions, values, downloads cascade
if (nonMigrated === 0) st.push(`DELETE FROM "DocumentNumberCounter"`);
for (const t of ["err_quotation_link", "po_invoice_link", "po_mr_link", "process_run_map", "file_map", "document_map"]) if (await has(t)) st.push(`DELETE FROM migration.${t}`);
await db.runAll(st, true);
const left = (await one(`SELECT count(*)::int AS n FROM "Document"`)).n;
console.log(`Database reset done. Documents left in the new system: ${left}.`);

let removed = 0, missing = 0;
if (NEW_ROOT) {
  for (const f of files) {
    const p = path.join(NEW_ROOT, f.new_path);
    if (fs.existsSync(p)) { fs.rmSync(p); removed++; } else missing++;
  }
  console.log(`Files removed from the new folder: ${removed} (${missing} were not there).`);
} else console.log("No --new-root given: the copied files were NOT removed. Stage 8 would report a conflict for files that changed. Run again with --new-root or empty the folder yourself.");
await db.close();
