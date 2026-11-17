#!/usr/bin/env node
// scripts/migration/stage1-config.mjs
//
// STAGE 1 of the data migration: reference data only. No users, no documents, no files.
//   - Locations: Kuwait, KSA
//   - Projects: AVK, AVR, RMX (KSA) and "KWT" Kuwait catch-all, plus one project per old ERR project
//     (AVK-KHOBAR, AVR-RIYADH and READY MIX-KHOBAR are merged into AVK, AVR and RMX)
//   - Document type "Custody", and the required "MR Number" field on Material Req
//   - A mapping table (schema "migration") from old ERR projects to new projects, used by the later stages
//
// It runs as a DRY RUN by default: everything is executed inside a transaction that is rolled back, and a plan is written.
// Add --apply to really write. Safe to run again: existing rows are left alone.
//
//   node scripts/migration/stage1-config.mjs --old-url <old copy> --new-url <new database> [--apply] [--out ./migration-output]
//
// Prerequisite: the new database has the standard data from `npm run db:seed` (user types, permissions, roles, document types).

import fs from "node:fs";
import path from "node:path";
import { arg, flag, lit, openDb, stableId } from "./lib/db.mjs";

const OLD_URL = arg("old-url", "OLD_DATABASE_URL");
const NEW_URL = arg("new-url", "NEW_DATABASE_URL");
const OUT = arg("out") || "./migration-output";
const APPLY = flag("apply");
if (!OLD_URL || !NEW_URL) { console.error("Need --old-url and --new-url."); process.exit(2); }

// ---- Decisions confirmed by the owner -------------------------------------------------------------------------------
const LOCATIONS = ["Kuwait", "KSA"];
const FIXED_PROJECTS = [
  { code: "AVK", name: "Avenues Mall Khobar", location: "KSA" },
  { code: "AVR", name: "Avenues Towers Riyadh", location: "KSA" },
  { code: "RMX", name: "Ready Mix Khobar", location: "KSA" },
  { code: "KWT", name: "Kuwait (general)", location: "Kuwait" }, // documents of Kuwait users that never had a project
];
// Old ERR projects that are the same thing as a fixed project above.
const MERGE_INTO = { "AVK-KHOBAR": "AVK", "AVR-RIYADH": "AVR", "READY MIX-KHOBAR": "RMX" };
// Old ErrProject.country decides the location (the owner confirmed the six KSA ones).
const COUNTRY_TO_LOCATION = { KUWAIT: "Kuwait", KSA: "KSA" };

const CUSTODY_TYPE = { code: "CUSTODY", numberingCode: "CUS", name: "Custody" };

