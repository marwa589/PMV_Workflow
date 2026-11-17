// READ-ONLY. Shows what ROADS is used for besides plain project links. Usage: node inspect-roads.mjs "<new .env>"
import fs from "node:fs";
import pg from "pg";
const url = fs.readFileSync(process.argv[2], "utf8").match(/DATABASE_URL\s*=\s*(.*)/)[1].trim().replace(/^["']|["']$/g, "");
const pool = new pg.Pool({ connectionString: url, max: 1 }); const c = await pool.connect(); await c.query("SET default_transaction_read_only = on");
const R = "cmw60z7sq005kukdjjev6fl2d", W = "mgfae14e4cf02bda2656565f";
const show = async (title, sql, p = []) => { const r = (await c.query(sql, p)).rows; console.log(`\n== ${title} (${r.length})`); for (const x of r) console.log("  " + JSON.stringify(x)); };
await show("workflow assignments ROADS vs WP03", `SELECT * FROM "DocumentWorkflowAssignment" WHERE "projectId" = ANY($1) ORDER BY "projectId"`, [[R, W]]);
await show("workflow templates that mention ROADS", `SELECT * FROM "DocumentWorkflowTemplate" WHERE code ~* 'roads' OR name ~* 'roads'`);
await show("how many documents use each of those templates", `SELECT t.code, t.name, (SELECT count(*)::int FROM "Document" d WHERE d."workflowTemplateId"=t.id) AS documents FROM "DocumentWorkflowTemplate" t WHERE t.code ~* 'roads' OR t.name ~* 'roads'`);
await show("WP03 templates (for comparison)", `SELECT t.code, t.name, (SELECT count(*)::int FROM "Document" d WHERE d."workflowTemplateId"=t.id) AS documents FROM "DocumentWorkflowTemplate" t WHERE t.code ~* 'wp03' OR t.name ~* 'wp03'`);
await show("the 5 ROADS documents", `SELECT "documentNumber", title, status::text AS status FROM "Document" WHERE "projectId"=$1`, [R]);
await show("project scopes: users limited to ROADS vs WP03", `SELECT "projectId", count(*)::int AS n FROM "UserAssignmentProjectScope" WHERE "projectId" = ANY($1) GROUP BY 1`, [[R, W]]);
c.release(); await pool.end();
