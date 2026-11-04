#!/usr/bin/env node
// scripts/migration/audit-old-db.mjs
//
// PHASE 0 of the data migration: a READ-ONLY audit of the OLD (hard-coded) system's database.
// It never writes to the database. Run it against a restored copy of the old database, then send the
// generated report back so the migration rules can be confirmed against the real data.
//
//   node scripts/migration/audit-old-db.mjs --old-url postgresql://user:pass@host:5432/olddb \
//        [--upload-root "D:\OneDrive\PMV\uploads"] [--legacy-root "D:\old-app"] [--out ./migration-output]
//
// Environment alternatives: OLD_DATABASE_URL, OLD_UPLOAD_ROOT, OLD_LEGACY_ROOT.
//   --upload-root   the old UPLOAD_PATH folder (the OneDrive folder). Enables the file checks.
//   --legacy-root   the folder the old app ran from. Paths stored as "uploads/..." resolve against it.
//
// Output: <out>/audit-<timestamp>/audit-report.md and audit-report.json

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// ---------------------------------------------------------------------------------------------
// Arguments
// ---------------------------------------------------------------------------------------------
function arg(name, envName) {
  const index = process.argv.indexOf(`--${name}`);
  if (index !== -1 && process.argv[index + 1]) return process.argv[index + 1];
  return envName ? process.env[envName] : undefined;
}

const OLD_URL = arg("old-url", "OLD_DATABASE_URL");
const UPLOAD_ROOT = arg("upload-root", "OLD_UPLOAD_ROOT");
const LEGACY_ROOT = arg("legacy-root", "OLD_LEGACY_ROOT");
const OUT_DIR = arg("out") || "./migration-output";
const DRIVER = arg("driver", "OLD_DB_DRIVER") || "auto"; // auto | pg | psql

if (!OLD_URL) {
  console.error("Missing --old-url (or OLD_DATABASE_URL).");
  process.exit(2);
}

// ---------------------------------------------------------------------------------------------
// Facts that live in the OLD CODE (not in its database). The audit checks the database against them.
// Source files: src/lib/workflow-locations.ts, avk-access.ts, mohamed-document-workflow.ts,
// ready-mix-mr-access.ts, po-access.ts, invoice-access.ts, review-all-access.ts, err/uploader-access.ts
// ---------------------------------------------------------------------------------------------
const CODE_LOCATION_EMAILS = {
  AVR: ["dispatcher.pmv@ahmadiah.com", "mohammad.mehieddine@ahmadiah.com"],
  AVK: ["joemar.paraiso@ahmadiah.com", "bernabie.rocha@ahmadiah.com", "mohamed.mahran@ahmadiah-sa.com"],
  KUWAIT: [
    "omar.merzek@ahmadiah.com",
    "george.azzi@ahmadiah.com",
    "marc.baddour@ahmadiah.com",
    "aqueel.sayed@ahmadiah.com",
    "mohamed.mahmoud@ahmadiah.com",
    "mohamed.shawky@ahmadiah.com",
    "jad.kabalan@ahmadiah.com",
  ],
};
// Accounts the old code names directly (approvers, special viewers/uploaders).
const CODE_NAMED_ACCOUNTS = [
  "ramzi@ahmadiah.com", // approves AVK-uploader MRs; MR/comparison viewer
  "marc.baddour@ahmadiah.com", // PMV Manager (APPROVER_3); bulk-review tester
  "george.azzi@ahmadiah.com", // Workshop Manager (APPROVER_2)
  "elie.azzam@ahmadiah.com", // Ready Mix Khobar director
  "omar.merzek@ahmadiah.com", // PO viewer, Ready Mix viewer
  "muneer.kottappuram@ahmadiah.com", // confirms PO receipt, Kuwait invoices
  "reine.alsouki@ahmadiah.com", // global ERR uploader (also OTP test user)
  "edmond.houeiss@ahmadiah.com", // global ERR uploader
  "dispatcher.pmv@ahmadiah.com", // ERRO uploader
];
const TEMP_EMAIL_PATTERNS = ["%@example.com", "%@role-migration.local"];
const WINDOWS_PATH_LIMIT = 240;

// ---------------------------------------------------------------------------------------------
// Report model
// ---------------------------------------------------------------------------------------------
const report = { generatedAt: new Date().toISOString(), database: redact(OLD_URL), sections: [], summary: [] };

function redact(url) {
  try {
    const parsed = new URL(url);
    return `${parsed.protocol}//${parsed.hostname}${parsed.port ? `:${parsed.port}` : ""}${parsed.pathname}`;
  } catch {
    return "(unparseable url)";
  }
}

let currentSection = null;
function section(title) {
  currentSection = { title, items: [] };
  report.sections.push(currentSection);
}

// severity: "info" (a table to read), "warn" (needs a decision or is suspicious), "block" (must be fixed before migrating)
function addItem(item) {
  currentSection.items.push(item);
  if (item.severity !== "info" && item.count > 0) {
    report.summary.push({ severity: item.severity, section: currentSection.title, id: item.id, title: item.title, count: item.count });
  }
}

const SAMPLE_LIMIT = 40;
let client;

// ---------------------------------------------------------------------------------------------
// Database access. Uses the "pg" package when it is installed (it is a dependency of this project) and
// falls back to the "psql" command line client otherwise. Both are strictly read-only.
// ---------------------------------------------------------------------------------------------
async function openDb(url) {
  if (DRIVER !== "psql") {
    try {
      const pg = (await import("pg")).default;
      const pgClient = new pg.Client({ connectionString: url });
      await pgClient.connect();
      // Hard guarantee: this session cannot write.
      await pgClient.query("SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY");
      await pgClient.query("BEGIN READ ONLY");
      console.log("Driver: pg (read-only transaction)");
      return {
        query: (text) => pgClient.query(text),
        close: async () => {
          await pgClient.query("ROLLBACK");
          await pgClient.end();
        },
      };
    } catch (error) {
      if (DRIVER === "pg") throw error;
      console.log(`Driver: "pg" not usable (${error.code ?? error.message}); falling back to psql.`);
    }
  }
  console.log("Driver: psql (default_transaction_read_only=on)");
  return {
    query: async (text) => {
      const out = execFileSync(
        "psql",
        [url, "-X", "-q", "-t", "-A", "-v", "ON_ERROR_STOP=1", "-c", `SELECT coalesce(json_agg(t), '[]'::json) FROM (${text}) t`],
        { env: { ...process.env, PGOPTIONS: "-c default_transaction_read_only=on" }, maxBuffer: 1024 * 1024 * 1024, encoding: "utf8" },
      );
      return { rows: JSON.parse(out.trim() || "[]") };
    },
    close: async () => {},
  };
}

