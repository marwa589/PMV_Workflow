#!/usr/bin/env node
// scripts/migration/stage6-processes.mjs
//
// STAGE 6: process trees and runs for the documents already migrated (Stages 4 and 5).
//   1. Creates the three process trees (if missing):
//        "Comparison to Invoice": Comparison -> Material Req (Cash: ends here | Credit -> Purchase Order -> Invoice)
//        "Credit MR to Invoice": Material Req Credit -> Purchase Order -> Invoice     (a Credit MR uploaded without a comparison)
//        "Cash MR": Material Req Cash alone                                            (Cash MRs never need a PO: owner rule)
//        "ERR to Receipt": Eq Rental Req (quotation as reference document) -> Receiving Voucher (Release) -> Receiving Voucher (Receipt)
//   2. One run per MR (and per PO linked to it) for the chains that really exist in the old data:
//        MR with an approved related comparison -> "Comparison to Invoice" run; otherwise "Credit MR to Invoice" or "Cash MR".
//      Owner decision (option A): a run ends where the old data ends and is marked Completed, so no "upload next document"
//      task appears for old chains. A run is In Progress only where a document of the chain is still waiting for approval.
//      A rejected first document cancels the run (same rule as the new system).
//   ERR runs come with the ERR stage. Run it AFTER the PO batches. Dry run by default; --apply writes.
//
//   node scripts/migration/stage6-processes.mjs --old-url <old copy> --new-url <new db> --batch <name> [--from 2026-09-01] [--to 2026-10-01] [--limit 50] [--all] [--apply] [--out ./migration-output]

import fs from "node:fs";
import path from "node:path";
import { arg, flag, lit, openDb, stableId } from "./lib/db.mjs";

const OLD_URL = arg("old-url", "OLD_DATABASE_URL");
const NEW_URL = arg("new-url", "NEW_DATABASE_URL");
const BATCH = arg("batch");
const OUT = arg("out") || "./migration-output";
const APPLY = flag("apply");
const F_FROM = arg("from"), F_TO = arg("to"), F_LIMIT = arg("limit") ? Number(arg("limit")) : null, F_ALL = flag("all");
if (!OLD_URL || !NEW_URL || !BATCH) { console.error("Need --old-url, --new-url and --batch <name>."); process.exit(2); }
if (!F_FROM && !F_TO && !F_LIMIT && !F_ALL) { console.error("Choose what to migrate with --from / --to / --limit, or --all."); process.exit(2); }

const oldDb = await openDb(OLD_URL, { readOnly: true });
const newDb = await openDb(NEW_URL);
const relCompRows = await oldDb.select(`SELECT id, "relatedComparisonId" AS comp_id FROM "Document" WHERE "documentType" = 'MATERIAL_REQUISITION' AND "relatedComparisonId" IS NOT NULL`);
await oldDb.close();
const relComp = new Map(relCompRows.map((r) => [r.id, r.comp_id]));

const q = (sql) => newDb.select(sql);
const types = new Map((await q(`SELECT id, code FROM "DocumentType" WHERE code IN ('COMP','MR','PO','INV','ERR','RV','QT')`)).map((t) => [t.code, t.id]));
for (const c of ["COMP", "MR", "PO", "INV", "ERR", "RV", "QT"]) if (!types.get(c)) { console.error(`Document type ${c} is missing in the new database.`); process.exit(1); }
const subs = new Map((await q(`SELECT s.id, s.code, t.code AS tcode FROM "DocumentSubtype" s JOIN "DocumentType" t ON t.id = s."documentTypeId" WHERE t.code IN ('RV','MR')`)).map((s) => [`${s.tcode}:${s.code}`, s.id]));
if (!subs.get("MR:CASH") || !subs.get("MR:CREDIT")) { console.error("Material Req sub types CASH and CREDIT are missing in the new database."); process.exit(1); }
const subCodeById = new Map([...subs.entries()].map(([k, id]) => [id, k]));
if (!subs.get("RV:RELEASE") || !subs.get("RV:RECEIPT")) { console.error("Receiving Voucher sub types RELEASE and RECEIPT are missing in the new database."); process.exit(1); }

