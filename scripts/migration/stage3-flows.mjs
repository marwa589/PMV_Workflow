#!/usr/bin/env node
// scripts/migration/stage3-flows.mjs
//
// STAGE 3: approval flows (named users) and the flow assignments that decide which flow a new document gets.
// Needs Stages 1 and 2 applied. Works on the NEW database only. Dry run by default; --apply writes.
//
//   node scripts/migration/stage3-flows.mjs --new-url <new database> [--apply] [--out ./migration-output]
//
// Flows are built from what the old system really did (audit report D2/E11) and the owner's decisions:
//  - Level 0 ("uploader") names the people who may upload for that project. This matters: without it, any Clerk who holds
//    ANY assignment covering the project (even view-only) could upload.
//  - "Signature required" is switched off on the levels of the people who approved without a signature in the old system.
//  - One inactive "legacy" flow carries the old Kuwait era (3 to 12 Sep 2026: Aqueel approved alone). It is assigned to nothing.
// Existing flows/assignments are never changed (create-only), so the stage is safe to repeat.

import fs from "node:fs";
import path from "node:path";
import { arg, flag, lit, openDb, stableId } from "./lib/db.mjs";

const NEW_URL = arg("new-url", "NEW_DATABASE_URL");
const OUT = arg("out") || "./migration-output";
const APPLY = flag("apply");
if (!NEW_URL) { console.error("Need --new-url."); process.exit(2); }

const GEORGE = "george.azzi@ahmadiah.com", MARC = "marc.baddour@ahmadiah.com", MOHAMMAD = "mohammad.mehieddine@ahmadiah.com";
const ELIE = "elie.azzam@ahmadiah.com", RAMZI = "ramzi@ahmadiah.com", JOEMAR = "joemar.paraiso@ahmadiah.com", AQUEEL = "aqueel.sayed@ahmadiah.com";

// levels: [{email, signature}] in order (level 1, 2, ...). uploadersFor: {project, types} to derive level 0; null = no level 0.
const FLOWS = [
  { code: "KWT-MR-COMP", name: "Kuwait: MR and Comparison (George, Marc)", active: true, levels: [{ email: GEORGE }, { email: MARC }], uploadersFor: { project: "KWT", types: ["MR", "COMP"] } },
  { code: "KWT-LEGACY-2026-09", name: "Kuwait legacy 3-12 Sep 2026 (Aqueel alone) - old documents only", active: false, levels: [{ email: AQUEEL }], uploadersFor: null },
  { code: "AVR-MR", name: "AVR: Material Req (Mohammad, George, Marc)", active: true, levels: [{ email: MOHAMMAD, signature: false }, { email: GEORGE, signature: false }, { email: MARC }], uploadersFor: { project: "AVR", types: ["MR"] } },
  { code: "AVR-COMP", name: "AVR: Comparison (Mohammad, George, Marc)", active: true, levels: [{ email: MOHAMMAD, signature: false }, { email: GEORGE }, { email: MARC }], uploadersFor: { project: "AVR", types: ["COMP"] } },
  { code: "AVR-CUSTODY", name: "AVR: Custody (Mohammad, Marc)", active: true, levels: [{ email: MOHAMMAD, signature: false }, { email: MARC }], uploadersFor: { project: "AVR", types: ["CUSTODY"] } },
  { code: "AVK-MR", name: "AVK: Material Req (Ramzi, Marc)", active: true, levels: [{ email: RAMZI }, { email: MARC }], uploadersFor: { project: "AVK", types: ["MR"] } },
  { code: "AVK-COMP", name: "AVK: Comparison (Joemar, George, Marc)", active: true, levels: [{ email: JOEMAR, signature: false }, { email: GEORGE }, { email: MARC }], uploadersFor: { project: "AVK", types: ["COMP"] } },
  { code: "RMX-MR", name: "Ready Mix: Material Req (Elie, Marc)", active: true, levels: [{ email: ELIE }, { email: MARC }], uploadersFor: { project: "RMX", types: ["MR"] } },
  { code: "RMX-COMP", name: "Ready Mix: Comparison (Elie, Marc)", active: true, levels: [{ email: ELIE }, { email: MARC }], uploadersFor: { project: "RMX", types: ["COMP"] } },
  // ERR: level 1 = any Engineer holding an Approver assignment for that project and ERR (project directors / managers), level 2 = Marc.
  { code: "ERR-PD-MARC", name: "ERR: project director, then Marc", active: true, levels: [{ userType: "eng" }, { email: MARC }], uploadersFor: null },
  { code: "ERR-MARC-ONLY", name: "ERR without project director: Marc only", active: true, levels: [{ email: MARC }], uploadersFor: null },
];
// flow code -> list of [documentType, projectCode]. ERR-PD-MARC is filled from the project map below.
const ASSIGN = {
  "KWT-MR-COMP": [["MR", "KWT"], ["COMP", "KWT"]],
  "AVR-MR": [["MR", "AVR"]], "AVR-COMP": [["COMP", "AVR"]], "AVR-CUSTODY": [["CUSTODY", "AVR"]],
  "AVK-MR": [["MR", "AVK"]], "AVK-COMP": [["COMP", "AVK"]],
  "RMX-MR": [["MR", "RMX"]], "RMX-COMP": [["COMP", "RMX"]],
  "ERR-MARC-ONLY": [["ERR", "KWT"]],
};