async function sqlCheck({ id, title, severity = "info", sql, note, finding = false }) {
  const count = Number((await client.query(`WITH q AS (${sql}) SELECT count(*)::int AS n FROM q`)).rows[0].n);
  const rows = (await client.query(`WITH q AS (${sql}) SELECT * FROM q LIMIT ${SAMPLE_LIMIT}`)).rows;
  // A "finding" check lists problems: no rows means all is well. A table check always shows its rows.
  addItem({ id, title, severity: finding ? severity : "info", count: finding ? count : 0, rowCount: count, rows, note });
}

function jsCheck({ id, title, severity = "info", rows, note, finding = false, total }) {
  const count = total ?? rows.length;
  addItem({ id, title, severity: finding ? severity : "info", count: finding ? count : 0, rowCount: count, rows: rows.slice(0, SAMPLE_LIMIT), note });
}

// ---------------------------------------------------------------------------------------------
// Markdown rendering
// ---------------------------------------------------------------------------------------------
function cell(value) {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object") return JSON.stringify(value);
  return String(value).replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

function renderTable(rows) {
  if (rows.length === 0) return "_no rows_\n";
  const columns = Object.keys(rows[0]);
  const lines = [`| ${columns.join(" | ")} |`, `| ${columns.map(() => "---").join(" | ")} |`];
  for (const row of rows) lines.push(`| ${columns.map((column) => cell(row[column])).join(" | ")} |`);
  return `${lines.join("\n")}\n`;
}

function renderMarkdown() {
  const out = [];
  out.push("# Old system audit report", "");
  out.push(`Generated: ${report.generatedAt}`, `Database: ${report.database}`, "");
  out.push("This report was produced by a read-only script. Nothing was changed.", "");

  const blocks = report.summary.filter((entry) => entry.severity === "block");
  const warns = report.summary.filter((entry) => entry.severity === "warn");
  out.push("## Summary of findings", "");
  out.push(`- **Blocking** (must be resolved before migrating): ${blocks.length}`);
  out.push(`- **Needs a decision or a look**: ${warns.length}`, "");
  if (report.summary.length > 0) {
    out.push("| Severity | Check | What | Rows |", "| --- | --- | --- | --- |");
    for (const entry of [...blocks, ...warns]) {
      out.push(`| ${entry.severity.toUpperCase()} | ${entry.id} | ${cell(entry.title)} | ${entry.count} |`);
    }
    out.push("");
  } else {
    out.push("No findings.", "");
  }

  for (const sectionEntry of report.sections) {
    out.push(`## ${sectionEntry.title}`, "");
    for (const item of sectionEntry.items) {
      const tag = item.severity === "info" ? "" : item.count > 0 ? ` **[${item.severity.toUpperCase()}: ${item.count}]**` : " (ok)";
      out.push(`### ${item.id} ${item.title}${tag}`, "");
      if (item.note) out.push(`${item.note}`, "");
      if (item.rowCount > item.rows.length) out.push(`_Showing ${item.rows.length} of ${item.rowCount} rows._`, "");
      out.push(renderTable(item.rows));
    }
  }
  return out.join("\n");
}

// ---------------------------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------------------------
function inList(values) {
  return values.map((value) => `'${String(value).replace(/'/g, "''")}'`).join(", ");
}

const TEMP_WHERE = (column = "u.email") => TEMP_EMAIL_PATTERNS.map((pattern) => `${column} ILIKE '${pattern}'`).join(" OR ");

// ---------------------------------------------------------------------------------------------
// Checks
// ---------------------------------------------------------------------------------------------
async function inventory() {
  section("A. Inventory");
  const tables = (await client.query(
    `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' AND table_name <> '_prisma_migrations' ORDER BY table_name`,
  )).rows.map((row) => row.table_name);
  const rows = [];
  for (const table of tables) {
    const count = (await client.query(`SELECT count(*)::int AS n FROM "${table}"`)).rows[0].n;
    rows.push({ table, rows: count });
  }
  jsCheck({ id: "A1", title: "Row count per table", rows, note: "Every table of the old schema." });
  // Look the table up first: a failing query would abort the read-only transaction.
  const hasMigrationsTable = (await client.query(`SELECT 1 AS ok FROM information_schema.tables WHERE table_schema = 'public' AND table_name = '_prisma_migrations'`)).rows.length > 0;
  const applied = hasMigrationsTable
    ? await client.query(`SELECT count(*)::int AS applied_migrations, max(finished_at) AS last_finished FROM "_prisma_migrations" WHERE finished_at IS NOT NULL`)
    : null;
  jsCheck({
    id: "A2",
    title: "Applied Prisma migrations",
    rows: applied ? applied.rows : [{ n: "n/a (no _prisma_migrations table: a plain dump?)" }],
    note: "The old repo has 25 migrations (last: 20261010090000_add_per_user_download_tracking). A lower count means the database is older than the code.",
  });
  // Schema drift: compare the real database with the schema the migration was written against.
  const expected = JSON.parse(fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "old-schema-expected.json"), "utf8"));
  const dbColumns = (await client.query(`SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = 'public'`)).rows;
  const dbEnums = (await client.query(`SELECT t.typname AS enum_name, e.enumlabel AS label FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid`)).rows;
  const colsByTable = new Map();
  for (const row of dbColumns) {
    if (!colsByTable.has(row.table_name)) colsByTable.set(row.table_name, new Set());
    colsByTable.get(row.table_name).add(row.column_name);
  }
  const enumsByName = new Map();
  for (const row of dbEnums) {
    if (!enumsByName.has(row.enum_name)) enumsByName.set(row.enum_name, new Set());
    enumsByName.get(row.enum_name).add(row.label);
  }
  const drift = [];
  for (const [table, columns] of Object.entries(expected.tables)) {
    const actual = colsByTable.get(table);
    if (!actual) {
      drift.push({ kind: "table missing", object: table, detail: "" });
      continue;
    }
    for (const column of columns) if (!actual.has(column)) drift.push({ kind: "column missing", object: `${table}.${column}`, detail: "in schema.prisma, not in the database" });
    for (const column of actual) if (!columns.includes(column)) drift.push({ kind: "extra column", object: `${table}.${column}`, detail: "in the database, not in schema.prisma" });
  }
  for (const [name, labels] of Object.entries(expected.enums)) {
    const actual = enumsByName.get(name);
    if (!actual) {
      drift.push({ kind: "enum missing", object: name, detail: "" });
      continue;
    }
    for (const label of labels) if (!actual.has(label)) drift.push({ kind: "enum value missing", object: `${name}.${label}`, detail: "in schema.prisma, not in the database" });
    for (const label of actual) if (!labels.includes(label)) drift.push({ kind: "extra enum value", object: `${name}.${label}`, detail: "in the database, not in schema.prisma" });
  }
  jsCheck({
    id: "A3",
    title: "Database differs from the old schema.prisma",
    severity: "block",
    finding: true,
    rows: drift,
    note: "The migration was written against the old repository's schema.prisma (main branch). Any difference means the real database was changed outside the schema, and the migration must be told about it before it runs.",
  });
}

