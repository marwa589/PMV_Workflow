#!/usr/bin/env node
// scripts/migration/stage2-users.mjs
//
// STAGE 2 of the data migration: users, their passwords and signatures, user types, and their roles/assignments.
// Needs Stage 1 to have been applied. Dry run by default (rolled back); --apply writes.
//
//   node scripts/migration/stage2-users.mjs --old-url <old copy> --new-url <new database> [--apply]
//        [--upload-root "<old uploads folder>"]   checks that each signature file exists (missing ones are migrated without a signature)
//        [--user-types overrides.json]            {"person@ahmadiah.com": "eng"} to change a user type from the proposal
//        [--out ./migration-output]
//
// What is NOT done here (later stages): approval flows (they name these users), purchase-order / invoice access, documents.
// Kept: user ids (so later stages match 1:1), name, e-mail, bcrypt password hash, signature columns, "bulk approve" switch.
// Dropped: @example.com / @role-migration.local accounts, OTP challenges, trusted devices, password-reset tokens.

import fs from "node:fs";
import path from "node:path";
import { arg, flag, lit, openDb, stableId } from "./lib/db.mjs";

const OLD_URL = arg("old-url", "OLD_DATABASE_URL");
const NEW_URL = arg("new-url", "NEW_DATABASE_URL");
const UPLOAD_ROOT = arg("upload-root", "OLD_UPLOAD_ROOT");
const OVERRIDES_FILE = arg("user-types");
const OUT = arg("out") || "./migration-output";
const APPLY = flag("apply");
if (!OLD_URL || !NEW_URL) { console.error("Need --old-url and --new-url."); process.exit(2); }

// ---- Rules taken from the old code (src/lib/*-access.ts etc.) -----------------------------------------------------
const TEMP_EMAIL = /@example\.com$|@role-migration\.local$/i;
const DOC_TYPES = ["MR", "COMP", "CUSTODY"]; // the old "documents" module
const LOCATION_PROJECT = { KUWAIT: "KWT", AVK: "AVK", AVR: "AVR" };
// Old rule: these clerks see only their own documents (everyone else with the CLERK role sees every document).
const RESTRICTED_CLERKS = ["dispatcher.pmv@ahmadiah.com", "joemar.paraiso@ahmadiah.com", "bernabie.rocha@ahmadiah.com", "mohamed.mahran@ahmadiah-sa.com"];
// Old avk-access.ts: may see MR/Comparison documents of the AVK uploaders.
const AVK_MR_VIEWERS = ["mohamed.mahran@ahmadiah-sa.com", "omar.merzek@ahmadiah.com", "marc.baddour@ahmadiah.com", "ramzi@ahmadiah.com", "dispatcher.pmv@ahmadiah.com"];
// Old ready-mix-mr-access.ts (the old ADMIN and APPROVER_3 also saw them).
const READY_MIX_VIEWERS = ["dispatcher.pmv@ahmadiah.com", "elie.azzam@ahmadiah.com", "omar.merzek@ahmadiah.com"];
const EXTRA_UPLOAD_PROJECTS = { "dispatcher.pmv@ahmadiah.com": ["RMX"] }; // confirmed: AVR and RMX
const BULK_APPROVE = ["marc.baddour@ahmadiah.com"]; // old review-all-access.ts
const APPROVER_ERR_ROLES = ["PROJECT_DIRECTOR", "PROJECT_MANAGER", "CEO", "ACTING_CEO"];

const clean = (email) => String(email).trim().toLowerCase();

function proposeUserType(user, errRoles) {
  switch (user.role) {
    case "ADMIN": return "admin";
    case "APPROVER_1": return "eng";
    case "APPROVER_2":
    case "APPROVER_3": return "manager";
    case "KSA_VIEWER": return "clerk"; // confirmed by the owner
    case "ERR_USER": return errRoles.some((r) => APPROVER_ERR_ROLES.includes(r)) ? "eng" : "clerk";
    default: return "clerk";
  }
}

