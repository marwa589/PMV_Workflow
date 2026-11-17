#!/usr/bin/env node
// scripts/migration/stage8-copy-files.mjs
//
// STAGE 8: copies the files of every migrated document from the OLD upload folder to the NEW system's upload folder,
// using migration.file_map (written by Stages 4, 5 and 7: old path -> new path). Old files are only READ, never moved or changed.
//   - Dry run by default: checks everything and writes the plan, copies nothing. --apply copies.
//   - Never overwrites: if the target already exists with the same size it is counted as done; with a different size it is reported as a conflict.
//   - Stops before copying anything if two files would land on the same new path (also ignoring upper/lower case, as Windows does).
//   - Safe to repeat: copied files are marked (copied_at) and skipped next time.
//
//   node scripts/migration/stage8-copy-files.mjs --new-url <new db> --old-root "<old uploads folder>" --new-root "<new system UPLOAD_PATH>"
//        [--limit 500] [--verify-hash] [--apply] [--out ./migration-output]

import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { arg, flag, lit, openDb } from "./lib/db.mjs";

const NEW_URL = arg("new-url", "NEW_DATABASE_URL");
const OLD_ROOT = arg("old-root", "OLD_UPLOAD_ROOT");
const NEW_ROOT = arg("new-root", "NEW_UPLOAD_ROOT");
const OUT = arg("out") || "./migration-output";
const APPLY = flag("apply"), VERIFY_HASH = flag("verify-hash");
const LIMIT = arg("limit") ? Number(arg("limit")) : null;
if (!NEW_URL || !OLD_ROOT || !NEW_ROOT) { console.error("Need --new-url, --old-root and --new-root."); process.exit(2); }
if (path.resolve(OLD_ROOT) === path.resolve(NEW_ROOT)) { console.error("--old-root and --new-root are the same folder. Use two different folders."); process.exit(2); }
if (!fs.existsSync(OLD_ROOT)) { console.error(`Old folder not found: ${OLD_ROOT}`); process.exit(2); }
if (/[<>]/.test(NEW_ROOT)) { console.error("--new-root still has the placeholder text. Put the real folder (the UPLOAD_PATH value from the new system's .env)."); process.exit(2); }
if (APPLY) fs.mkdirSync(NEW_ROOT, { recursive: true });

const db = await openDb(NEW_URL);
const rows = await db.select(`SELECT m.version_id, m.document_id, m.old_path, m.resolved_old_path, m.new_path, m.original_name, m.copied_at, d."documentNumber" AS number
  FROM migration.file_map m LEFT JOIN "Document" d ON d.id = m.document_id ORDER BY m.new_path, m.version_id`);

const sha = (file) => createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const csv = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;

// 1. Two files on one target path.
const byTarget = new Map();
for (const r of rows) { const k = r.new_path.toLowerCase(); if (!byTarget.has(k)) byTarget.set(k, []); byTarget.get(k).push(r); }
const collisions = [...byTarget.values()].filter((g) => g.length > 1);
if (collisions.length) {
  console.error(`STOP: ${collisions.length} new path(s) are used by more than one file (nothing was copied):`);
  for (const g of collisions.slice(0, 20)) console.error(`  ${g[0].new_path}  <-  ${g.map((r) => r.number ?? r.document_id).join(", ")}`);
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, "stage8-collisions.csv"), "﻿" + ["new_path,document,old_path", ...collisions.flatMap((g) => g.map((r) => [csv(r.new_path), r.number ?? r.document_id, csv(r.old_path)].join(",")))].join("\n"));
  process.exit(3);
}

