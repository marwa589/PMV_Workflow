// Fold a document TYPE into a SUB TYPE of another type, then delete the old type.
// Built for: document type "Receipt"  ->  Receiving Voucher / Receipt (REC).
//
// Everything that points at the old type (or any of its own sub types) is moved to the target type + sub type:
//   documents (renumbered as <RV>-<REC>-<year>-<seq>, unless --keep-numbers), their custom field values,
//   process steps (and steps that use it as their reference type), flow assignments, role assignments and
//   role type/sub type scopes, mail follow rules and mail settings. Then the old type is deleted.
// Where the target already has the same thing (same flow assignment, same role, same custom field), the target's
// one is kept and the old one is dropped; the report lists each of these.
//
// Dry run by default: runs the whole change inside a transaction, prints the report and ROLLS BACK.
// Usage (run from the new system's project folder, where "pg" is installed):
//   node merge-type-into-subtype.mjs "<.env>" --find                                   -> lists types and sub types
//   node merge-type-into-subtype.mjs "<.env>" --from RECEIPT --to RV --to-subtype RECEIPT   -> dry run (codes or ids)
//   node merge-type-into-subtype.mjs "<.env>" --from RECEIPT --to RV --to-subtype RECEIPT --apply [--keep-numbers]
// Take a DB backup before --apply.
import fs from "node:fs";
import crypto from "node:crypto";
import pg from "pg";