async function users() {
  section("B. Users, roles and accounts");

  await sqlCheck({
    id: "B1",
    title: "Users by role and location",
    sql: `SELECT u.role::text AS role, u.location::text AS location, count(*)::int AS users FROM "User" u GROUP BY 1, 2 ORDER BY 1, 2`,
  });

  await sqlCheck({
    id: "B2",
    title: "Extra roles held through UserRoleAssignment",
    sql: `SELECT u.email, u.role::text AS primary_role, string_agg(a.role::text, ', ' ORDER BY a.role) AS extra_roles
          FROM "UserRoleAssignment" a JOIN "User" u ON u.id = a."userId" GROUP BY u.email, u.role ORDER BY u.email`,
    note: "Old users can hold several roles. The new system has one fixed user type plus role assignments, so each of these needs a mapping.",
  });

  await sqlCheck({
    id: "B3",
    title: "Temporary / orphan accounts (to be dropped) and the records attached to them",
    severity: "warn",
    finding: true,
    sql: `SELECT u.email, u.role::text AS role,
            (SELECT count(*) FROM "Document" d WHERE d."createdById" = u.id)::int AS docs_created,
            (SELECT count(*) FROM "DocumentVersion" v WHERE v."uploadedById" = u.id)::int AS versions_uploaded,
            (SELECT count(*) FROM "ApprovalHistory" h WHERE h."performedById" = u.id)::int AS approvals_done,
            (SELECT count(*) FROM "Err" e WHERE e."createdById" = u.id OR e."projectDirectorId" = u.id OR e."currentApproverId" = u.id)::int AS errs,
            (SELECT count(*) FROM "ErrApprovalHistory" h WHERE h."performedById" = u.id)::int AS err_actions,
            (SELECT count(*) FROM "PurchaseOrder" p WHERE p."uploadedById" = u.id OR p."receivedById" = u.id)::int AS pos,
            (SELECT count(*) FROM "AuditLog" a WHERE a."performedById" = u.id)::int AS audit_rows
          FROM "User" u WHERE ${TEMP_WHERE()} ORDER BY u.email`,
    note: "You decided to drop @example.com and @role-migration.local accounts. If one still owns documents, approvals or ERRs, dropping it would orphan real history: rows listed here with non-zero counts need a decision (re-assign to the real account, as the old cleanup script did).",
  });

  await sqlCheck({
    id: "B4",
    title: "Emails that are not lower-case/trimmed, or that collide once normalised",
    severity: "block",
    finding: true,
    sql: `SELECT email, lower(btrim(email)) AS normalised, (SELECT count(*) FROM "User" x WHERE lower(btrim(x.email)) = lower(btrim(u.email)))::int AS same_after_normalising
          FROM "User" u WHERE email <> lower(btrim(email)) OR (SELECT count(*) FROM "User" x WHERE lower(btrim(x.email)) = lower(btrim(u.email))) > 1`,
    note: "The new system treats the email as the login. Two accounts that differ only by case would collide.",
  });

  await sqlCheck({
    id: "B5",
    title: "Clerks and approvers without a location",
    severity: "warn",
    finding: true,
    sql: `SELECT email, role::text AS role FROM "User" WHERE role IN ('CLERK','APPROVER_1','APPROVER_2','APPROVER_3') AND location IS NULL ORDER BY email`,
    note: "The old workflow picked approvers from the uploader's location. Users without one fall back to hard-coded email lists.",
  });

  await sqlCheck({
    id: "B6",
    title: "Accounts with a stored signature file",
    sql: `SELECT count(*) FILTER (WHERE "signaturePath" IS NOT NULL)::int AS with_signature, count(*)::int AS users,
                 count(DISTINCT "preferredSignatureWidth")::int AS distinct_widths FROM "User"`,
    note: "preferredSignatureWidth has no column in the new schema.",
  });

  // Hard-coded email lists in the code vs. the database.
  const dbUsers = (await client.query(`SELECT lower(btrim(email)) AS email, location::text AS location, role::text AS role FROM "User"`)).rows;
  const byEmail = new Map(dbUsers.map((user) => [user.email, user]));
  const missing = [];
  const mismatch = [];
  for (const [location, emails] of Object.entries(CODE_LOCATION_EMAILS)) {
    for (const email of emails) {
      const user = byEmail.get(email);
      if (!user) missing.push({ email, expected_by_code: `location ${location}` });
      else if (user.location !== location) mismatch.push({ email, code_location: location, database_location: user.location ?? "(null)" });
    }
  }
  for (const email of CODE_NAMED_ACCOUNTS) {
    if (!byEmail.has(email)) missing.push({ email, expected_by_code: "named directly in code" });
  }
  jsCheck({
    id: "B7",
    title: "Accounts the old code names that are missing from the database",
    severity: "warn",
    finding: true,
    rows: missing,
    note: "Each of these emails is wired into a rule in the old code (location, approver, viewer or uploader). If the account is missing, the rule cannot be migrated for it.",
  });
  jsCheck({
    id: "B8",
    title: "Users whose stored location differs from the location hard-coded in the old code",
    severity: "warn",
    finding: true,
    rows: mismatch,
    note: "In the old system the location of document uploads came from the user row, but approver routing used the email lists in code. A mismatch shows which source was really in effect.",
  });

  await sqlCheck({
    id: "B9",
    title: "ERR access entries (ErrUserAccess) by role and project",
    sql: `SELECT a.role::text AS access_role, coalesce(p.name, '(all projects)') AS project, a."isActive" AS active, count(*)::int AS entries,
                 string_agg(u.email, ', ' ORDER BY u.email) AS users
          FROM "ErrUserAccess" a JOIN "User" u ON u.id = a."userId" LEFT JOIN "ErrProject" p ON p.id = a."projectId"
          GROUP BY 1, 2, 3 ORDER BY 1, 2`,
  });

  await sqlCheck({
    id: "B10",
    title: "ERR_USER accounts without any ERR access entry",
    severity: "warn",
    finding: true,
    sql: `SELECT u.email, u.name FROM "User" u WHERE u.role = 'ERR_USER' AND NOT EXISTS (SELECT 1 FROM "ErrUserAccess" a WHERE a."userId" = u.id) ORDER BY u.email`,
    note: "The old code also grants ERR upload by name (Reine Al Souki, Edmond Houeiss) and by email; those accounts show up here and need an explicit role in the new system.",
  });
}

