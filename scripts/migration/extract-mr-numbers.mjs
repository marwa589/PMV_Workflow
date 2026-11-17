#!/usr/bin/env node
// scripts/migration/extract-mr-numbers.mjs
//
// READ-ONLY. Every Material Requisition must have an MR number in the new system. Most old MRs have none stored,
// but the number is usually in the title or the file name ("DOC-0823 - MR 209638 + GE177-K2600012087.pdf").
// This script proposes a number for each MR from the title / file names and writes two CSV files:
//   mr-numbers-proposed.csv     documents where a number was found (check a sample), with where it came from
//   mr-numbers-missing.csv      documents where no number could be found: fill in the last column and send it back
//
//   node scripts/migration/extract-mr-numbers.mjs --old-url postgresql://postgres:PASSWORD@localhost:5432/pmv_old_copy [--out ./migration-output]

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

function arg(name, env) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : env ? process.env[env] : undefined;
}
const URL = arg("old-url", "OLD_DATABASE_URL");
const OUT = arg("out") || "./migration-output";
if (!URL) { console.error("Missing --old-url"); process.exit(2); }

function query(sql) {
  const out = execFileSync("psql", [URL, "-X", "-q", "-t", "-A", "-v", "ON_ERROR_STOP=1", "-c", `SELECT coalesce(json_agg(t), '[]'::json) FROM (${sql}) t`],
    { env: { ...process.env, PGOPTIONS: "-c default_transaction_read_only=on" }, maxBuffer: 1 << 30, encoding: "utf8" });
  return JSON.parse(out.trim() || "[]");
}

const rows = query(`
  SELECT d.id, d."documentNumber", d.status::text AS status, d."createdAt", d.title, d."mrNumber" AS stored,
         (SELECT string_agg(v."originalName", ' | ' ORDER BY v."versionNumber") FROM "DocumentVersion" v WHERE v."documentId" = d.id) AS file_names,
         (SELECT string_agg(v."filePath", ' | ' ORDER BY v."versionNumber") FROM "DocumentVersion" v WHERE v."documentId" = d.id) AS file_paths
  FROM "Document" d WHERE d."documentType" = 'MATERIAL_REQUISITION' ORDER BY d."createdAt"`);

// "MR 209638", "MR-209638", "MR209638", "MR# 209638"; also "MR 209694-MR 209695" (several in one document).
const PATTERN = /\bMR\s*[#:.\-_ ]*\s*(\d{4,8})\b/gi;
function findNumbers(text) {
  const found = [];
  for (const m of (text ?? "").matchAll(PATTERN)) if (!found.includes(m[1])) found.push(m[1]);
  return found;
}

const proposed = [];
const missing = [];
for (const row of rows) {
  if (row.stored && row.stored.trim()) continue; // already has one
  let numbers = [], source = "";
  for (const [label, text] of [["title", row.title], ["file name", row.file_names], ["file path", row.file_paths]]) {
    numbers = findNumbers(text);
    if (numbers.length) { source = label; break; }
  }
  if (numbers.length) proposed.push({ ...row, numbers: numbers.join(" + "), source });
  else missing.push(row);
}

const csv = (cells) => cells.map((c) => `"${String(c ?? "").replace(/"/g, '""')}"`).join(",");
const dir = path.join(OUT, `mr-numbers-${new Date().toISOString().replace(/[:.]/g, "-")}`);
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, "mr-numbers-proposed.csv"), "﻿" + [csv(["document_number", "status", "created", "proposed_mr_number(s)", "found_in", "title", "file_names"]),
  ...proposed.map((r) => csv([r.documentNumber, r.status, String(r.createdAt).slice(0, 10), r.numbers, r.source, r.title, r.file_names]))].join("\n"));
fs.writeFileSync(path.join(dir, "mr-numbers-missing.csv"), "﻿" + [csv(["document_number", "status", "created", "title", "file_names", "MR_NUMBER_FILL_IN"]),
  ...missing.map((r) => csv([r.documentNumber, r.status, String(r.createdAt).slice(0, 10), r.title, r.file_names, ""]))].join("\n"));

const multi = proposed.filter((r) => r.numbers.includes("+")).length;
console.log(`MRs total: ${rows.length}; already had a number: ${rows.length - proposed.length - missing.length}; number found: ${proposed.length} (${multi} with several numbers); NOT found: ${missing.length}`);
console.log(`Files written to ${dir}`);