const argv = process.argv.slice(2);
const envFile = argv[0];
const arg = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : null; };
const FROM = arg("--from"), TO = arg("--to"), TO_SUB = arg("--to-subtype");
const APPLY = argv.includes("--apply"), FIND = argv.includes("--find"), KEEP_NUMBERS = argv.includes("--keep-numbers");
if (!envFile || (!FIND && (!FROM || !TO || !TO_SUB))) {
  console.error('Usage: node merge-type-into-subtype.mjs "<.env>" --find | --from <type> --to <type> --to-subtype <sub type> [--apply] [--keep-numbers]');
  process.exit(1);
}
const url = fs.readFileSync(envFile, "utf8").match(/DATABASE_URL\s*=\s*(.*)/)[1].trim().replace(/^["']|["']$/g, "");
const pool = new pg.Pool({ connectionString: url, max: 1 });
const c = await pool.connect();
const q = async (t, p = []) => (await c.query(t, p)).rows;
const qi = (s) => `"${s.replace(/"/g, '""')}"`;
const done = async (code = 0) => { c.release(); await pool.end(); process.exit(code); };
console.log(`DB: ${new URL(url).pathname.slice(1)} @ ${new URL(url).host}   mode: ${APPLY ? "APPLY" : "DRY RUN (changes are rolled back)"}`);

if (FIND) {
  const types = await q(`SELECT t.id, t.code, t."numberingCode", t.name, t."isActive", (SELECT count(*)::int FROM "Document" d WHERE d."documentTypeId"=t.id) AS docs FROM "DocumentType" t ORDER BY t.name`);
  const subs = await q(`SELECT s.id, s."documentTypeId", s.code, s."numberingCode", s.name, s."isActive", (SELECT count(*)::int FROM "Document" d WHERE d."documentSubtypeId"=s.id) AS docs FROM "DocumentSubtype" s ORDER BY s.name`);
  for (const t of types) {
    console.log(`\n${t.name}  code=${t.code}  number=${t.numberingCode || t.code}  docs=${t.docs}${t.isActive ? "" : "  (inactive)"}  id=${t.id}`);
    for (const s of subs.filter((s) => s.documentTypeId === t.id)) console.log(`    - ${s.name}  code=${s.code}  number=${s.numberingCode || s.code}  docs=${s.docs}${s.isActive ? "" : "  (inactive)"}  id=${s.id}`);
  }
  await done();
}

const findType = async (k) => (await q(`SELECT * FROM "DocumentType" WHERE id=$1 OR upper(code)=upper($1) OR lower(name)=lower($1)`, [k]));
const fromRows = await findType(FROM), toRows = await findType(TO);
if (fromRows.length !== 1 || toRows.length !== 1) { console.error(`--from matched ${fromRows.length} type(s), --to matched ${toRows.length}; each must match exactly one (use --find, then pass the id).`); await done(1); }
const F = fromRows[0], T = toRows[0];
if (F.id === T.id) { console.error("--from and --to are the same type"); await done(1); }
const subRows = await q(`SELECT * FROM "DocumentSubtype" WHERE "documentTypeId"=$1 AND (id=$2 OR upper(code)=upper($2) OR lower(name)=lower($2))`, [T.id, TO_SUB]);
if (subRows.length !== 1) { console.error(`--to-subtype matched ${subRows.length} sub type(s) of ${T.name}; use --find.`); await done(1); }
const S = subRows[0];
const fromSubs = (await q(`SELECT id, name FROM "DocumentSubtype" WHERE "documentTypeId"=$1`, [F.id]));
const fromSubIds = fromSubs.map((s) => s.id);
console.log(`\nFROM type (will be deleted): ${F.name} [${F.code}] id=${F.id}${fromSubs.length ? `  own sub types: ${fromSubs.map((s) => s.name).join(", ")} (all folded in too)` : ""}`);
console.log(`TO:                          ${T.name} [${T.code}] / ${S.name} [${S.code}]`);

const report = [];
const note = (line) => { report.push(line); console.log("  " + line); };

await c.query("BEGIN");
try {
  // ---- 1. Custom fields: reuse the target's field with the same key, otherwise move the field itself ----
  console.log("\n== Custom fields ==");
  const fFields = await q(`SELECT * FROM "FieldDefinition" WHERE "documentTypeId"=$1`, [F.id]);
  for (const f of fFields) {
    const [match] = await q(
      `SELECT id FROM "FieldDefinition" WHERE "documentTypeId"=$1 AND ("documentSubtypeId" IS NULL OR "documentSubtypeId"=$2) AND "fieldGroup"=$3 AND "fieldKey"=$4 ORDER BY ("documentSubtypeId" IS NULL) LIMIT 1`,
      [T.id, S.id, f.fieldGroup, f.fieldKey],
    );
    if (match) {
      const r = await c.query(`UPDATE "DocumentFieldValue" SET "fieldDefinitionId"=$1 WHERE "fieldDefinitionId"=$2`, [match.id, f.id]);
      await c.query(`DELETE FROM "FieldDefinition" WHERE id=$1`, [f.id]);
      note(`field "${f.label}" (${f.fieldKey}): ${T.name} already has it -> ${r.rowCount} value(s) moved onto the existing field`);
    } else {
      await c.query(`UPDATE "FieldDefinition" SET "documentTypeId"=$1, "documentSubtypeId"=$2 WHERE id=$3`, [T.id, S.id, f.id]);
      note(`field "${f.label}" (${f.fieldKey}): moved to ${T.name} / ${S.name}`);
    }
  }
  if (!fFields.length) note("none");

  // ---- 2. Documents ----
  console.log("\n== Documents ==");
  const docs = await q(`SELECT id, "documentNumber", "createdAt" FROM "Document" WHERE "documentTypeId"=$1 ORDER BY "createdAt", id`, [F.id]);
  if (KEEP_NUMBERS || !docs.length) {
    await c.query(`UPDATE "Document" SET "documentTypeId"=$1, "documentSubtypeId"=$2 WHERE "documentTypeId"=$3`, [T.id, S.id, F.id]);
    note(`${docs.length} document(s) moved${docs.length ? " (numbers kept)" : ""}`);
  } else {
    // Continue the target's sequence for each year: after its counter and after any existing number.
    const prefix = `${T.numberingCode || T.code}-${S.numberingCode || S.code}-`;
    const next = new Map();
    const seqOf = async (year) => {
      if (next.has(year)) return next.get(year);
      const [ctr] = await q(`SELECT max("lastValue")::int AS v FROM "DocumentNumberCounter" WHERE "documentTypeId"=$1 AND "documentSubtypeId"=$2 AND "projectId" IS NULL AND "periodYear"=$3`, [T.id, S.id, year]);
      const [mx] = await q(`SELECT max((substring("documentNumber" from '-(\\d+)$'))::int)::int AS v FROM "Document" WHERE "documentNumber" LIKE $1`, [`${prefix}${year}-%`]);
      const v = Math.max(ctr?.v ?? 0, mx?.v ?? 0);
      next.set(year, v);
      return v;
    };
    const temp = `__merge_${crypto.randomUUID()}__`;
    await c.query(`UPDATE "Document" SET "documentNumber"=$1 || id WHERE "documentTypeId"=$2`, [temp, F.id]);
    for (const d of docs) {
      const year = new Date(d.createdAt).getUTCFullYear();
      const seq = (await seqOf(year)) + 1;
      next.set(year, seq);
      const number = `${prefix}${year}-${String(seq).padStart(4, "0")}`;
      await c.query(`UPDATE "Document" SET "documentTypeId"=$1, "documentSubtypeId"=$2, "documentNumber"=$3 WHERE id=$4`, [T.id, S.id, number, d.id]);
      note(`${d.documentNumber}  ->  ${number}`);
    }
    for (const [year, v] of next) {
      await c.query(
        `INSERT INTO "DocumentNumberCounter" ("id","documentTypeId","documentSubtypeId","projectId","periodYear","lastValue")
         VALUES (gen_random_uuid()::text, $1, $2, NULL, $3, $4)
         ON CONFLICT ("documentTypeId", (COALESCE("documentSubtypeId", '')), (COALESCE("projectId", '')), "periodYear")
         DO UPDATE SET "lastValue" = GREATEST("DocumentNumberCounter"."lastValue", EXCLUDED."lastValue")`,
        [T.id, S.id, year, v],
      );
    }
    note(`${docs.length} document(s) moved and renumbered; ${S.name} counter updated`);
  }

  // ---- 3. Process steps (their own document and their reference document) ----
  console.log("\n== Process steps ==");
  const ps = await c.query(`UPDATE "ProcessStep" SET "documentTypeId"=$1, "documentSubtypeId"=$2 WHERE "documentTypeId"=$3`, [T.id, S.id, F.id]);
  const pr = await c.query(`UPDATE "ProcessStep" SET "referenceDocumentTypeId"=$1, "referenceDocumentSubtypeId"=$2 WHERE "referenceDocumentTypeId"=$3`, [T.id, S.id, F.id]);
  note(`${ps.rowCount} step(s) now upload ${T.name} / ${S.name}; ${pr.rowCount} step(s) now take it as their reference document`);

  // ---- 4. Flow assignments ----
  console.log("\n== Flow assignments ==");
  const fas = await q(`SELECT * FROM "DocumentWorkflowAssignment" WHERE "documentTypeId"=$1`, [F.id]);
  for (const a of fas) {
    const [existing] = await q(`SELECT id, "templateId" FROM "DocumentWorkflowAssignment" WHERE "documentTypeId"=$1 AND "documentSubtypeId"=$2 AND "projectId" IS NOT DISTINCT FROM $3`, [T.id, S.id, a.projectId]);
    if (existing) {
      await c.query(`DELETE FROM "DocumentWorkflowAssignment" WHERE id=$1`, [a.id]);
      note(`project ${a.projectId ?? "(all projects)"}: ${S.name} already has a flow assignment (template ${existing.templateId ?? "auto-approve"}); the old one (template ${a.templateId ?? "auto-approve"}) is dropped`);
    } else {
      await c.query(`UPDATE "DocumentWorkflowAssignment" SET "documentTypeId"=$1, "documentSubtypeId"=$2 WHERE id=$3`, [T.id, S.id, a.id]);
      note(`project ${a.projectId ?? "(all projects)"}: flow assignment moved to ${S.name}`);
    }
  }
  if (!fas.length) note("none");

  // ---- 5. Role assignments limited to the old type ----
  console.log("\n== Role assignments ==");
  const uas = await q(`SELECT * FROM "UserAssignment" WHERE "documentTypeId"=$1`, [F.id]);
  for (const a of uas) {
    const [dup] = await q(
      `SELECT id FROM "UserAssignment" WHERE "userId"=$1 AND "roleId"=$2 AND "companyId" IS NOT DISTINCT FROM $3 AND "projectId" IS NOT DISTINCT FROM $4 AND "locationId" IS NOT DISTINCT FROM $5 AND "documentTypeId"=$6 AND "documentSubtypeId"=$7`,
      [a.userId, a.roleId, a.companyId, a.projectId, a.locationId, T.id, S.id],
    );
    if (dup) {
      await c.query(`DELETE FROM "UserAssignment" WHERE id=$1`, [a.id]);
      note(`assignment ${a.id}: the same role already exists for ${S.name}; dropped`);
    } else {
      await c.query(`UPDATE "UserAssignment" SET "documentTypeId"=$1, "documentSubtypeId"=$2 WHERE id=$3`, [T.id, S.id, a.id]);
      note(`assignment ${a.id}: now limited to ${T.name} / ${S.name}`);
    }
  }
  const scopes = await q(`SELECT * FROM "UserAssignmentDocumentTypeScope" WHERE "documentTypeId"=$1`, [F.id]);
  for (const sc of scopes) {
    const [onTarget] = await q(`SELECT "allSubtypes" FROM "UserAssignmentDocumentTypeScope" WHERE "userAssignmentId"=$1 AND "documentTypeId"=$2`, [sc.userAssignmentId, T.id]);
    if (!onTarget) {
      await c.query(`INSERT INTO "UserAssignmentDocumentTypeScope" ("userAssignmentId","documentTypeId","allSubtypes") VALUES ($1,$2,false)`, [sc.userAssignmentId, T.id]);
    }
    if (!onTarget || !onTarget.allSubtypes) {
      await c.query(`INSERT INTO "UserAssignmentDocumentSubtypeScope" ("userAssignmentId","documentTypeId","documentSubtypeId") VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`, [sc.userAssignmentId, T.id, S.id]);
    }
    await c.query(`DELETE FROM "UserAssignmentDocumentTypeScope" WHERE "userAssignmentId"=$1 AND "documentTypeId"=$2`, [sc.userAssignmentId, F.id]);
    note(`role scope of assignment ${sc.userAssignmentId}: ${onTarget?.allSubtypes ? `already covers all of ${T.name}` : `now includes ${T.name} / ${S.name}`}`);
  }
  if (!uas.length && !scopes.length) note("none");

  // ---- 6. Mail ----
  console.log("\n== Mail ==");
  const rules = await q(`SELECT * FROM "MailFollowRule" WHERE "documentTypeId"=$1`, [F.id]);
  for (const r of rules) {
    const [dup] = await q(`SELECT id FROM "MailFollowRule" WHERE "userId"=$1 AND scope=$2 AND "documentTypeId"=$3`, [r.userId, r.scope, T.id]);
    if (dup) await c.query(`DELETE FROM "MailFollowRule" WHERE id=$1`, [r.id]);
    else await c.query(`UPDATE "MailFollowRule" SET "documentTypeId"=$1 WHERE id=$2`, [T.id, r.id]);
    note(`follow rule of user ${r.userId}: ${dup ? `already follows ${T.name}; dropped` : `now follows ${T.name} (follow rules are per type, so this covers all its sub types)`}`);
  }
  const ms = await c.query(
    `UPDATE "MailSetting" SET
       "documentTypeIds" = array_remove("documentTypeIds", $1::text),
       "documentSubtypeIds" = (SELECT array_agg(DISTINCT x) FROM unnest(array_append(array(SELECT y FROM unnest("documentSubtypeIds") y WHERE NOT (y = ANY($3::text[]))), $2::text)) x)
     WHERE $1::text = ANY("documentTypeIds") OR "documentSubtypeIds" && $3::text[]`,
    [F.id, S.id, fromSubIds],
  );
  note(`${rules.length} follow rule(s); ${ms.rowCount} mail setting(s) now point at ${T.name} / ${S.name} instead of ${F.name} (type)`);

  // ---- 7. Anything still pointing at the old type is listed, then the type is deleted ----
  console.log(`\n== Deleting ${F.name} ==`);
  const fks = await q(`
    SELECT cl.relname AS tbl, att.attname AS col, con.confrelid::regclass::text AS target
    FROM pg_constraint con JOIN pg_class cl ON cl.oid=con.conrelid JOIN pg_namespace ns ON ns.oid=cl.relnamespace
    JOIN pg_attribute att ON att.attrelid=con.conrelid AND att.attnum=con.conkey[1]
    WHERE con.contype='f' AND ns.nspname='public' AND array_length(con.conkey,1)=1
      AND con.confrelid IN ('"DocumentType"'::regclass, '"DocumentSubtype"'::regclass)`);
  for (const f of fks) {
    const ids = f.target.includes("Subtype") ? fromSubIds : [F.id];
    if (!ids.length || f.tbl === "DocumentSubtype") continue;
    const [{ n }] = await q(`SELECT count(*)::int AS n FROM ${qi(f.tbl)} WHERE ${qi(f.col)} = ANY($1::text[])`, [ids]);
    if (n) note(`${f.tbl}.${f.col}: ${n} row(s) still point at ${F.name}; removed with it`);
  }
  await c.query(`DELETE FROM "DocumentType" WHERE id=$1`, [F.id]);
  note(`${F.name} deleted`);

  if (APPLY) {
    await c.query("COMMIT");
    console.log("\nAPPLIED.");
  } else {
    await c.query("ROLLBACK");
    console.log("\nDRY RUN: nothing was changed. Re-run with --apply to make these changes (take a DB backup first).");
  }
} catch (error) {
  await c.query("ROLLBACK");
  console.error(`\nFAILED, nothing was changed: ${error.message}${error.detail ? `\n${error.detail}` : ""}`);
  await done(1);
}
await done();