async function documents() {
  section("C. Documents (MR, Comparison, Custody)");

  await sqlCheck({
    id: "C1",
    title: "Documents by type, subtype and status",
    sql: `SELECT "documentType"::text AS type, coalesce("comparisonType"::text, "mrType"::text, "documentSubtype", '(none)') AS subtype, status::text AS status, count(*)::int AS docs
          FROM "Document" GROUP BY 1, 2, 3 ORDER BY 1, 2, 3`,
  });

  await sqlCheck({
    id: "C2",
    title: "Documents by uploader location and project name (free text)",
    sql: `SELECT coalesce(d."uploaderLocation"::text, '(null)') AS uploader_location, coalesce(d."projectName", '(null)') AS project_name, d."documentType"::text AS type, count(*)::int AS docs
          FROM "Document" d GROUP BY 1, 2, 3 ORDER BY 1, 2, 3`,
    note: "Project names here become Projects in the new system. Expected: AVR, AVK, Ready Mix Khobar, and the Kuwait catch-all for rows without a project.",
  });

  await sqlCheck({
    id: "C3",
    title: "In-flight documents (not yet in a final state)",
    sql: `SELECT d."documentNumber", d."documentType"::text AS type, d.status::text AS status, d."currentWorkflowStep" AS flow_step, cu.email AS uploader,
                 ca.email AS current_approver, d."currentApproverAssignedAt" AS assigned_at, d."createdAt"
          FROM "Document" d JOIN "User" cu ON cu.id = d."createdById" LEFT JOIN "User" ca ON ca.id = d."currentApproverId"
          WHERE d.status IN ('PENDING_APPROVER_1','PENDING_APPROVER_2','PENDING_APPROVER_3','REVISION_REQUIRED') ORDER BY d."createdAt"`,
    note: "You decided to migrate these mid-flow: their approval levels are rebuilt from the status, the flow, and the history.",
  });

  await sqlCheck({
    id: "C4",
    title: "Document numbers that do not follow the expected pattern",
    severity: "warn",
    finding: true,
    sql: `SELECT "documentNumber", "documentType"::text AS type FROM "Document"
          WHERE ("documentType" = 'CUSTODY' AND "documentNumber" !~ '^C[0-9]{4,}$') OR ("documentType" <> 'CUSTODY' AND "documentNumber" !~ '^DOC-[0-9]{4,}$')`,
    note: "Old numbers are replaced by the new TYPE-SUB-YYYY-NNNN convention. The old number is kept in the migration map so it can be traced.",
  });

  await sqlCheck({
    id: "C5",
    title: "Documents without any file version",
    severity: "block",
    finding: true,
    sql: `SELECT d."documentNumber", d.status::text AS status FROM "Document" d WHERE NOT EXISTS (SELECT 1 FROM "DocumentVersion" v WHERE v."documentId" = d.id)`,
  });

  await sqlCheck({
    id: "C6",
    title: "currentVersion differs from the highest stored version",
    severity: "warn",
    finding: true,
    sql: `SELECT d."documentNumber", d."currentVersion", max(v."versionNumber") AS max_version
          FROM "Document" d JOIN "DocumentVersion" v ON v."documentId" = d.id GROUP BY d.id HAVING d."currentVersion" <> max(v."versionNumber")`,
  });

  await sqlCheck({
    id: "C7",
    title: "Documents whose version numbers have gaps",
    severity: "warn",
    finding: true,
    sql: `SELECT d."documentNumber", min(v."versionNumber") AS first_version, max(v."versionNumber") AS last_version, count(*)::int AS versions
          FROM "Document" d JOIN "DocumentVersion" v ON v."documentId" = d.id GROUP BY d.id
          HAVING max(v."versionNumber") - min(v."versionNumber") + 1 <> count(*)`,
  });

  await sqlCheck({
    id: "C8",
    title: "Status disagrees with the approval history",
    severity: "warn",
    finding: true,
    sql: `SELECT d."documentNumber", d.status::text AS status,
                 (SELECT string_agg(DISTINCT h.action::text, ', ') FROM "ApprovalHistory" h WHERE h."documentId" = d.id) AS actions_seen
          FROM "Document" d
          WHERE (d.status = 'APPROVED' AND NOT EXISTS (SELECT 1 FROM "ApprovalHistory" h WHERE h."documentId" = d.id AND h.action = 'APPROVED'))
             OR (d.status = 'REJECTED' AND NOT EXISTS (SELECT 1 FROM "ApprovalHistory" h WHERE h."documentId" = d.id AND h.action = 'REJECTED'))
             OR NOT EXISTS (SELECT 1 FROM "ApprovalHistory" h WHERE h."documentId" = d.id AND h.action = 'SUBMITTED')`,
    note: "APPROVED/REJECTED documents with no matching history entry, or documents with no SUBMITTED entry. The new approval steps for those would have to be inferred.",
  });

  await sqlCheck({
    id: "C9",
    title: "Uploader location on the document differs from the uploader's current location",
    severity: "warn",
    finding: true,
    sql: `SELECT d."documentNumber", d."uploaderLocation"::text AS doc_location, u.location::text AS user_location, u.email
          FROM "Document" d JOIN "User" u ON u.id = d."createdById" WHERE d."uploaderLocation" IS DISTINCT FROM u.location`,
    note: "Old visibility used the uploader's CURRENT location, not the stored one. Rows here may change who sees them.",
  });

  await sqlCheck({
    id: "C10",
    title: "MR to Comparison links",
    sql: `SELECT CASE WHEN mr."relatedComparisonId" IS NULL THEN 'MR without comparison' ELSE 'MR linked to comparison (' || c.status::text || ')' END AS kind, count(*)::int AS mrs
          FROM "Document" mr LEFT JOIN "Document" c ON c.id = mr."relatedComparisonId"
          WHERE mr."documentType" = 'MATERIAL_REQUISITION' GROUP BY 1 ORDER BY 1`,
    note: "MRs without a comparison belong to the third process tree (starts at MR). Linked ones belong to Comparison to MR to PO to Invoice.",
  });

  await sqlCheck({
    id: "C11",
    title: "Comparisons used by more than one MR",
    sql: `SELECT c."documentNumber" AS comparison, count(*)::int AS mrs FROM "Document" mr JOIN "Document" c ON c.id = mr."relatedComparisonId" GROUP BY c.id HAVING count(*) > 1 ORDER BY 2 DESC`,
    note: "One comparison feeding several MRs: each MR becomes its own process run that shares the comparison.",
  });

  await sqlCheck({
    id: "C12",
    title: "Configured workflow templates used by documents",
    sql: `SELECT coalesce(t.name, '(no template: hard-coded location routing)') AS template, d."documentType"::text AS type, count(*)::int AS docs
          FROM "Document" d LEFT JOIN "DocumentWorkflowTemplate" t ON t.id = d."workflowTemplateId" GROUP BY 1, 2 ORDER BY 1, 2`,
  });

  await sqlCheck({
    id: "C13",
    title: "Approval history actions",
    sql: `SELECT action::text AS action, count(*)::int AS rows, count(DISTINCT "documentId")::int AS documents FROM "ApprovalHistory" GROUP BY 1 ORDER BY 1`,
  });

  await sqlCheck({
    id: "C14",
    title: "Documents per type and year (drives the new numbering)",
    sql: `SELECT "documentType"::text AS type, coalesce("comparisonType"::text, "mrType"::text, "documentSubtype", '(none)') AS subtype, extract(year FROM "createdAt")::int AS year, count(*)::int AS docs
          FROM "Document" GROUP BY 1, 2, 3 ORDER BY 1, 2, 3`,
    note: "New numbers are TYPE-SUB-YYYY-NNNN, counted per type + subtype + year. The year comes from createdAt, ordered by creation time.",
  });

  await sqlCheck({
    id: "C15",
    title: "MRs without an MR number, and duplicated MR numbers",
    severity: "warn",
    finding: true,
    sql: `SELECT mr_number, docs FROM (SELECT coalesce("mrNumber", '(missing)') AS mr_number, count(*)::int AS docs FROM "Document" WHERE "documentType" = 'MATERIAL_REQUISITION' GROUP BY 1) t
          WHERE mr_number = '(missing)' OR docs > 1 ORDER BY docs DESC`,
    note: "mrNumber becomes a custom field on the MR type.",
  });

  await sqlCheck({
    id: "C16",
    title: "Per-user download tracking",
    sql: `SELECT (SELECT count(*) FROM "DocumentDownload")::int AS document_download_rows, (SELECT count(*) FROM "ErrDownload")::int AS err_download_rows,
                 (SELECT count(*) FROM "Document" WHERE "downloadedAt" IS NOT NULL)::int AS docs_with_old_shared_flag`,
    note: "The old shared downloadedAt flag is no longer used by the new system; the per-user rows are what gets migrated (they drive the green 'approved and downloaded' state).",
  });

  await sqlCheck({
    id: "C17",
    title: "Deletion requests",
    sql: `SELECT status::text AS status, count(*)::int AS requests FROM "DeletionRequest" GROUP BY 1 ORDER BY 1`,
  });
}

