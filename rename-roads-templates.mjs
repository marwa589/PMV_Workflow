// Renames the two workflow templates that carry "ROADS" in their label. Dry run unless --apply.
// Usage: node rename-roads-templates.mjs "<new .env>" [--apply]
import fs from "node:fs";
import pg from "pg";
const APPLY = process.argv.includes("--apply");
const url = fs.readFileSync(process.argv[2], "utf8").match(/DATABASE_URL\s*=\s*(.*)/)[1].trim().replace(/^["']|["']$/g, "");
const pool = new pg.Pool({ connectionString: url, max: 1 }); const c = await pool.connect();
const CH = [
  { id: "mgda5a43164cbed3cf4df894", oldCode: "BPK-ROADS-TCH-KAFD-COMP", newCode: "BPK-WP03-TCH-KAFD-COMP",
    oldName: "Batching Plant Khobar, Roads, Tachalih, KAFD: Comparison (George, Marc)", newName: "Batching Plant Khobar, WP03, Tachalih, KAFD: Comparison (George, Marc)" },
  { id: "cmw62vnhg007unodjyrt3pzyw", oldCode: "Roads-MR", newCode: "WP03-MR",
    oldName: "Roads: Material Req (Bernabie, Elias Nassar, Marc)", newName: "WP03: Material Req (Bernabie, Elias Nassar, Marc)" },
];
await c.query("BEGIN");
try {
  for (const t of CH) {
    const [cur] = (await c.query(`SELECT code,name FROM "DocumentWorkflowTemplate" WHERE id=$1`, [t.id])).rows;
    if (!cur) throw new Error(`template ${t.id} not found`);
    if (cur.code === t.newCode) { console.log(`${t.id}: already renamed`); continue; }
    if (cur.code !== t.oldCode || cur.name !== t.oldName) throw new Error(`template ${t.id} is not in the expected state: ${JSON.stringify(cur)}`);
    const [{ n }] = (await c.query(`SELECT count(*)::int AS n FROM "DocumentWorkflowTemplate" WHERE code=$1 AND id<>$2`, [t.newCode, t.id])).rows;
    if (n) throw new Error(`code ${t.newCode} is already used by another template`);
    await c.query(`UPDATE "DocumentWorkflowTemplate" SET code=$2, name=$3, "updatedAt"=now() WHERE id=$1`, [t.id, t.newCode, t.newName]);
    console.log(`${t.oldCode}  ->  ${t.newCode}\n   "${t.oldName}"\n   -> "${t.newName}"`);
  }
  if (APPLY) { await c.query("COMMIT"); console.log("DONE: committed."); } else { await c.query("ROLLBACK"); console.log("DRY RUN: nothing was changed (add --apply)."); }
} catch (e) { await c.query("ROLLBACK"); console.error("FAILED, nothing changed:", e.message); process.exit(1); }
c.release(); await pool.end();