// 2. Check each file.
const todo = [], done = [], missing = [], conflicts = [], tooLong = [];
for (const r of rows) {
  if (r.copied_at) { done.push(r); continue; }
  const candidates = [r.resolved_old_path, r.old_path, r.old_path.replace(/\/ /g, "/_")].filter(Boolean).map((c) => path.join(OLD_ROOT, c));
  const src = candidates.find((c) => fs.existsSync(c) && fs.statSync(c).isFile());
  const dest = path.join(NEW_ROOT, r.new_path);
  if (dest.length > 255) tooLong.push(r);
  if (!src) { missing.push(r); continue; }
  const size = fs.statSync(src).size;
  if (fs.existsSync(dest)) {
    if (fs.statSync(dest).size === size) { done.push({ ...r, alreadyThere: true, size }); continue; }
    conflicts.push({ ...r, src, dest, size }); continue;
  }
  todo.push({ ...r, src, dest, size });
}
const bytes = todo.reduce((n, r) => n + r.size, 0);

// 3. Copy.
const copied = []; const failed = [];
if (APPLY) {
  const batch = [];
  const flush = async () => { if (batch.length) { await db.runAll(batch.splice(0), true); } };
  for (const r of (LIMIT ? todo.slice(0, LIMIT) : todo)) {
    try {
      fs.mkdirSync(path.dirname(r.dest), { recursive: true });
      fs.copyFileSync(r.src, r.dest, fs.constants.COPYFILE_EXCL);
      if (fs.statSync(r.dest).size !== r.size || (VERIFY_HASH && sha(r.src) !== sha(r.dest))) { fs.rmSync(r.dest, { force: true }); throw new Error("copy does not match the original"); }
      copied.push(r);
      batch.push(`UPDATE migration.file_map SET copied_at = now(), disk_size = ${r.size}, exists_on_disk = TRUE WHERE version_id = ${lit(r.version_id)}`);
      if (batch.length >= 200) await flush();
    } catch (error) { failed.push({ ...r, error: String(error.message ?? error) }); }
  }
  for (const r of done.filter((x) => x.alreadyThere)) batch.push(`UPDATE migration.file_map SET copied_at = now(), disk_size = ${r.size}, exists_on_disk = TRUE WHERE version_id = ${lit(r.version_id)}`);
  await flush();
}
await db.close();

// 4. Plan.
const mb = (n) => `${(n / 1048576).toFixed(1)} MB`;
const lines = [
  `# Stage 8 plan: copy files (${APPLY ? "APPLIED" : "DRY RUN - nothing was copied"})`, "",
  `Old folder: ${OLD_ROOT}`, `New folder: ${NEW_ROOT}`, "",
  `Files in the file map: ${rows.length}. Already copied/present: ${done.length}. To copy: ${todo.length} (${mb(bytes)}). Missing in the old folder: ${missing.length}. Conflicts (target exists with a different size): ${conflicts.length}. Path longer than 255 characters: ${tooLong.length}.`,
  ...(APPLY ? ["", `Copied now: ${copied.length}. Failed: ${failed.length}.`] : []), "",
  "## Missing files (the document stays without its file; re-upload later)", "", missing.length ? missing.slice(0, 40).map((r) => `- ${r.number ?? r.document_id}: ${r.old_path}`).join("\n") : "None.", "",
  "## Conflicts", "", conflicts.length ? conflicts.slice(0, 40).map((r) => `- ${r.dest}`).join("\n") : "None.", "",
  ...(failed.length ? ["## Failed", "", ...failed.slice(0, 40).map((r) => `- ${r.old_path}: ${r.error}`), ""] : []),
];
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, `stage8-plan.md`), lines.join("\n"));
fs.writeFileSync(path.join(OUT, `stage8-issues.csv`), "﻿" + ["issue,document,old_path,new_path", ...[...missing.map((r) => ["MISSING", r]), ...conflicts.map((r) => ["CONFLICT", r]), ...tooLong.map((r) => ["PATH_TOO_LONG", r]), ...failed.map((r) => ["FAILED", r])].map(([i, r]) => [i, r.number ?? r.document_id, csv(r.old_path), csv(r.new_path)].join(","))].join("\n"));
console.log(lines.join("\n"));
console.log(`\nWritten to ${OUT}`);
if (failed.length || conflicts.length) process.exitCode = 1;