// Replays every document's approval history to find the chain of people it really went through.
async function flows() {
  section("D. Approval flows: what is configured and what actually happened");

  await sqlCheck({
    id: "D1",
    title: "Configured workflow templates and their steps",
    sql: `SELECT t.name AS template, t."isActive" AS active, coalesce(t.location::text, '*') AS location, t."documentType"::text AS type,
                 coalesce(t."documentSubtype", '*') AS subtype, coalesce(t."projectName", '*') AS project,
                 s."stepNumber" AS step, s.role::text AS role, coalesce(u.email, '(by role)') AS approver
          FROM "DocumentWorkflowTemplate" t LEFT JOIN "DocumentWorkflowStep" s ON s."templateId" = t.id LEFT JOIN "User" u ON u.id = s."approverUserId"
          ORDER BY t.name, s."stepNumber"`,
    note: "Database-configured flows. Documents without one used the location/email routing hard-coded in the old code.",
  });

  const history = (await client.query(`
    SELECT d.id, d."documentNumber", d."documentType"::text AS type, coalesce(d."comparisonType"::text, d."mrType"::text) AS subtype,
           d.status::text AS status, coalesce(d."projectName", '') AS project, cu.email AS uploader, coalesce(cu.location::text, '') AS uploader_location,
           h.action::text AS action, pu.email AS actor, h."performedAt", d."createdAt" AS created_at
    FROM "Document" d JOIN "User" cu ON cu.id = d."createdById"
    JOIN "ApprovalHistory" h ON h."documentId" = d.id JOIN "User" pu ON pu.id = h."performedById"
    ORDER BY d.id, h."performedAt", h.id`)).rows;

  const docs = new Map();
  for (const row of history) {
    if (!docs.has(row.id)) docs.set(row.id, { ...row, approvers: [], sawRevision: false });
    const doc = docs.get(row.id);
    if (row.action === "APPROVED" && !doc.approvers.includes(row.actor)) doc.approvers.push(row.actor);
    if (row.action === "REQUESTED_REVISION") doc.sawRevision = true;
  }

  const chains = new Map();
  for (const doc of docs.values()) {
    const key = [doc.type, doc.subtype ?? "", doc.uploader_location, doc.project, doc.status, doc.approvers.join(" > ") || "(no approvals)"].join("¦");
    const entry = chains.get(key) ?? { count: 0, uploaders: new Map(), first: null, last: null };
    entry.count += 1;
    entry.uploaders.set(doc.uploader, (entry.uploaders.get(doc.uploader) ?? 0) + 1);
    const created = new Date(doc.created_at).toISOString().slice(0, 10);
    if (!entry.first || created < entry.first) entry.first = created;
    if (!entry.last || created > entry.last) entry.last = created;
    chains.set(key, entry);
  }
  const rows = [...chains.entries()]
    .map(([key, entry]) => {
      const [type, subtype, location, project, status, chain] = key.split("¦");
      const uploaders = [...entry.uploaders.entries()].sort((a, b) => b[1] - a[1]).map(([email, n]) => `${email} (${n})`).join(", ");
      return { type, subtype, uploader_location: location || "(none)", project: project || "(none)", final_status: status, approvers_in_order: chain, documents: entry.count, uploaders, first_created: entry.first, last_created: entry.last };
    })
    .sort((a, b) => b.documents - a.documents);
  jsCheck({
    id: "D2",
    title: "Distinct approval chains documents actually followed",
    rows,
    total: rows.length,
    note: "One new approval flow per distinct chain of named users. Each row is a candidate flow: its approvers in order, with the uploader's location, type and subtype it applies to. This is the main input for the flow design.",
  });
}