// ---- Process trees -----------------------------------------------------------------------------------------------------------
const TREES = [
  { name: "Comparison to Invoice", description: "Comparison, then Material Req (Cash ends there; Credit continues to Purchase Order, then Invoice)", steps: [
    { n: 1, name: "Comparison", type: "COMP", parent: null },
    { n: 2, name: "Material Req (Cash)", type: "MR", sub: "CASH", parent: 1 },
    { n: 3, name: "Material Req (Credit)", type: "MR", sub: "CREDIT", parent: 1 },
    { n: 4, name: "Purchase Order", type: "PO", parent: 3 }, { n: 5, name: "Invoice", type: "INV", parent: 4 } ] },
  { name: "Credit MR to Invoice", description: "Material Req Credit (no comparison), then Purchase Order, then Invoice", steps: [
    { n: 1, name: "Material Req (Credit)", type: "MR", sub: "CREDIT", parent: null }, { n: 2, name: "Purchase Order", type: "PO", parent: 1 }, { n: 3, name: "Invoice", type: "INV", parent: 2 } ] },
  { name: "Cash MR", description: "Material Req Cash on its own: a Cash MR needs no Purchase Order", steps: [
    { n: 1, name: "Material Req (Cash)", type: "MR", sub: "CASH", parent: null } ] },
  { name: "ERR to Receipt", description: "Eq Rental Req (quotation attached as reference), then Release voucher, then Receipt voucher", steps: [
    { n: 1, name: "Eq Rental Req", type: "ERR", parent: null, ref: "QT" }, { n: 2, name: "Release voucher", type: "RV", sub: "RELEASE", parent: 1 },
    { n: 3, name: "Receipt voucher", type: "RV", sub: "RECEIPT", parent: 2 } ] },
];
const existingDefs = new Map((await q(`SELECT id, name, "currentVersion" FROM "ProcessDefinition"`)).map((d) => [d.name, d]));
const existingSteps = await q(`SELECT s.id, s."processDefinitionId", s."stepNumber", s."versionNumber" FROM "ProcessStep" s`);
const treeInfo = new Map(); // name -> { id, steps: Map(n -> id), created }
const st = [];
for (const t of TREES) {
  const ex = existingDefs.get(t.name);
  const id = ex?.id ?? stableId("procdef", t.name);
  const steps = new Map();
  for (const s of t.steps) {
    const found = ex ? existingSteps.find((x) => x.processDefinitionId === ex.id && x.stepNumber === s.n && x.versionNumber === ex.currentVersion) : null;
    steps.set(s.n, found?.id ?? stableId("procstep", `${t.name}:${s.n}`));
  }
  treeInfo.set(t.name, { id, steps, created: !ex, version: ex?.currentVersion ?? 1 });
  if (!ex) {
    st.push(`INSERT INTO "ProcessDefinition" (id, name, description, "isActive", "currentVersion", "createdAt") VALUES (${lit(id)}, ${lit(t.name)}, ${lit(t.description)}, TRUE, 1, now())`);
    for (const s of t.steps) {
      st.push(`INSERT INTO "ProcessStep" (id, "processDefinitionId", "stepNumber", name, "documentTypeId", "documentSubtypeId", "parentStepId", "versionNumber", "referenceDocumentTypeId", "referenceDocumentSubtypeId", "delayHours")
        VALUES (${lit(steps.get(s.n))}, ${lit(id)}, ${s.n}, ${lit(s.name)}, ${lit(types.get(s.type))}, ${lit(s.sub ? subs.get(`${s.type}:${s.sub}`) : null)}, ${lit(s.parent ? steps.get(s.parent) : null)}, 1, ${lit(s.ref ? types.get(s.ref) : null)}, NULL, 0)`);
    }
  }
}

// ---- Documents and links already in the new database -----------------------------------------------------------------------
const docs = new Map((await q(`SELECT d.id, d.status::text AS status, d."documentSubtypeId", d."projectId", d."createdById", d."createdAt", d."approvedAt", t.code AS tcode FROM "Document" d JOIN "DocumentType" t ON t.id = d."documentTypeId" WHERE t.code IN ('COMP','MR','PO')`)).map((d) => [d.id, d]));
const mrNumbers = new Map((await q(`SELECT v."documentId", v."valueText" FROM "DocumentFieldValue" v JOIN "FieldDefinition" f ON f.id = v."fieldDefinitionId" WHERE f."fieldKey" = 'mrNumber'`)).map((r) => [r.documentId, r.valueText]));
const numberById = new Map((await q(`SELECT old_id, old_number, new_number FROM migration.document_map`).catch(() => [])).map((r) => [r.old_id, r]));
const poLinks = await q(`SELECT po_id, kept_mr_old_id AS mr_id, "position", link_created_at FROM migration.po_mr_link WHERE kept_mr_old_id IS NOT NULL ORDER BY link_created_at, "position"`).catch(() => []);
const posByMr = new Map();
for (const l of poLinks) { if (!posByMr.has(l.mr_id)) posByMr.set(l.mr_id, []); if (docs.has(l.po_id)) posByMr.get(l.mr_id).push(l.po_id); }
const doneRuns = new Set((await q(`SELECT run_id FROM migration.process_run_map`).catch(() => [])).map((r) => r.run_id));