// Project code from the old name: upper case letters and digits separated by "-" (e.g. "KAZMA CAMP - 237" -> KAZMA-CAMP-237).
function codeFromName(name) {
  return name.toUpperCase().replace(/&/g, " AND ").replace(/[^A-Z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

const oldDb = await openDb(OLD_URL, { readOnly: true });
const newDb = await openDb(NEW_URL);

// ---- Checks on the new database -------------------------------------------------------------------------------------
const seeded = await newDb.select(`SELECT (SELECT count(*) FROM "UserType")::int AS user_types, (SELECT count(*) FROM "Permission")::int AS permissions,
  (SELECT count(*) FROM "Role")::int AS roles, (SELECT count(*) FROM "DocumentType" WHERE code IN ('MR','COMP','ERR','PO'))::int AS types`);
if (seeded[0].user_types < 4 || seeded[0].permissions < 10 || seeded[0].roles < 5 || seeded[0].types < 4) {
  console.error("The new database is missing the standard seed data. Run `npm run db:seed` on it first.", seeded[0]);
  process.exit(1);
}

// ---- Read the old ERR projects --------------------------------------------------------------------------------------
const oldProjects = await oldDb.select(`SELECT id, name, country::text AS country, "isActive" AS active FROM "ErrProject" ORDER BY name`);
await oldDb.close();

const plan = []; // {code, name, location, oldNames:[], oldIds:[]}
const byCode = new Map();
for (const fixed of FIXED_PROJECTS) {
  const entry = { ...fixed, active: true, oldNames: [], oldIds: [] };
  plan.push(entry);
  byCode.set(fixed.code, entry);
}
const problems = [];
for (const project of oldProjects) {
  const mergeTarget = MERGE_INTO[project.name.trim().toUpperCase()];
  if (mergeTarget) {
    const target = byCode.get(mergeTarget);
    target.oldNames.push(project.name);
    target.oldIds.push(project.id);
    continue;
  }
  const location = COUNTRY_TO_LOCATION[project.country];
  if (!location) { problems.push(`Project "${project.name}" has unknown country "${project.country}".`); continue; }
  const code = codeFromName(project.name);
  if (!code) { problems.push(`Project "${project.name}" gives an empty code.`); continue; }
  if (byCode.has(code)) { problems.push(`Project code clash: "${project.name}" and "${byCode.get(code).name}" both give ${code}.`); continue; }
  const entry = { code, name: project.name.trim(), location, active: project.active, oldNames: [project.name], oldIds: [project.id] };
  plan.push(entry);
  byCode.set(code, entry);
}
if (problems.length) { console.error("Problems:\n- " + problems.join("\n- ")); process.exit(1); }

// ---- Statements (all idempotent) -------------------------------------------------------------------------------------
const statements = [];
statements.push(`CREATE SCHEMA IF NOT EXISTS migration`);
statements.push(`CREATE TABLE IF NOT EXISTS migration.project_map (old_err_project_id text PRIMARY KEY, project_code text NOT NULL, old_name text NOT NULL)`);

for (const name of LOCATIONS) {
  statements.push(`INSERT INTO "Location" (id, name) VALUES (${lit(stableId("location", name))}, ${lit(name)}) ON CONFLICT (name) DO NOTHING`);
}
for (const project of plan) {
  statements.push(`INSERT INTO "Project" (id, code, name, "locationId", "isActive", "updatedAt")
    SELECT ${lit(stableId("project", project.code))}, ${lit(project.code)}, ${lit(project.name)}, l.id, ${lit(project.active)}, now() FROM "Location" l WHERE l.name = ${lit(project.location)}
    ON CONFLICT (code) DO NOTHING`);
  project.oldIds.forEach((oldId, index) => {
    statements.push(`INSERT INTO migration.project_map (old_err_project_id, project_code, old_name) VALUES (${lit(oldId)}, ${lit(project.code)}, ${lit(project.oldNames[index])}) ON CONFLICT (old_err_project_id) DO NOTHING`);
  });
}
statements.push(`INSERT INTO "DocumentType" (id, code, "numberingCode", name) VALUES (${lit(stableId("type", CUSTODY_TYPE.code))}, ${lit(CUSTODY_TYPE.code)}, ${lit(CUSTODY_TYPE.numberingCode)}, ${lit(CUSTODY_TYPE.name)}) ON CONFLICT (code) DO NOTHING`);
// MR number: required header field on Material Req (no sub type = applies to every sub type).
statements.push(`INSERT INTO "FieldDefinition" (id, "documentTypeId", "documentSubtypeId", "fieldGroup", "fieldKey", label, "dataType", "isRequired", "sortOrder")
  SELECT ${lit(stableId("field", "MR:mrNumber"))}, t.id, NULL, 'HEADER', 'mrNumber', 'MR Number', 'TEXT', TRUE, 0 FROM "DocumentType" t WHERE t.code = 'MR'
  AND NOT EXISTS (SELECT 1 FROM "FieldDefinition" f WHERE f."documentTypeId" = t.id AND f."documentSubtypeId" IS NULL AND f."fieldGroup" = 'HEADER' AND f."fieldKey" = 'mrNumber')`);

// ---- Run, then report -----------------------------------------------------------------------------------------------
const before = (await newDb.select(`SELECT (SELECT count(*) FROM "Location")::int AS locations, (SELECT count(*) FROM "Project")::int AS projects`))[0];
await newDb.runAll(statements, APPLY);
const after = APPLY ? (await newDb.select(`SELECT (SELECT count(*) FROM "Location")::int AS locations, (SELECT count(*) FROM "Project")::int AS projects`))[0] : null;
await newDb.close();

const lines = [
  `# Stage 1 plan (${APPLY ? "APPLIED" : "DRY RUN - nothing was written"})`, "",
  `Locations: ${LOCATIONS.join(", ")}`, "",
  "| Project code | Name | Location | Old ERR projects merged/mapped |", "| --- | --- | --- | --- |",
  ...plan.map((p) => `| ${p.code} | ${p.name} | ${p.location} | ${p.oldNames.join(", ") || "-"} |`), "",
  `Document type added: ${CUSTODY_TYPE.name} (${CUSTODY_TYPE.code}, numbering ${CUSTODY_TYPE.numberingCode}). Field "MR Number" (required) on Material Req.`, "",
  `Before: ${before.locations} locations, ${before.projects} projects in the new database.`,
  after ? `After: ${after.locations} locations, ${after.projects} projects.` : "Run again with --apply to write this.",
];
fs.mkdirSync(OUT, { recursive: true });
const file = path.join(OUT, "stage1-plan.md");
fs.writeFileSync(file, lines.join("\n"));
console.log(lines.join("\n"));
console.log(`\nPlan written to ${file}`);
