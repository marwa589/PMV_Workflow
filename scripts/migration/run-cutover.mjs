#!/usr/bin/env node
// scripts/migration/run-cutover.mjs
//
// ONE COMMAND for the cutover. Run it with the old system stopped. It does, in order, and stops at the first error:
//   0  fresh copy of the live old database (a NEW database; nothing is dropped)
//   1  reset: removes what the earlier migration created in the new database and its copied files
//   2  Stage 1 configuration   3  Stage 2 users   4  Stage 3 flows
//   5  MR numbers extracted from the fresh copy
//   6  Stage 4 documents (MR, comparisons, custody)   7  Stage 5 purchase orders   8  Stage 6 process runs   9  Stage 7 ERRs
//   10 Stage 8 file copy   11 Stage 9 reconciliation
// Every stage writes to the new database in ONE transaction, so a stage that fails leaves nothing half-done. Fix the cause, then
// continue with --resume-dir <the report folder it printed> --from-stage <number> (same command plus those two); finished work is skipped.
//
//   node scripts/migration/run-cutover.mjs --source-url <live old db> --new-url <new db> --old-root "<old uploads>" --new-root "<new UPLOAD_PATH>"
//        [--copy-url <already restored copy>]   use this copy instead of taking a new one
//        [--resume-dir <cutover-folder of the failed run> --from-stage 6] [--verify-hash] [--out ./migration-output]

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { arg, flag } from "./lib/db.mjs";

const SOURCE = arg("source-url"), NEW = arg("new-url"), OLD_ROOT = arg("old-root"), NEW_ROOT = arg("new-root"), COPY_URL = arg("copy-url");
const FROM = Number(arg("from-stage") ?? 0), VERIFY = flag("verify-hash");
if ((!SOURCE && !COPY_URL) || !NEW || !OLD_ROOT || !NEW_ROOT) { console.error("Need --source-url (or --copy-url), --new-url, --old-root and --new-root."); process.exit(2); }
const stamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 12);
const RESUME = arg("resume-dir");
const OUT = RESUME ? path.resolve(RESUME) : path.resolve(arg("out") || "./migration-output", `cutover-${stamp}`);
if (RESUME && !FROM) { console.error("--resume-dir needs --from-stage <number>."); process.exit(2); }
fs.mkdirSync(OUT, { recursive: true });
const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const script = (name) => path.join(here, name);
const parse = (url) => {
  const m = /^postgres(?:ql)?:\/\/(?:([^:@/]*)(?::([^@/]*))?@)?([^:/?]*)(?::(\d+))?\/([^?]+)(?:\?(.*))?$/.exec(url);
  if (!m) { console.error("Cannot read the database URL (expected postgresql://user:password@host:port/database)."); process.exit(2); }
  const q = new URLSearchParams(m[6] || "");
  return { host: m[3] || q.get("host") || "localhost", port: m[4] || q.get("port") || "5432", user: decodeURIComponent(m[1] || "postgres"), password: decodeURIComponent(m[2] || ""), db: decodeURIComponent(m[5]) };
};
const withDb = (url, dbFrom, dbTo) => { const r = url.replace(new RegExp(`/${dbFrom.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(\\?|$)`), `/${dbTo}$1`); if (r === url) { console.error("Could not build the copy URL from the source URL."); process.exit(2); } return r; };
const summary = [`# Cutover ${stamp}`, ""];
let COPY = COPY_URL;