async function errs() {
  section("E. ERR (equipment rental requests)");

  await sqlCheck({
    id: "E1",
    title: "ERRs by type, status, stage and chosen approval path",
    sql: `SELECT type::text AS type, status::text AS status, "currentStage"::text AS stage, coalesce("nextApprovalPath"::text, '(none)') AS next_path, count(*)::int AS errs
          FROM "Err" GROUP BY 1, 2, 3, 4 ORDER BY 1, 2, 3, 4`,
  });

  await sqlCheck({
    id: "E2",
    title: "ERR projects (country decides the location)",
    sql: `SELECT p.name, p.country::text AS country, p."isActive" AS active, coalesce(d.email, '(no director)') AS director,
                 (SELECT count(*) FROM "Err" e WHERE e."projectId" = p.id)::int AS errs,
                 (SELECT count(*) FROM "ErrUserAccess" a WHERE a."projectId" = p.id AND a."isActive")::int AS active_access_entries
          FROM "ErrProject" p LEFT JOIN "User" d ON d.id = p."directorId" ORDER BY p.country, p.name`,
    note: "You said all project-director projects are Kuwait projects. Any KSA row below contradicts that and should be confirmed.",
  });

  await sqlCheck({
    id: "E3",
    title: "ERR projects with country KSA",
    severity: "warn",
    finding: true,
    sql: `SELECT name, "isActive" AS active FROM "ErrProject" WHERE country = 'KSA'`,
  });

  await sqlCheck({
    id: "E4",
    title: "Projects without any active director or project manager",
    severity: "warn",
    finding: true,
    sql: `SELECT p.name, (SELECT count(*) FROM "Err" e WHERE e."projectId" = p.id)::int AS errs FROM "ErrProject" p
          WHERE NOT EXISTS (SELECT 1 FROM "ErrUserAccess" a WHERE a."projectId" = p.id AND a."isActive" AND a.role IN ('PROJECT_DIRECTOR','PROJECT_MANAGER')) AND p."directorId" IS NULL`,
    note: "The new flow's level 1 for such a project would have nobody.",
  });

  await sqlCheck({
    id: "E5",
    title: "ERRs without a project",
    severity: "warn",
    finding: true,
    sql: `SELECT "documentNumber", type::text AS type, status::text AS status, "projectNameSnapshot" FROM "Err" WHERE "projectId" IS NULL`,
    note: "They would have no location or project in the new system.",
  });

  await sqlCheck({
    id: "E6",
    title: "ERR files by kind",
    sql: `SELECT kind::text AS kind, count(*)::int AS files, count(DISTINCT "errId")::int AS errs, max("versionNumber") AS max_version FROM "ErrFile" GROUP BY 1 ORDER BY 1`,
  });

  await sqlCheck({
    id: "E7",
    title: "Quotations per ERR (a step can hold several reference documents)",
    sql: `SELECT quotations, count(*)::int AS errs FROM (SELECT e.id, count(f.id) FILTER (WHERE f.kind = 'QUOTATION')::int AS quotations FROM "Err" e LEFT JOIN "ErrFile" f ON f."errId" = e.id GROUP BY e.id) t GROUP BY 1 ORDER BY 1`,
  });

  await sqlCheck({
    id: "E8",
    title: "ERRs without an ERR_PDF file",
    severity: "block",
    finding: true,
    sql: `SELECT e."documentNumber", e.status::text AS status FROM "Err" e WHERE NOT EXISTS (SELECT 1 FROM "ErrFile" f WHERE f."errId" = e.id AND f.kind = 'ERR_PDF')`,
  });

  await sqlCheck({
    id: "E9",
    title: "ERR file kinds other than the PDF, quotations and the two vouchers (attachments)",
    severity: "warn",
    finding: true,
    sql: `SELECT "errId", kind::text AS kind, "originalName" FROM "ErrFile" WHERE kind = 'ATTACHMENT'`,
    note: "Attachments have no agreed target yet.",
  });

  await sqlCheck({
    id: "E10",
    title: "ERR vouchers per ERR",
    sql: `SELECT coalesce(sum(CASE WHEN kind = 'RELEASE_VOUCHER' THEN 1 ELSE 0 END), 0)::int AS release_vouchers, coalesce(sum(CASE WHEN kind = 'RECEIPT_VOUCHER' THEN 1 ELSE 0 END), 0)::int AS receipt_vouchers,
                 count(DISTINCT "errId") FILTER (WHERE kind IN ('RELEASE_VOUCHER','RECEIPT_VOUCHER'))::int AS errs_with_vouchers FROM "ErrFile"`,
  });

  // Chain each ERR actually followed.
  const rows = (await client.query(`
    SELECT e.id, e.type::text AS type, e.status::text AS status, coalesce(p.name, e."projectNameSnapshot", '') AS project, h.action::text AS action, h.stage::text AS stage, u.email AS actor
    FROM "Err" e LEFT JOIN "ErrProject" p ON p.id = e."projectId"
    JOIN "ErrApprovalHistory" h ON h."errId" = e.id JOIN "User" u ON u.id = h."performedById"
    ORDER BY e.id, h."performedAt", h.id`)).rows;
  const byErr = new Map();
  for (const row of rows) {
    if (!byErr.has(row.id)) byErr.set(row.id, { type: row.type, status: row.status, project: row.project, steps: [] });
    if (["APPROVED", "FINALIZED_APPROVAL", "ESCALATED_TO_ACTING_CEO", "ESCALATED_TO_CEO", "REJECTED"].includes(row.action)) {
      byErr.get(row.id).steps.push(`${row.stage ?? "?"}:${row.actor}`);
    }
  }
  const chains = new Map();
  for (const err of byErr.values()) {
    const key = [err.type, err.project, err.status, err.steps.join(" > ") || "(no decisions)"].join("¦");
    chains.set(key, (chains.get(key) ?? 0) + 1);
  }
  const chainRows = [...chains.entries()]
    .map(([key, count]) => {
      const [type, project, status, chain] = key.split("¦");
      return { type, project: project || "(none)", final_status: status, decisions_in_order: chain, errs: count };
    })
    .sort((a, b) => b.errs - a.errs);
  jsCheck({
    id: "E11",
    title: "Distinct approval chains ERRs actually followed (stage:person)",
    rows: chainRows,
    total: chainRows.length,
    note: "Purchase ERRs can escalate to the Acting CEO and CEO at the PMV Manager's choice. Each distinct chain becomes a flow; the most frequent per project becomes the default for new Purchase ERRs.",
  });

  await sqlCheck({
    id: "E12",
    title: "ERR notifications waiting to be e-mailed",
    sql: `SELECT type::text AS type, count(*) FILTER (WHERE "emailEnabled" AND "emailSentAt" IS NULL)::int AS pending_email, count(*)::int AS total FROM "ErrNotification" GROUP BY 1 ORDER BY 1`,
  });
}