// ---- Build the runs ----------------------------------------------------------------------------------------------------------------
const inRange = (d) => (!F_FROM || new Date(d) >= new Date(F_FROM)) && (!F_TO || new Date(d) < new Date(F_TO));
let mrs = [...docs.values()].filter((d) => d.tcode === "MR" && inRange(d.createdAt)).sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt) || (a.id < b.id ? -1 : 1));
if (F_LIMIT) mrs = mrs.slice(0, F_LIMIT);
const runs = []; const notes = { projectMismatch: [], compMissing: [], compNotApproved: 0, extraPoRuns: 0, cashWithPo: [] };
for (const mr of mrs) {
  const compId = relComp.get(mr.id);
  let comp = compId ? docs.get(compId) : null;
  if (compId && !comp) notes.compMissing.push(mr.id);
  if (comp && comp.status === "CANCELLED") { comp = null; notes.compNotApproved++; }
  const isCash = subCodeById.get(mr.documentSubtypeId) === "MR:CASH";
  const allPos = posByMr.get(mr.id) ?? [];
  const pos = isCash ? [] : allPos; // owner rule: a Cash MR never has a PO step
  if (isCash && allPos.length) notes.cashWithPo.push(...allPos.map((p) => `${mr.id}:${p}`));
  const poList = pos.length ? pos : [null];
  poList.forEach((poId, idx) => {
    if (idx > 0) notes.extraPoRuns++;
    const tree = comp ? TREES[0] : isCash ? TREES[2] : TREES[1];
    const info = treeInfo.get(tree.name);
    const nodeNumbers = comp ? [1, isCash ? 2 : 3, 4] : [1, 2];
    const chain = [...(comp ? [comp] : []), mr, ...(poId ? [docs.get(poId)] : [])].map((d, i) => ({ doc: d, node: info.steps.get(nodeNumbers[i]), n: nodeNumbers[i] }));
    if (comp && comp.projectId !== mr.projectId) notes.projectMismatch.push(mr.id);
    const runId = stableId("run", `${mr.id}:${poId ?? ""}`);
    // Walk the chain: the run follows approvals; it ends where the old data ends (owner decision A).
    let status = "IN_PROGRESS", currentIdx = -1, completedAt = null; const links = [];
    for (const [i, c] of chain.entries()) {
      const s = c.doc.status;
      if (s === "CANCELLED") {
        if (i === 0) { links.push({ ...c, current: true }); status = "CANCELLED"; completedAt = c.doc.createdAt; }
        else { links.push({ ...c, current: false }); status = "COMPLETED"; completedAt = chain[i - 1].doc.approvedAt ?? chain[i - 1].doc.createdAt; }
        break;
      }
      links.push({ ...c, current: true });
      if (s === "APPROVED") { currentIdx = i; if (i === chain.length - 1) { status = "COMPLETED"; completedAt = c.doc.approvedAt ?? c.doc.createdAt; } continue; }
      break; // waiting for approval: the run stays in progress
    }
    runs.push({ runId, tree, info, mr, comp, poId, chain, links, status, currentIdx, completedAt, root: chain[0].doc, reference: mrNumbers.get(mr.id) ?? null });
  });
}
const fresh = runs.filter((r) => !doneRuns.has(r.runId));