/** Roles/scopes a user gets. Each item: {role, projects:[code]|null (all), types:[code]|null (all), location:string|null, why}. */
const warnings = [];
function buildAssignments(user, email, errAccess, mapProject) {
  const out = [];
  const add = (role, projects, types, location, why) => out.push({ role, projects, types, location, why });

  if (user.role === "CLERK") {
    const home = LOCATION_PROJECT[user.location];
    const projects = [...(home ? [home] : []), ...(EXTRA_UPLOAD_PROJECTS[email] ?? [])];
    const types = user.location === "AVR" ? ["MR", "COMP", "CUSTODY"] : ["MR", "COMP"];
    if (projects.length === 0) warnings.push(`${email}: CLERK without a known location, so no upload project was assigned. Assign one by hand.`);
    else {
      add("Uploader", projects, types, null, "old CLERK upload rule (project of the old location)");
      add("Deletion Requester", projects, types, null, "old rule: clerks may request deletion");
    }
    if (!RESTRICTED_CLERKS.includes(email)) add("Viewer", null, DOC_TYPES, null, "old rule: a non-restricted clerk sees every document");
  }
  if (AVK_MR_VIEWERS.includes(email) || user.location === "AVK" || user.role === "APPROVER_2" || user.role === "APPROVER_3") {
    add("Viewer", ["AVK"], ["MR", "COMP"], null, "old avk-access.ts: may see AVK MR/Comparison documents");
  }
  if (READY_MIX_VIEWERS.includes(email) || user.role === "APPROVER_3") {
    add("Viewer", ["RMX"], ["MR", "COMP"], null, "old ready-mix-mr-access.ts");
  }
  if (user.role === "KSA_VIEWER") add("Viewer", null, null, "KSA", "old KSA_VIEWER: view only, location KSA");

  // ERR access entries (old ErrUserAccess)
  const byRole = new Map();
  for (const entry of errAccess) {
    const code = entry.projectId ? mapProject.get(entry.projectId) : null; // null = all projects
    if (entry.projectId && !code) throw new Error(`ERR access for ${email}: project ${entry.projectId} is not in migration.project_map (run Stage 1).`);
    if (!byRole.has(entry.role)) byRole.set(entry.role, { all: false, codes: new Set() });
    const slot = byRole.get(entry.role);
    if (code) slot.codes.add(code); else slot.all = true;
  }
  for (const [errRole, slot] of byRole) {
    const projects = slot.all ? null : [...slot.codes].sort();
    if (errRole === "UPLOADER") {
      add("Uploader", projects, ["ERR"], null, "old ERR uploader");
      add("Viewer", projects, ["ERR"], null, "old ERR uploader (view + upload)");
    } else if (errRole === "VIEWER") {
      add("Viewer", projects, ["ERR"], null, "old ERR viewer");
    } else {
      // Directors / managers: eligible for the project-scoped approval level (level 1 of the ERR flow), and they see those ERRs.
      // CEO / Acting CEO only see ERRs here: they are NOT given the Approver role, because an unscoped Approver
      // assignment would make them eligible at level 1 of every ERR. Their escalation is a flow decision (Stage 3).
      if (errRole === "PROJECT_DIRECTOR" || errRole === "PROJECT_MANAGER") {
        add("Approver", projects, ["ERR"], null, `old ERR ${errRole}: eligible for the project-scoped approval level`);
      }
      add("Viewer", projects, ["ERR"], null, `old ERR ${errRole}`);
    }
  }
  return out;
}

const oldDb = await openDb(OLD_URL, { readOnly: true });
const newDb = await openDb(NEW_URL);

const users = await oldDb.select(`SELECT id, name, email, "passwordHash", role::text AS role, location::text AS location, "createdAt", "sessionVersion",
  "signatureFileSize", "signatureMimeType", "signatureOriginalName", "signaturePath", "signatureUpdatedAt" FROM "User" ORDER BY email`);
const access = await oldDb.select(`SELECT "userId", role::text AS role, "projectId" FROM "ErrUserAccess" WHERE "isActive"`);
await oldDb.close();

const mapRows = await newDb.select(`SELECT old_err_project_id, project_code FROM migration.project_map`).catch(() => null);
if (!mapRows) { console.error("Stage 1 has not been applied to the new database (migration.project_map is missing)."); process.exit(1); }
const mapProject = new Map(mapRows.map((row) => [row.old_err_project_id, row.project_code]));
const existingProjects = new Set((await newDb.select(`SELECT code FROM "Project"`)).map((row) => row.code));
const existingTypes = new Set((await newDb.select(`SELECT code FROM "DocumentType"`)).map((row) => row.code));
const roleIds = new Map((await newDb.select(`SELECT id, name FROM "Role"`)).map((row) => [row.name, row.id]));
const typeIds = new Map((await newDb.select(`SELECT id, code FROM "UserType"`)).map((row) => [row.code, row.id]));
const existingUsers = await newDb.select(`SELECT id, email FROM "User"`);