const db = await openDb(NEW_URL);
const problems = [];

const mapRows = await db.select(`SELECT DISTINCT project_code FROM migration.project_map`).catch(() => null);
if (!mapRows) { console.error("Stage 1 has not been applied."); process.exit(1); }
ASSIGN["ERR-PD-MARC"] = mapRows.map((r) => ["ERR", r.project_code]).filter(([, code]) => code !== "KWT");

const emails = [...new Set(FLOWS.flatMap((f) => f.levels.flatMap((l) => (l.email ? [l.email] : []))))];
const users = new Map((await db.select(`SELECT id, email FROM "User" WHERE email IN (${emails.map(lit).join(",")})`)).map((u) => [u.email, u.id]));
for (const email of emails) if (!users.has(email)) problems.push(`User ${email} is not in the new database (apply Stage 2 first).`);
const userTypes = new Map((await db.select(`SELECT id, code FROM "UserType"`)).map((t) => [t.code, t.id]));
const projects = new Set((await db.select(`SELECT code FROM "Project"`)).map((p) => p.code));
const types = new Set((await db.select(`SELECT code FROM "DocumentType"`)).map((t) => t.code));
for (const [flowCode, list] of Object.entries(ASSIGN)) for (const [t, p] of list) {
  if (!types.has(t)) problems.push(`${flowCode}: document type ${t} missing`);
  if (!projects.has(p)) problems.push(`${flowCode}: project ${p} missing`);
}

// Level 0: users with an Uploader assignment that covers the flow's project and every one of its types.
async function uploadersFor(spec) {
  if (!spec) return [];
  const rows = await db.select(`SELECT DISTINCT u.id, u.email FROM "UserAssignment" a JOIN "Role" r ON r.id = a."roleId" JOIN "User" u ON u.id = a."userId"
    WHERE r.name = 'Uploader'
      AND EXISTS (SELECT 1 FROM "UserAssignmentProjectScope" ps JOIN "Project" p ON p.id = ps."projectId" WHERE ps."userAssignmentId" = a.id AND p.code = ${lit(spec.project)})
      AND ${spec.types.map((t) => `EXISTS (SELECT 1 FROM "UserAssignmentDocumentTypeScope" ts JOIN "DocumentType" t ON t.id = ts."documentTypeId" WHERE ts."userAssignmentId" = a.id AND t.code = ${lit(t)})`).join(" AND ")}
    ORDER BY u.email`);
  return rows;
}
const level0 = new Map();
for (const flow of FLOWS) {
  const list = await uploadersFor(flow.uploadersFor);
  level0.set(flow.code, list);
  if (flow.uploadersFor && list.length === 0) problems.push(`${flow.code}: no uploaders found for project ${flow.uploadersFor.project} (Stage 2 gave nobody the Uploader role there).`);
}
if (problems.length) { console.error("Problems (nothing written):\n- " + [...new Set(problems)].join("\n- ")); process.exit(1); }