// ---- Statements --------------------------------------------------------------------------------------------------------------------
const dt = (v) => lit(v ? new Date(v) : null);
st.unshift(`CREATE SCHEMA IF NOT EXISTS migration`, `CREATE TABLE IF NOT EXISTS migration.process_run_map (run_id text PRIMARY KEY, mr_old_id text NOT NULL, po_old_id text, process_name text NOT NULL, status text NOT NULL, batch text NOT NULL, migrated_at timestamptz NOT NULL DEFAULT now())`);
for (const r of fresh) {
  const cur = r.currentIdx >= 0 ? r.chain[r.currentIdx] : null;
  st.push(`INSERT INTO "ProcessInstance" (id, "processDefinitionId", "projectId", reference, status, "currentStepNumber", "currentStepId", "stepVersion", "startedById", "startedAt", "completedAt")
    VALUES (${lit(r.runId)}, ${lit(r.info.id)}, ${lit(r.root.projectId)}, ${lit(r.reference)}, ${lit(r.status)}::"ProcessStatus", ${cur ? cur.n : 1}, ${lit(cur ? cur.node : null)}, ${r.info.version}, ${lit(r.root.createdById)}, ${dt(r.root.createdAt)}, ${dt(r.completedAt)})`);
  for (const l of r.links) {
    st.push(`INSERT INTO "ProcessStepDocument" (id, "processInstanceId", "processStepId", "documentId", source, "linkedById", "isCurrent", "linkedAt", "referenceDocumentId")
      VALUES (${lit(stableId("runlink", `${r.runId}:${l.node}:${l.doc.id}`))}, ${lit(r.runId)}, ${lit(l.node)}, ${lit(l.doc.id)}, 'UPLOADED'::"ProcessStepSource", ${lit(l.doc.createdById)}, ${l.current ? "TRUE" : "FALSE"}, ${dt(l.doc.createdAt)}, NULL)`);
  }
  st.push(`INSERT INTO migration.process_run_map (run_id, mr_old_id, po_old_id, process_name, status, batch) VALUES (${lit(r.runId)}, ${lit(r.mr.id)}, ${lit(r.poId)}, ${lit(r.tree.name)}, ${lit(r.status)}, ${lit(BATCH)})`);
}
const count = async () => (await newDb.select(`SELECT (SELECT count(*) FROM "ProcessInstance")::int AS runs`))[0].runs;
const before = await count();
await newDb.runAll(st, APPLY);
const after = APPLY ? await count() : null;
await newDb.close();

// ---- Plan -----------------------------------------------------------------------------------------------------------------------------
const tally = (arr, key) => { const m = new Map(); for (const i of arr) { const k = key(i); m.set(k, (m.get(k) ?? 0) + 1); } return [...m.entries()].sort(); };
const lines = [
  `# Stage 6 plan: batch "${BATCH}" (${APPLY ? "APPLIED" : "DRY RUN - nothing was written"})`, "",
  `Process trees: ${TREES.map((t) => `${t.name} (${treeInfo.get(t.name).created ? "created now" : "already existed"})`).join(", ")}.`,
  `MRs in this batch: ${mrs.length}. Runs to create: ${fresh.length}. Already created earlier: ${runs.length - fresh.length}. Process runs in the new database: ${before} before${after !== null ? `, ${after} after` : ""}.`, "",
  "## Runs by process and result", "", "| Process | Result | Runs |", "| --- | --- | --- |", ...tally(fresh, (r) => `${r.tree.name} | ${r.status}`).map(([k, n]) => `| ${k} | ${n} |`), "",
  "## How far the chains go", "", "| Process | Documents in the chain | Runs |", "| --- | --- | --- |", ...tally(fresh, (r) => `${r.tree.name} | ${r.chain.map((c) => c.doc.tcode).join(" > ")}`).map(([k, n]) => `| ${k} | ${n} |`), "",
  "## To check", "",
  `- POs linked to a Cash MR (a Cash MR has no PO step, so these POs are not in any run): ${new Set(notes.cashWithPo).size}.`,
  `- MRs that have several POs: ${notes.extraPoRuns} extra runs were made (one run per MR + PO pair, because a run holds one document per step).`,
  `- MRs whose related comparison is rejected, so the run starts at the MR: ${notes.compNotApproved}.`,
  `- MRs whose related comparison was not migrated: ${notes.compMissing.length}.`,
  `- Chains where the comparison and the MR are in different projects (the run takes the comparison's project): ${notes.projectMismatch.length}.`,
];
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, `stage6-${BATCH}-plan.md`), lines.join("\n"));
const cashRows = [...new Set(notes.cashWithPo)].map((x) => x.split(":")).map(([mrId, poId]) => `"${numberById.get(mrId)?.old_number ?? mrId}","${numberById.get(mrId)?.new_number ?? ""}","${mrNumbers.get(mrId) ?? ""}","${numberById.get(poId)?.old_number ?? poId}","${numberById.get(poId)?.new_number ?? ""}"`);
fs.writeFileSync(path.join(OUT, `stage6-${BATCH}-cash-mrs-with-po.csv`), "\ufeff" + ["cash_mr_old_number,cash_mr_new_number,mr_number,po_old_number,po_new_number", ...cashRows].join("\n"));
console.log(lines.join("\n"));
console.log(`\nWritten to ${OUT}`);
