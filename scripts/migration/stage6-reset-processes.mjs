#!/usr/bin/env node
// scripts/migration/stage6-reset-processes.mjs
// Removes everything Stage 6 created (the process runs listed in migration.process_run_map and the process trees
// it created), so Stage 6 can be run again, for example after the process trees were redesigned. Documents are not touched.
// Dry run by default (it only counts).   node scripts/migration/stage6-reset-processes.mjs --new-url <url> [--apply]
import { arg, flag, lit, openDb } from "./lib/db.mjs";

const NEW_URL = arg("new-url", "NEW_DATABASE_URL");
const APPLY = flag("apply");
if (!NEW_URL) { console.error("Need --new-url."); process.exit(2); }
const TREE_NAMES = ["Comparison to Invoice", "Material Req to Invoice", "Credit MR to Invoice", "Cash MR", "ERR to Receipt"];

const db = await openDb(NEW_URL);
const mapped = await db.select(`SELECT count(*)::int AS n FROM migration.process_run_map`).catch(() => [{ n: 0 }]);
const trees = await db.select(`SELECT d.name, (SELECT count(*) FROM "ProcessInstance" i WHERE i."processDefinitionId" = d.id)::int AS runs FROM "ProcessDefinition" d WHERE d.name IN (${TREE_NAMES.map(lit).join(",")}) ORDER BY d.name`);
console.log(`${APPLY ? "Removing" : "Would remove"}: ${mapped[0].n} migrated process runs; process trees: ${trees.map((t) => `${t.name} (${t.runs} runs in total)`).join(", ") || "none"}.`);
const unmigrated = trees.reduce((n, t) => n + t.runs, 0) - mapped[0].n;
if (unmigrated > 0) { console.error(`STOP: ${unmigrated} run(s) in these trees were NOT created by the migration (real work in the new system). Nothing removed.`); await db.close(); process.exit(3); }
if (APPLY) {
  await db.runAll([
    `DELETE FROM "ProcessInstance" WHERE id IN (SELECT run_id FROM migration.process_run_map)`,
    `DELETE FROM migration.process_run_map`,
    `DELETE FROM "ProcessDefinition" WHERE name IN (${TREE_NAMES.map(lit).join(",")})`,
  ], true);
  console.log("Done. Run Stage 6 again.");
} else console.log("Dry run only. Add --apply to remove.");
await db.close();
