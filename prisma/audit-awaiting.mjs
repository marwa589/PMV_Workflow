// READ-ONLY audit of the "waiting for upload" numbers. Changes nothing.
//   node prisma/audit-awaiting.mjs
// It recounts, straight from the data, every (run, next step) that is waiting for a document, using the same rule as
// the Tasks panel, and then checks whether the "missing" document may already exist in the system but was never linked.
// Writes awaiting-audit-<date>.csv (open it in Excel) next to where you run it.
import nextEnv from "@next/env";
import { writeFile } from "node:fs/promises";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

//#region helpers
// Numbers of 5+ digits in a text (MR 214469, LPO-783254 ...): the part of a file name that identifies a document.
export function idNumbers(text) {
  return [...new Set((String(text ?? "").match(/\d{5,}/g) ?? []).filter((n) => !/^20\d{2}$/.test(n)))];
}
//#endregion

const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].split(/[\\/]/).pop());
if (isMain) {
  nextEnv.loadEnvConfig(process.cwd(), true);
  const prisma = new PrismaClient({ adapter: new PrismaPg(process.env.DATABASE_URL) });
  const DAY = 86_400_000;
  const now = Date.now();
  const dead = (status) => status === "CANCELLED" || status === "ARCHIVED";

  // ---- 1. Every run waiting for an upload (same rule as the Tasks panel) ----
  const runs = await prisma.processInstance.findMany({
    where: { status: "IN_PROGRESS", currentStepId: { not: null }, currentStep: { childSteps: { some: {} } } },
    select: {
      id: true, reference: true, projectId: true, parentInstanceId: true,
      processDefinition: { select: { name: true } },
      currentStep: {
        select: {
          id: true, name: true,
          childSteps: { select: { id: true, name: true, documentTypeId: true, documentSubtypeId: true, documentType: { select: { code: true } }, documentSubtype: { select: { code: true } } } },
        },
      },
      stepDocuments: {
        where: { isCurrent: true },
        select: { processStep: { select: { id: true, parentStepId: true } }, document: { select: { id: true, documentNumber: true, title: true, approvedAt: true } } },
      },
    },
  });

  const items = [];
  for (const run of runs) {
    if (run.stepDocuments.some((l) => l.processStep.parentStepId === run.currentStep.id)) continue; // a next document is already in progress
    const last = run.stepDocuments.find((l) => l.processStep.id === run.currentStep.id)?.document ?? null;
    for (const child of run.currentStep.childSteps) items.push({ run, child, last });
  }

  console.log(`Runs in progress that are waiting for an upload: ${new Set(items.map((i) => i.run.id)).size}`);
  console.log(`Waiting items (run x next step): ${items.length}\n`);

  // ---- 2. Counts per process and next step, and per type code (what the panel shows) ----
  const byStep = new Map();
  const byType = new Map();
  for (const { run, child } of items) {
    const typeCode = `${child.documentType.code}${child.documentSubtype ? "-" + child.documentSubtype.code : ""}`;
    const key = `${run.processDefinition.name} | after "${run.currentStep.name}" -> waiting for "${child.name}" (${typeCode})`;
    byStep.set(key, (byStep.get(key) ?? 0) + 1);
    byType.set(child.documentType.code, (byType.get(child.documentType.code) ?? 0) + 1);
  }
  console.log("Waiting per process and step:");
  [...byStep.entries()].sort().forEach(([k, v]) => console.log(`  ${String(v).padStart(5)}  ${k}`));
  console.log("\nWaiting per document type code (compare with the panel):");
  [...byType.entries()].sort().forEach(([k, v]) => console.log(`  ${String(v).padStart(5)}  ${k}`));

  // ---- 3. How long have they been waiting? ----
  const buckets = { "under 7 days": 0, "7-30 days": 0, "30-90 days": 0, "over 90 days": 0, "no approval date": 0 };
  for (const { last } of items) {
    if (!last?.approvedAt) buckets["no approval date"] += 1;
    else {
      const days = (now - last.approvedAt.getTime()) / DAY;
      buckets[days < 7 ? "under 7 days" : days < 30 ? "7-30 days" : days < 90 ? "30-90 days" : "over 90 days"] += 1;
    }
  }
  console.log("\nWaiting since the last approved document of the run:");
  Object.entries(buckets).forEach(([k, v]) => console.log(`  ${String(v).padStart(5)}  ${k}`));

  // ---- 4. Is one document counted several times? ----
  const perLast = new Map();
  for (const { child, last } of items) if (last) perLast.set(`${child.id}|${last.id}`, (perLast.get(`${child.id}|${last.id}`) ?? 0) + 1);
  const doubled = [...perLast.entries()].filter(([, n]) => n > 1);
  console.log(`\nThe same document waiting for the same next step in more than one run: ${doubled.length} case(s) (${doubled.reduce((s, [, n]) => s + n - 1, 0)} extra items)`);

  // ---- 5. Does the "missing" document already exist but was never linked? ----
  // Documents of the next step's type, same project, whose name shares a 5+ digit number with the last document
  // (e.g. LPO-783254-MR-214469 for MR 214469).
  const typeIds = [...new Set(items.map((i) => i.child.documentTypeId))];
  const candidates = await prisma.document.findMany({
    where: { documentTypeId: { in: typeIds }, isReference: false, status: { notIn: ["CANCELLED", "ARCHIVED"] } },
    select: {
      id: true, documentNumber: true, title: true, status: true, projectId: true, documentTypeId: true, documentSubtypeId: true,
      versions: { select: { originalName: true } },
      processLinks: { where: { isCurrent: true, processInstance: { status: { not: "CANCELLED" } } }, select: { processInstanceId: true } },
    },
  });
  const index = new Map();
  for (const doc of candidates) {
    const text = [doc.documentNumber, doc.title, ...doc.versions.map((v) => v.originalName)].join(" ");
    for (const n of idNumbers(text)) {
      if (!index.has(n)) index.set(n, []);
      index.get(n).push(doc);
    }
  }

  const csv = ["process,run,waiting for,last document,last approved,state,possible existing documents"];
  const tally = new Map();
  const samples = [];
  for (const { run, child, last } of items) {
    let state = "nothing found";
    let names = [];
    if (last) {
      const wanted = idNumbers([last.documentNumber, last.title].join(" "));
      const found = new Map();
      for (const n of wanted)
        for (const doc of index.get(n) ?? []) {
          if (doc.documentTypeId !== child.documentTypeId) continue;
          if (child.documentSubtypeId && doc.documentSubtypeId !== child.documentSubtypeId) continue;
          if ((doc.projectId ?? null) !== (run.projectId ?? null)) continue;
          found.set(doc.id, doc);
        }
      const docs = [...found.values()];
      if (docs.length) {
        const unlinked = docs.filter((d) => d.processLinks.length === 0);
        state = unlinked.length ? "EXISTS BUT NOT LINKED to any run" : "exists, linked to another run";
        names = docs.map((d) => `${d.documentNumber}${d.processLinks.length ? "" : " (not linked)"}`);
      }
    } else state = "run has no last document";
    const key = `${child.documentType.code}: ${state}`;
    tally.set(key, (tally.get(key) ?? 0) + 1);
    if (state.startsWith("EXISTS") && samples.length < 15) samples.push(`  ${run.processDefinition.name} | ${run.reference ?? run.id} | waits for ${child.name} | found ${names.slice(0, 3).join(", ")}`);
    const q = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    csv.push([run.processDefinition.name, run.reference ?? run.id, child.name, last?.documentNumber ?? "", last?.approvedAt?.toISOString().slice(0, 10) ?? "", state, names.join("; ")].map(q).join(","));
  }
  console.log("\nIs the document we are waiting for already in the system? (same project, shares a 5+ digit number with the last document)");
  [...tally.entries()].sort().forEach(([k, v]) => console.log(`  ${String(v).padStart(5)}  ${k}`));
  if (samples.length) {
    console.log("\nExamples of documents that exist but are not linked:");
    samples.forEach((s) => console.log(s));
  }

  const file = `awaiting-audit-${new Date().toISOString().slice(0, 10)}.csv`;
  await writeFile(file, csv.join("\n"));
  console.log(`\nFull list written to ${file}`);
  await prisma.$disconnect();
}