const overrides = OVERRIDES_FILE ? JSON.parse(fs.readFileSync(OVERRIDES_FILE, "utf8")) : {};
const problems = [];
const kept = [];
const dropped = [];
const missingSignatures = [];

for (const user of users) {
  const email = clean(user.email);
  if (TEMP_EMAIL.test(email)) { dropped.push(email); continue; }
  const errAccess = access.filter((row) => row.userId === user.id);
  const userType = overrides[email] ?? proposeUserType(user, errAccess.map((row) => row.role));
  if (!typeIds.has(userType)) problems.push(`${email}: unknown user type "${userType}"`);
  let signature = { path: user.signaturePath, size: user.signatureFileSize, mime: user.signatureMimeType, original: user.signatureOriginalName, updatedAt: user.signatureUpdatedAt };
  if (user.signaturePath && UPLOAD_ROOT) {
    const full = path.join(UPLOAD_ROOT, user.signaturePath);
    if (!fs.existsSync(full)) {
      missingSignatures.push(`${email} (${user.signaturePath})`);
      signature = { path: null, size: null, mime: null, original: null, updatedAt: null };
    }
  }
  let assignments = [];
  try { assignments = buildAssignments(user, email, errAccess, mapProject); } catch (error) { problems.push(error.message); }
  for (const a of assignments) {
    if (!roleIds.has(a.role) && a.role !== "Deletion Requester") problems.push(`${email}: role "${a.role}" does not exist in the new database (run npm run db:seed)`);
    for (const code of a.projects ?? []) if (!existingProjects.has(code)) problems.push(`${email}: project ${code} does not exist (run Stage 1)`);
    for (const code of a.types ?? []) if (!existingTypes.has(code)) problems.push(`${email}: document type ${code} does not exist (run Stage 1 / seed)`);
  }
  // Remove exact duplicates.
  const seen = new Set();
  assignments = assignments.filter((a) => { const key = JSON.stringify([a.role, a.projects, a.types, a.location]); if (seen.has(key)) return false; seen.add(key); return true; });
  kept.push({ user, email, userType, signature, assignments });
}

const emailCount = new Map();
for (const k of kept) emailCount.set(k.email, (emailCount.get(k.email) ?? 0) + 1);
for (const [email, n] of emailCount) if (n > 1) problems.push(`${email}: ${n} old accounts differ only by upper/lower case. Decide which one to keep.`);
for (const existing of existingUsers) {
  const match = kept.find((k) => k.email === clean(existing.email));
  if (match && match.user.id !== existing.id) problems.push(`The new database already has ${existing.email} with a different id. Use an empty new database (only the seed admin may exist, and it must not be one of the old users).`);
}
if (problems.length) { console.error("Problems (nothing written):\n- " + [...new Set(problems)].join("\n- ")); process.exit(1); }

// ---- Statements ------------------------------------------------------------------------------------------------------
const statements = [];
// New role: may request deletion (the seeded "Deletion Reviewer" also reviews, which clerks must not do).
statements.push(`INSERT INTO "Role" (id, name, description) VALUES (${lit(stableId("role", "Deletion Requester"))}, 'Deletion Requester', 'May ask for deletion of documents in scope (cannot review).') ON CONFLICT (name) DO NOTHING`);
statements.push(`INSERT INTO "RolePermission" ("roleId", "permissionId") SELECT r.id, p.id FROM "Role" r, "Permission" p WHERE r.name = 'Deletion Requester' AND p.code IN ('documents.delete_request', 'documents.view') ON CONFLICT DO NOTHING`);