async function purchaseOrders() {
  section("F. Purchase orders and invoices");

  await sqlCheck({
    id: "F1",
    title: "Purchase orders: totals",
    sql: `SELECT count(*)::int AS pos, count(*) FILTER (WHERE "receivedAt" IS NOT NULL)::int AS received,
                 count(*) FILTER (WHERE NOT EXISTS (SELECT 1 FROM "PurchaseOrderMrLink" l WHERE l."purchaseOrderId" = p.id))::int AS without_mr_link FROM "PurchaseOrder" p`,
    note: "The received confirmation moves to the document's receivedAt / receivedBy.",
  });

  await sqlCheck({
    id: "F2",
    title: "MRs linked per PO",
    sql: `SELECT links, count(*)::int AS pos FROM (SELECT p.id, count(l.id)::int AS links FROM "PurchaseOrder" p LEFT JOIN "PurchaseOrderMrLink" l ON l."purchaseOrderId" = p.id GROUP BY p.id) t GROUP BY 1 ORDER BY 1`,
    note: "A PO linked to several MRs becomes one process run per MR; the PO document is shared.",
  });

  await sqlCheck({
    id: "F3",
    title: "POs whose linked MRs belong to more than one location/project",
    severity: "warn",
    finding: true,
    sql: `SELECT p."poNumber", count(DISTINCT coalesce(d."projectName", d."uploaderLocation"::text, '?'))::int AS distinct_projects,
                 string_agg(DISTINCT coalesce(d."projectName", d."uploaderLocation"::text, '?'), ', ') AS projects
          FROM "PurchaseOrder" p JOIN "PurchaseOrderMrLink" l ON l."purchaseOrderId" = p.id JOIN "Document" d ON d.id = l."documentId"
          GROUP BY p.id HAVING count(DISTINCT coalesce(d."projectName", d."uploaderLocation"::text, '?')) > 1`,
    note: "Agreed rule: the PO takes the project of its first linked MR (earliest link). These are the POs where that rule matters.",
  });

  await sqlCheck({
    id: "F4",
    title: "MRs linked to a PO that are not approved (or not MRs)",
    severity: "warn",
    finding: true,
    sql: `SELECT p."poNumber", d."documentNumber", d."documentType"::text AS type, d.status::text AS status FROM "PurchaseOrderMrLink" l
          JOIN "PurchaseOrder" p ON p.id = l."purchaseOrderId" JOIN "Document" d ON d.id = l."documentId" WHERE d."documentType" <> 'MATERIAL_REQUISITION' OR d.status <> 'APPROVED'`,
  });

  await sqlCheck({
    id: "F5",
    title: "Invoices: attached to a PO or to a document",
    sql: `SELECT CASE WHEN "purchaseOrderId" IS NOT NULL THEN 'PO' ELSE 'document' END AS attached_to, count(*)::int AS invoices FROM "PurchaseOrderInvoice" GROUP BY 1 ORDER BY 1`,
    note: "The old database allows exactly one parent per invoice (check constraint), so each invoice has a single parent. Invoices on a PO sit under their PO in the process tree; invoices on a document sit under that document.",
  });

  await sqlCheck({
    id: "F6",
    title: "Custody files",
    sql: `SELECT u.email AS uploader, d.status::text AS status, count(*)::int AS files, min(d."documentNumber") AS first_number, max(d."documentNumber") AS last_number
          FROM "Document" d JOIN "User" u ON u.id = d."createdById" WHERE d."documentType" = 'CUSTODY' GROUP BY 1, 2 ORDER BY 1, 2`,
  });
}

async function numbering() {
  section("G. Number sequences");
  await sqlCheck({
    id: "G1",
    title: "Highest numbers in use vs the stored sequences",
    sql: `SELECT 'DOC' AS series, coalesce(max(substring("documentNumber" from '[0-9]+$')::int), 0) AS highest_in_use, (SELECT "lastNumber" FROM "DocumentNumberSequence" WHERE id = 1) AS sequence_value
          FROM "Document" WHERE "documentType" <> 'CUSTODY'
          UNION ALL SELECT 'CUSTODY', coalesce(max(substring("documentNumber" from '[0-9]+$')::int), 0), (SELECT "nextNumber" - 1 FROM "CustodyFileSequence" WHERE id = 1) FROM "Document" WHERE "documentType" = 'CUSTODY'
          UNION ALL SELECT 'ERR', coalesce(max(substring("documentNumber" from '[0-9]+$')::int), 0), (SELECT "nextNumber" - 1 FROM "ErrSequence" WHERE id = 1) FROM "Err"
          UNION ALL SELECT 'PO', coalesce(max(substring("poNumber" from '[0-9]+$')::int), 0), (SELECT "nextNumber" - 1 FROM "PurchaseOrderSequence" WHERE id = 1) FROM "PurchaseOrder"`,
    note: "Informational: the new counters are rebuilt from the data, not copied from these.",
  });
}

async function messages() {
  section("H. Notifications and e-mail events");

  await sqlCheck({
    id: "H1",
    title: "Pending e-mail events by type and the state of their document",
    sql: `SELECT e.type::text AS type, coalesce(d.status::text, CASE WHEN er.id IS NOT NULL THEN 'ERR ' || er.status::text WHEN po.id IS NOT NULL THEN 'PO' ELSE '(document not found)' END) AS document_state, count(*)::int AS pending
          FROM "EmailNotificationEvent" e LEFT JOIN "Document" d ON d.id = e."documentId" LEFT JOIN "Err" er ON er.id = e."documentId" LEFT JOIN "PurchaseOrder" po ON po.id = e."documentId"
          WHERE NOT e."emailSent" GROUP BY 1, 2 ORDER BY 1, 2`,
    note: "Agreed rule: keep a pending e-mail only if its document is still actionable. Types COMPARISON_MR_OVERDUE, PURCHASE_ORDER_AVAILABLE and ERR_WORKFLOW_UPDATE have no equivalent in the new system and are dropped.",
  });

  await sqlCheck({
    id: "H2",
    title: "Notifications by type and read state",
    sql: `SELECT type::text AS type, "isRead" AS is_read, count(*)::int AS notifications FROM "Notification" GROUP BY 1, 2 ORDER BY 1, 2`,
  });

  await sqlCheck({
    id: "H3",
    title: "Notifications whose document no longer exists",
    severity: "warn",
    finding: true,
    sql: `SELECT n.type::text AS type, count(*)::int AS notifications FROM "Notification" n WHERE n."documentId" IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM "Document" d WHERE d.id = n."documentId") AND NOT EXISTS (SELECT 1 FROM "Err" e WHERE e.id = n."documentId") AND NOT EXISTS (SELECT 1 FROM "PurchaseOrder" p WHERE p.id = n."documentId") GROUP BY 1`,
    note: "Notification.documentId has no foreign key, so these cannot be linked and are dropped.",
  });

  await sqlCheck({
    id: "H4",
    title: "Audit log entries by action",
    sql: `SELECT action, count(*)::int AS rows, count(*) FILTER (WHERE "documentId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "Document" d WHERE d.id = a."documentId") AND NOT EXISTS (SELECT 1 FROM "Err" e WHERE e.id = a."documentId") AND NOT EXISTS (SELECT 1 FROM "PurchaseOrder" p WHERE p.id = a."documentId"))::int AS document_gone
          FROM "AuditLog" a GROUP BY 1 ORDER BY 2 DESC`,
  });
}

