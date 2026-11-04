// Removes documents that Stage 4 migrated, so they can be migrated again (for example after refreshing the old database copy).
// Only documents listed in migration.document_map can be removed - nothing else is ever touched.
// Usage: node scripts/migration/stage4-reset-docs.mjs --new-url <url> --numbers C0009[,C0010] [--apply]
// Default is a dry run (it only lists what would be removed).
import { openDb, lit, arg, flag } from "./lib/db.mjs";

const NEW_URL = arg("new-url", "NEW_DATABASE_URL");
const NUMBERS = (arg("numbers") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
const APPLY = flag("apply");
if (!NEW_URL || NUMBERS.length === 0) { console.error("Need --new-url and --numbers (old document numbers, e.g. C0009)."); process.exit(2); }

const db = await openDb(NEW_URL);
const rows = await db.select(`SELECT m.old_id, m.old_number, m.new_number, d.status::text AS status FROM migration.document_map m JOIN "Document" d ON d.id = m.old_id WHERE m.old_number IN (${NUMBERS.map(lit).join(",")}) ORDER BY m.old_number`);
const found = new Set(rows.map((r) => r.old_number));
for (const n of NUMBERS) if (!found.has(n)) console.log(`Not found among migrated documents (skipped): ${n}`);
for (const r of rows) console.log(`${APPLY ? "Removing" : "Would remove"}: ${r.old_number} -> ${r.new_number} (${r.status})`);
if (APPLY && rows.length) {
  const ids = rows.map((r) => lit(r.old_id)).join(",");
  await db.runAll([
    `DELETE FROM "AuditLog" WHERE "documentId" IN (${ids})`,
    `DELETE FROM migration.file_map WHERE document_id IN (${ids})`,
    `DELETE FROM migration.document_map WHERE old_id IN (${ids})`,
    `DELETE FROM "Document" WHERE id IN (${ids})`,
  ], true);
  console.log("Done. Run the batch again to migrate them from the refreshed old database.");
} else if (!APPLY) console.log("Dry run only. Add --apply to remove.");
await db.close();