function run(label, cmd, args, { env = {}, optional = false } = {}) {
  console.log(`\n=== ${label} ===`);
  const log = path.join(OUT, `${label.replace(/[^A-Za-z0-9]+/g, "-")}.log`);
  const r = spawnSync(cmd, args, { encoding: "utf8", maxBuffer: 1 << 30, env: { ...process.env, ...env } });
  fs.writeFileSync(log, `${r.stdout ?? ""}\n${r.stderr ?? ""}`);
  const lines = (r.stdout ?? "").split("\n");
  const keep = lines.filter((l) => /^(ERRs in|Documents in|Purchase|POs|MRs in|Files in|Copied|Result:|Database reset|Migrated documents|Blocked|STOP|Ready)/.test(l) || /Blocked \(will NOT/.test(l));
  for (const l of keep.slice(0, 8)) console.log("  " + l);
  if (r.status !== 0) {
    console.error(`\nSTOPPED at "${label}" (exit code ${r.status}). Details: ${log}`);
    console.error((r.stderr || r.stdout || "").split("\n").slice(-25).join("\n"));
    summary.push(`**STOPPED at ${label}** (exit ${r.status}). Log: ${log}`);
    fs.writeFileSync(path.join(OUT, "cutover-summary.md"), summary.join("\n"));
    process.exit(1);
  }
  summary.push(`- ${label}: done`, ...keep.slice(0, 6).map((l) => `    - ${l}`));
  return r.stdout ?? "";
}
const node = (label, file, args) => run(label, process.execPath, [script(file), ...args]);

// 0. Fresh copy
if (FROM <= 0 && !COPY_URL) {
  const s = parse(SOURCE); const env = { PGPASSWORD: s.password };
  const name = `pmv_old_cut_${stamp}`; const dump = path.join(os.tmpdir(), `pmv_old_cut_${stamp}.dump`); // outside the report folder: it holds password hashes
  const base = ["-h", s.host, "-p", s.port, "-U", s.user];
  run("0a dump the live old database", "pg_dump", [...base, "-Fc", "-f", dump, s.db], { env });
  if (!fs.existsSync(dump) || fs.statSync(dump).size < 1000) { console.error("The dump is missing or too small. Stopping."); process.exit(1); }
  run("0b create the copy", "createdb", [...base, name], { env });
  run("0c restore the copy", "pg_restore", [...base, "-d", name, "--no-owner", dump], { env });
  COPY = withDb(SOURCE, s.db, name);
  fs.writeFileSync(path.join(OUT, "copy-db.txt"), name); // only the name: no password is saved in the report folder
  summary.push(`Copy database: ${name}`);
} else if (!COPY) { if (!SOURCE) { console.error("Resuming needs --source-url too."); process.exit(2); } COPY = withDb(SOURCE, parse(SOURCE).db, fs.readFileSync(path.join(OUT, "copy-db.txt"), "utf8").trim()); }
console.log(`\nOld data copy: ${COPY.replace(/:[^:@/]*@/, ":***@")}`);

const common = ["--old-url", COPY, "--new-url", NEW, "--out", OUT];
const stages = [
  [1, () => node("1 reset the earlier migration", "stage0-reset-documents.mjs", ["--new-url", NEW, "--new-root", NEW_ROOT, "--apply"])],
  [2, () => node("2 stage 1 configuration", "stage1-config.mjs", [...common, "--apply"])],
  [3, () => node("3 stage 2 users", "stage2-users.mjs", [...common, "--upload-root", OLD_ROOT, "--apply"])],
  [4, () => node("4 stage 3 flows", "stage3-flows.mjs", ["--new-url", NEW, "--out", OUT, "--apply"])],
  [5, () => node("5 MR numbers", "extract-mr-numbers.mjs", ["--old-url", COPY, "--out", OUT])],
  [6, () => { const d = fs.readdirSync(OUT).filter((x) => x.startsWith("mr-numbers-")).sort().pop(); node("6 stage 4 documents", "stage4-documents.mjs", [...common, "--batch", "cut-docs", "--types", "MR,COMP,CUSTODY", "--mr-numbers", path.join(OUT, d, "mr-numbers-proposed.csv"), "--upload-root", OLD_ROOT, "--apply"]); }],
  [7, () => node("7 stage 5 purchase orders", "stage5-purchase-orders.mjs", [...common, "--batch", "cut-po", "--all", "--duplicates", path.join(OUT, "stage4-cut-docs-duplicates-dropped.csv"), "--upload-root", OLD_ROOT, "--apply"])],
  [8, () => node("8 stage 6 process runs", "stage6-processes.mjs", [...common, "--batch", "cut-runs", "--all", "--apply"])],
  [9, () => node("9 stage 7 ERRs", "stage7-errs.mjs", [...common, "--batch", "cut-err", "--all", "--upload-root", OLD_ROOT, "--apply"])],
  [10, () => node("10 stage 8 copy files", "stage8-copy-files.mjs", ["--new-url", NEW, "--old-root", OLD_ROOT, "--new-root", NEW_ROOT, "--out", OUT, "--apply", ...(VERIFY ? ["--verify-hash"] : [])])],
  [11, () => { try { node("11 stage 9 reconciliation", "stage9-reconcile.mjs", [...common, "--new-root", NEW_ROOT]); } catch {} }],
];
for (const [n, fn] of stages) if (n >= FROM) fn();

// Blocked documents per stage (from the plans written to OUT)
const blockedLines = [];
for (const f of fs.readdirSync(OUT).filter((x) => /-plan\.md$/.test(x))) {
  const m = fs.readFileSync(path.join(OUT, f), "utf8").match(/Blocked[^:]*: (\d+)/);
  if (m && Number(m[1]) > 0) blockedLines.push(`${f}: ${m[1]} blocked (see the matching -blocked.csv)`);
}
summary.push("", "## Needs your attention", "", blockedLines.length ? blockedLines.map((l) => `- ${l}`).join("\n") : "Nothing is blocked.");
const rec = path.join(OUT, "stage9-reconcile-report.md");
if (fs.existsSync(rec)) summary.push("", fs.readFileSync(rec, "utf8").split("\n").slice(0, 3).join("\n"));
fs.writeFileSync(path.join(OUT, "cutover-summary.md"), summary.join("\n"));
console.log(`\n${summary.slice(-8).join("\n")}\n\nAll stages finished. Report folder: ${OUT}`);