// Files ---------------------------------------------------------------------------------------
function resolveStored(storedPath) {
  const normalized = String(storedPath).replaceAll("\\", "/");
  if (path.isAbsolute(normalized) || /^[A-Za-z]:\//.test(normalized)) return { kind: "absolute", full: normalized };
  if (normalized.startsWith("uploads/")) return { kind: "legacy", full: LEGACY_ROOT ? path.join(LEGACY_ROOT, ...normalized.split("/")) : null };
  return { kind: "relative", full: UPLOAD_ROOT ? path.join(UPLOAD_ROOT, ...normalized.split("/")) : null };
}

async function files() {
  section("I. Files");

  const refs = (await client.query(`
    SELECT 'DocumentVersion' AS source, v.id, v."filePath" AS path, v."fileSize" AS size, v."originalName" AS name FROM "DocumentVersion" v
    UNION ALL SELECT 'ErrFile', f.id, f."filePath", f."fileSize", f."originalName" FROM "ErrFile" f
    UNION ALL SELECT 'PurchaseOrder', p.id, p."filePath", p."fileSize", p."originalName" FROM "PurchaseOrder" p
    UNION ALL SELECT 'PurchaseOrderInvoice', i.id, i."filePath", i."fileSize", i."originalName" FROM "PurchaseOrderInvoice" i
    UNION ALL SELECT 'User(signature)', u.id, u."signaturePath", u."signatureFileSize", u."signatureOriginalName" FROM "User" u WHERE u."signaturePath" IS NOT NULL`)).rows;

  const kinds = new Map();
  for (const ref of refs) {
    const resolved = resolveStored(ref.path);
    const key = `${ref.source} / ${resolved.kind}`;
    kinds.set(key, (kinds.get(key) ?? 0) + 1);
  }
  jsCheck({
    id: "I1",
    title: "Stored file references by table and path style",
    rows: [...kinds.entries()].map(([kind, n]) => ({ kind, references: n })).sort((a, b) => a.kind.localeCompare(b.kind)),
    note: "'legacy' = stored as uploads/... (relative to the old app folder); 'absolute' = a full path; 'relative' = under UPLOAD_PATH.",
  });

  const byPath = new Map();
  for (const ref of refs) {
    const key = String(ref.path).replaceAll("\\", "/").toLowerCase();
    if (!byPath.has(key)) byPath.set(key, []);
    byPath.get(key).push(ref);
  }
  const shared = [...byPath.entries()].filter(([, list]) => list.length > 1).map(([key, list]) => ({ path: key, used_by: list.map((ref) => `${ref.source}:${ref.id}`).join(", ") }));
  jsCheck({
    id: "I2",
    title: "The same stored path used by more than one record",
    severity: "warn",
    finding: true,
    rows: shared,
    total: shared.length,
    note: "Copying by record would duplicate such a file; the migration must detect and reuse it.",
  });

  // Same file name in the same folder, differing only by case (a problem on case-insensitive stores such as OneDrive on Windows)
  if (!UPLOAD_ROOT) {
    jsCheck({
      id: "I3",
      title: "File existence, size and path length",
      severity: "warn",
      finding: true,
      rows: [{ skipped: "Pass --upload-root (and --legacy-root if any path starts with uploads/) to check the files on disk." }],
      total: 1,
    });
    return;
  }

  const missing = [];
  const wrongSize = [];
  const tooLong = [];
  let checked = 0;
  let unresolved = 0;
  let totalBytes = 0;
  for (const ref of refs) {
    const resolved = resolveStored(ref.path);
    if (!resolved.full) {
      unresolved += 1;
      continue;
    }
    checked += 1;
    if (resolved.full.length > WINDOWS_PATH_LIMIT) tooLong.push({ source: ref.source, id: ref.id, length: resolved.full.length, path: resolved.full });
    let stat;
    try {
      stat = fs.statSync(resolved.full);
    } catch {
      missing.push({ source: ref.source, id: ref.id, name: ref.name, stored_path: ref.path });
      continue;
    }
    totalBytes += stat.size;
    if (ref.size !== null && Number(ref.size) !== stat.size) wrongSize.push({ source: ref.source, id: ref.id, db_size: ref.size, disk_size: stat.size, stored_path: ref.path });
  }
  jsCheck({ id: "I3", title: "Referenced files that are missing on disk", severity: "block", finding: true, rows: missing, total: missing.length, note: `${checked} references checked, ${unresolved} could not be resolved (legacy 'uploads/' paths need --legacy-root). Total size found: ${(totalBytes / 1048576).toFixed(1)} MB.` });
  jsCheck({ id: "I4", title: "Files whose size on disk differs from the database", severity: "warn", finding: true, rows: wrongSize, total: wrongSize.length, note: "Differences happen when a signed copy replaced the file. The migration will trust the file on disk and record its real size." });
  jsCheck({ id: "I5", title: `Existing paths longer than ${WINDOWS_PATH_LIMIT} characters`, severity: "warn", finding: true, rows: tooLong, total: tooLong.length });

  // Files on disk that no record points to.
  const referenced = new Set(refs.map((ref) => resolveStored(ref.path).full).filter(Boolean).map((p) => path.resolve(p).toLowerCase()));
  const orphans = [];
  let diskFiles = 0;
  (function walk(dir) {
    if (!fs.existsSync(dir)) { console.warn(`Folder not found, skipped: ${dir}`); return; }
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else {
        diskFiles += 1;
        if (!referenced.has(path.resolve(full).toLowerCase())) orphans.push({ file: full });
      }
    }
  })(UPLOAD_ROOT);
  jsCheck({ id: "I6", title: "Files on disk that no record refers to", severity: "warn", finding: true, rows: orphans, total: orphans.length, note: `${diskFiles} files under ${UPLOAD_ROOT}. Unreferenced files are NOT migrated (only referenced files are copied); they stay in the old folder.` });
}

// ---------------------------------------------------------------------------------------------
async function main() {
  client = await openDb(OLD_URL);

  const steps = [inventory, users, documents, flows, errs, purchaseOrders, numbering, messages, files];
  for (const step of steps) {
    process.stdout.write(`${step.name}... `);
    await step();
    console.log("done");
  }
  await client.close();

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const dir = path.join(OUT_DIR, `audit-${stamp}`);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "audit-report.md"), renderMarkdown());
  fs.writeFileSync(path.join(dir, "audit-report.json"), JSON.stringify(report, null, 2));
  const blocks = report.summary.filter((entry) => entry.severity === "block").length;
  const warns = report.summary.filter((entry) => entry.severity === "warn").length;
  console.log(`\nReport written to ${dir}\nBlocking findings: ${blocks}   Needs a look: ${warns}`);
  if (blocks > 0) process.exitCode = 1;
}

main().catch(async (error) => {
  console.error(error);
  try {
    await client?.close();
  } catch {}
  process.exit(2);
});