const statements = [];
for (const flow of FLOWS) {
  const templateId = stableId("template", flow.code);
  statements.push(`INSERT INTO "DocumentWorkflowTemplate" (id, code, name, description, "isActive", "updatedAt") VALUES (${lit(templateId)}, ${lit(flow.code)}, ${lit(flow.name)}, 'Created by the data migration', ${lit(flow.active)}, now()) ON CONFLICT (code) DO NOTHING`);
  const steps = [
    ...(level0.get(flow.code).length ? [{ n: 0, name: "Uploader", signature: true, approvers: level0.get(flow.code).map((u) => ({ userId: u.id })) }] : []),
    ...flow.levels.map((l, i) => ({
      n: i + 1, name: `Level ${i + 1}`, signature: l.signature !== false,
      approvers: [l.email ? { userId: users.get(l.email) } : { userTypeId: userTypes.get(l.userType) }],
    })),
  ];
  for (const step of steps) {
    const stepId = stableId("step", `${flow.code}:${step.n}`);
    statements.push(`INSERT INTO "DocumentWorkflowStep" (id, "templateId", "stepNumber", name, "signatureRequired") SELECT ${lit(stepId)}, t.id, ${step.n}, ${lit(step.name)}, ${lit(step.signature)} FROM "DocumentWorkflowTemplate" t WHERE t.code = ${lit(flow.code)} ON CONFLICT ("templateId", "stepNumber") DO NOTHING`);
    for (const approver of step.approvers) {
      const key = approver.userId ?? approver.userTypeId;
      const id = stableId("approver", `${flow.code}:${step.n}:${key}`);
      statements.push(`INSERT INTO "DocumentWorkflowStepApprover" (id, "stepId", "approverType", "userTypeId", "userId") SELECT ${lit(id)}, s.id, ${approver.userId ? "'USER'" : "'USER_TYPE'"}, ${lit(approver.userTypeId ?? null)}, ${lit(approver.userId ?? null)}
        FROM "DocumentWorkflowStep" s JOIN "DocumentWorkflowTemplate" t ON t.id = s."templateId" WHERE t.code = ${lit(flow.code)} AND s."stepNumber" = ${step.n}
        AND NOT EXISTS (SELECT 1 FROM "DocumentWorkflowStepApprover" x WHERE x.id = ${lit(id)})`);
    }
  }
}
for (const [flowCode, list] of Object.entries(ASSIGN)) {
  for (const [typeCode, projectCode] of list) {
    const id = stableId("flow-assignment", `${typeCode}:${projectCode}`);
    statements.push(`INSERT INTO "DocumentWorkflowAssignment" (id, "documentTypeId", "documentSubtypeId", "projectId", "templateId")
      SELECT ${lit(id)}, dt.id, NULL, p.id, t.id FROM "DocumentType" dt, "Project" p, "DocumentWorkflowTemplate" t
      WHERE dt.code = ${lit(typeCode)} AND p.code = ${lit(projectCode)} AND t.code = ${lit(flowCode)}
      AND NOT EXISTS (SELECT 1 FROM "DocumentWorkflowAssignment" x WHERE x."documentTypeId" = dt.id AND x."documentSubtypeId" IS NULL AND x."projectId" = p.id)`);
  }
}

const count = async () => (await db.select(`SELECT (SELECT count(*) FROM "DocumentWorkflowTemplate")::int AS templates, (SELECT count(*) FROM "DocumentWorkflowAssignment")::int AS assignments`))[0];
const before = await count();
await db.runAll(statements, APPLY);
const after = APPLY ? await count() : null;
await db.close();

const lines = [
  `# Stage 3 plan (${APPLY ? "APPLIED" : "DRY RUN - nothing was written"})`, "",
  `Before: ${before.templates} flows, ${before.assignments} flow assignments.${after ? ` After: ${after.templates} flows, ${after.assignments} assignments.` : ""}`, "",
  "## Flows", "",
  "| Code | Active | Level 0 (who may upload) | Levels (signature required?) |", "| --- | --- | --- | --- |",
  ...FLOWS.map((f) => `| ${f.code} | ${f.active ? "yes" : "no (legacy)"} | ${level0.get(f.code).map((u) => u.email).join(", ") || "(nobody named)"} | ${f.levels.map((l, i) => `${i + 1}: ${l.email ?? "any Engineer with an Approver assignment for the project"}${l.signature === false ? " (no signature)" : ""}`).join("<br>")} |`), "",
  "## Which flow a new document gets", "",
  "| Flow | Document type + project |", "| --- | --- |",
  ...Object.entries(ASSIGN).map(([code, list]) => `| ${code} | ${list.map(([t, p]) => `${t} / ${p}`).join(", ") || "-"} |`), "",
  "## Not covered", "",
  "- Ready Mix (RMX): no old documents exist; the chain (Elie, then Marc directly) comes from the owner.",
  "- Purchase ERRs: all go PD then Marc. The old per-document choice to escalate to the Acting CEO / CEO is replaced by an admin assigning another flow.",
];
fs.mkdirSync(OUT, { recursive: true });
const file = path.join(OUT, "stage3-plan.md");
fs.writeFileSync(file, lines.join("\n"));
console.log(lines.join("\n"));
console.log(`\nPlan written to ${file}`);