for (const { user, email, userType, signature } of kept) {
  statements.push(`INSERT INTO "User" (id, name, email, "passwordHash", "userTypeId", "isActive", "createdAt", "updatedAt", "sessionVersion", "signatureFileSize", "signatureMimeType", "signatureOriginalName", "signaturePath", "signatureUpdatedAt", "canBulkApprove")
    SELECT ${lit(user.id)}, ${lit(user.name)}, ${lit(email)}, ${lit(user.passwordHash)}, t.id, TRUE, ${lit(user.createdAt)}, now(), ${lit(user.sessionVersion ?? 0)}, ${lit(signature.size)}, ${lit(signature.mime)}, ${lit(signature.original)}, ${lit(signature.path)}, ${lit(signature.updatedAt)}, ${lit(BULK_APPROVE.includes(email))}
    FROM "UserType" t WHERE t.code = ${lit(userType)} ON CONFLICT (id) DO NOTHING`);
}
for (const { user, email, assignments } of kept) {
  for (const a of assignments) {
    const id = stableId("assignment", [email, a.role, (a.projects ?? ["*"]).join(","), (a.types ?? ["*"]).join(","), a.location ?? "*"].join("|"));
    statements.push(`INSERT INTO "UserAssignment" (id, "userId", "roleId", "locationId") SELECT ${lit(id)}, ${lit(user.id)}, r.id, ${a.location ? "(SELECT l.id FROM \"Location\" l WHERE l.name = " + lit(a.location) + ")" : "NULL"}
      FROM "Role" r WHERE r.name = ${lit(a.role)} AND NOT EXISTS (SELECT 1 FROM "UserAssignment" x WHERE x.id = ${lit(id)})`);
    for (const code of a.projects ?? []) {
      statements.push(`INSERT INTO "UserAssignmentProjectScope" ("userAssignmentId", "projectId") SELECT ${lit(id)}, p.id FROM "Project" p WHERE p.code = ${lit(code)} ON CONFLICT DO NOTHING`);
    }
    for (const code of a.types ?? []) {
      statements.push(`INSERT INTO "UserAssignmentDocumentTypeScope" ("userAssignmentId", "documentTypeId", "allSubtypes") SELECT ${lit(id)}, t.id, TRUE FROM "DocumentType" t WHERE t.code = ${lit(code)} ON CONFLICT DO NOTHING`);
    }
  }
}

const count = async () => (await newDb.select(`SELECT (SELECT count(*) FROM "User")::int AS users, (SELECT count(*) FROM "UserAssignment")::int AS assignments`))[0];
const before = await count();
await newDb.runAll(statements, APPLY);
const after = APPLY ? await count() : null;
await newDb.close();

// ---- Plan ---------------------------------------------------------------------------------------------------------------
const scopeText = (a) => `${a.role}${a.projects ? ` [projects: ${a.projects.join(", ")}]` : " [all projects]"}${a.types ? ` [types: ${a.types.join(", ")}]` : ""}${a.location ? ` [location: ${a.location}]` : ""}`;
const lines = [
  `# Stage 2 plan (${APPLY ? "APPLIED" : "DRY RUN - nothing was written"})`, "",
  `Users to migrate: ${kept.length}. Dropped (temporary accounts): ${dropped.length ? dropped.join(", ") : "none"}.`,
  `New database before: ${before.users} users, ${before.assignments} assignments.${after ? ` After: ${after.users} users, ${after.assignments} assignments.` : ""}`, "",
  "## Users: proposed user type and access", "",
  "| E-mail | Name | Old role | Old location | New user type | New roles and scope |", "| --- | --- | --- | --- | --- | --- |",
  ...kept.map((k) => `| ${k.email} | ${k.user.name} | ${k.user.role} | ${k.user.location ?? "-"} | ${k.userType} | ${k.assignments.map(scopeText).join("<br>") || "-"} |`), "",
  "## Warnings", "", warnings.length ? warnings.map((w) => `- ${w}`).join("\n") : "None.", "",
  "## Signatures", "",
  UPLOAD_ROOT ? (missingSignatures.length ? `Signature file missing, migrated WITHOUT a signature (re-upload later):\n${missingSignatures.map((s) => `- ${s}`).join("\n")}` : "All signature files exist.") : "Not checked (no --upload-root given).", "",
  "## Not part of this stage", "",
  "- Approval flows (Stage 3), purchase-order and invoice access (with the PO stage), documents and files.",
  "- Old per-user 'preferred signature width' has no place in the new system.",
];
fs.mkdirSync(OUT, { recursive: true });
const file = path.join(OUT, "stage2-plan.md");
fs.writeFileSync(file, lines.join("\n"));
console.log(lines.join("\n"));
console.log(`\nPlan written to ${file}`);
