// Merge a duplicate project into another one in the NEW system's database (everything that points at the duplicate is re-pointed).
// Dry run by default (read-only). Usage (run from the new system's project folder, where "pg" is installed):
//   node merge-projects.mjs "<new .env>" --find                       -> lists projects (to see ids/codes)
//   node merge-projects.mjs "<new .env>" --from <ROADS id> --to <WP03 id>             -> dry run: shows everything that would change
//   node merge-projects.mjs "<new .env>" --from <id> --to <id> --apply [--delete-source]   -> applies in ONE transaction (take a DB backup first)
import fs from "node:fs";
import pg from "pg";
const argv = process.argv.slice(2);
const envFile = argv[0];
const arg = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : null; };
const FROM = arg("--from"), TO = arg("--to"), APPLY = argv.includes("--apply"), DELSRC = argv.includes("--delete-source"), FIND = argv.includes("--find");
if (!envFile || (!FIND && (!FROM || !TO))) { console.error('Usage: node merge-projects.mjs "<new .env>" --find | --from <id> --to <id> [--apply] [--delete-source]'); process.exit(1); }
const url = fs.readFileSync(envFile, "utf8").match(/DATABASE_URL\s*=\s*(.*)/)[1].trim().replace(/^["']|["']$/g, "");
const pool = new pg.Pool({ connectionString: url, max: 1 });
const c = await pool.connect();
const q = async (t, p = []) => (await c.query(t, p)).rows;
const qi = (s) => `"${s.replace(/"/g, '""')}"`;
console.log(`DB: ${new URL(url).pathname.slice(1)} @ ${new URL(url).host}   mode: ${APPLY ? "APPLY" : "DRY RUN (read-only)"}`);
if (!APPLY) await c.query("SET default_transaction_read_only = on");

if (FIND) {
  const rows = await q(`SELECT * FROM "Project" ORDER BY 1`);
  console.log(`\n"Project" rows (${rows.length}); rows mentioning ROADS or WP03:`);
  for (const r of rows) if (JSON.stringify(r).match(/roads|wp03/i)) console.log(" ", JSON.stringify(r));
  console.log("\nall projects (id | code | name):");
  for (const r of rows) console.log(`  ${r.id} | ${r.code ?? ""} | ${r.name ?? ""}`);
  c.release(); await pool.end(); process.exit(0);
}

const [pf] = await q(`SELECT * FROM "Project" WHERE id=$1`, [FROM]); const [pt] = await q(`SELECT * FROM "Project" WHERE id=$1`, [TO]);
if (!pf || !pt) { console.error("--from or --to project id not found"); process.exit(1); }
if (FROM === TO) { console.error("--from and --to are the same"); process.exit(1); }
console.log(`\nFROM (will disappear): ${JSON.stringify(pf)}\nTO   (stays):          ${JSON.stringify(pt)}`);

// 1) every foreign key that points at "Project"
const fks = await q(`
  SELECT con.conname, cl.relname AS tbl, array_agg(att.attname::text ORDER BY k.ord) AS cols, con.confdeltype AS delact, array_length(con.conkey,1) AS n, con.conrelid
  FROM pg_constraint con JOIN pg_class cl ON cl.oid=con.conrelid JOIN pg_namespace ns ON ns.oid=cl.relnamespace
  JOIN LATERAL unnest(con.conkey) WITH ORDINALITY k(attnum,ord) ON true JOIN pg_attribute att ON att.attrelid=con.conrelid AND att.attnum=k.attnum
  WHERE con.contype='f' AND con.confrelid='"Project"'::regclass AND ns.nspname='public'
  GROUP BY con.conname, cl.relname, con.confdeltype, con.conkey, con.conrelid`);
const plan = []; let blocked = false;
console.log("\n== Foreign keys pointing at Project ==");
for (const f of fks) {
  if (f.n !== 1) { console.log(`  !! ${f.tbl} ${f.conname}: composite key, handle manually`); blocked = true; continue; }
  const col = f.cols[0];
  const [{ n }] = await q(`SELECT count(*)::int AS n FROM ${qi(f.tbl)} WHERE ${qi(col)}=$1`, [FROM]);
  // unique indexes (not the primary key) that include this column
  const uniq = await q(`
    SELECT i.indexrelid, array_agg(a.attname::text ORDER BY x.ord) AS cols FROM pg_index i
    JOIN LATERAL unnest(i.indkey) WITH ORDINALITY x(attnum,ord) ON true JOIN pg_attribute a ON a.attrelid=i.indrelid AND a.attnum=x.attnum
    WHERE i.indrelid=$1 AND i.indisunique AND NOT i.indisprimary GROUP BY i.indexrelid`, [f.conrelid]);
  let dup = 0; const dupSql = [];
  for (const u of uniq.filter((u) => u.cols.includes(col))) {
    const others = u.cols.filter((x) => x !== col);
    if (!others.length) { console.log(`  !! ${f.tbl}.${col}: unique on the project column alone, handle manually`); blocked = true; continue; }
    const cond = others.map((o) => `a.${qi(o)} IS NOT DISTINCT FROM b.${qi(o)}`).join(" AND ");
    const [{ n: d }] = await q(`SELECT count(*)::int AS n FROM ${qi(f.tbl)} a WHERE a.${qi(col)}=$1 AND EXISTS (SELECT 1 FROM ${qi(f.tbl)} b WHERE b.${qi(col)}=$2 AND ${cond})`, [FROM, TO]);
    dup += d; dupSql.push(`DELETE FROM ${qi(f.tbl)} a WHERE a.${qi(col)}=$1 AND EXISTS (SELECT 1 FROM ${qi(f.tbl)} b WHERE b.${qi(col)}=$2 AND ${cond})`);
  }
  console.log(`  ${f.tbl}.${col}: ${n} row(s) point at ${pf.code ?? pf.name}${dup ? `  (of these ${dup} would duplicate an existing WP03 row -> the duplicate is dropped)` : ""}`);
  plan.push({ tbl: f.tbl, col, n, dup, dupSql });
}

// 2) other places the project id may hide (json / text / arrays) and text mentions of the name
console.log("\n== Other columns containing the project id or the word ROADS (NOT changed automatically) ==");
const textCols = await q(`SELECT table_name, column_name, data_type FROM information_schema.columns WHERE table_schema='public' AND (data_type IN ('text','character varying','json','jsonb') OR (data_type='ARRAY'))`);
const word = (pf.code ?? pf.name ?? "ROADS");
let found = 0;
for (const t of textCols) {
  if (t.table_name === "Project" || t.table_name.startsWith("_prisma")) continue;
  const expr = `${qi(t.column_name)}::text`;
  const [{ a, b }] = await q(`SELECT count(*) FILTER (WHERE ${expr} LIKE '%' || $1 || '%')::int AS a, count(*) FILTER (WHERE ${expr} ~* ('(^|[^A-Za-z])' || $2 || '([^A-Za-z]|$)'))::int AS b FROM ${qi(t.table_name)}`, [FROM, word]);
  if (a || b) { found++; console.log(`  ${t.table_name}.${t.column_name} (${t.data_type}): contains the id in ${a} row(s); mentions "${word}" in ${b} row(s)`); }
}
if (!found) console.log("  none");

console.log(`\nSUMMARY: rows to re-point: ${plan.reduce((s, p) => s + p.n - p.dup, 0)}; duplicates dropped: ${plan.reduce((s, p) => s + p.dup, 0)}; delete source project afterwards: ${DELSRC ? "yes" : "no (it stays, now unused)"}`);
if (blocked) { console.log("Blocked items above need manual handling. Nothing changed."); process.exit(2); }
if (!APPLY) { console.log("DRY RUN: nothing was changed."); c.release(); await pool.end(); process.exit(0); }

await c.query("BEGIN");
try {
  for (const p of plan) {
    for (const sql of p.dupSql) await c.query(sql, [FROM, TO]);
    await c.query(`UPDATE ${qi(p.tbl)} SET ${qi(p.col)}=$2 WHERE ${qi(p.col)}=$1`, [FROM, TO]);
  }
  for (const p of plan) { const [{ n }] = await q(`SELECT count(*)::int AS n FROM ${qi(p.tbl)} WHERE ${qi(p.col)}=$1`, [FROM]); if (n) throw new Error(`${p.tbl}.${p.col} still has ${n} rows on the old project`); }
  if (DELSRC) await c.query(`DELETE FROM "Project" WHERE id=$1`, [FROM]);
  await c.query("COMMIT"); console.log("DONE: committed.");
} catch (e) { await c.query("ROLLBACK"); console.error("FAILED, everything rolled back:", e.message); process.exit(1); }
c.release(); await pool.end();
