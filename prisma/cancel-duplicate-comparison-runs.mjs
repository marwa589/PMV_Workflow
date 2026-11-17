// Cancels comparison runs that are still waiting for an MR although their MRs already went on in runs of their own.
//   node prisma/cancel-duplicate-comparison-runs.mjs COM-SP-2026-0412 209227            -> DRY RUN (shows the checks)
//   node prisma/cancel-duplicate-comparison-runs.mjs COM-SP-2026-0412 209227 --apply     -> cancels them
// Pass the run names (the "reference" shown on the run). Only the runs you name are touched. Documents are not changed.
import nextEnv from "@next/env";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

nextEnv.loadEnvConfig(process.cwd(), true);
const apply = process.argv.includes("--apply");
const references = process.argv.slice(2).filter((arg) => !arg.startsWith("--"));
if (references.length === 0) {
  console.log("Usage: node prisma/cancel-duplicate-comparison-runs.mjs <run name> [<run name> ...] [--apply]");
  process.exit(1);
}
const prisma = new PrismaClient({ adapter: new PrismaPg(process.env.DATABASE_URL) });
const idNumbers = (text) => [...new Set((String(text ?? "").match(/\d{5,}/g) ?? []).filter((n) => !/^20\d{2}$/.test(n)))];

const runSelect = {
  id: true, reference: true, status: true, projectId: true, currentStepId: true,
  processDefinition: { select: { name: true } },
  currentStep: { select: { id: true, name: true, childSteps: { select: { id: true, name: true, documentTypeId: true, documentSubtypeId: true } } } },
  stepDocuments: { where: { isCurrent: true }, select: { processStep: { select: { id: true, name: true, parentStepId: true } }, document: { select: { id: true, documentNumber: true, title: true } } } },
};

let cancelled = 0;
for (const reference of references) {
  const found = await prisma.processInstance.findMany({ where: { reference, status: "IN_PROGRESS" }, select: runSelect });
  console.log(`\n=== ${reference} ===`);
  if (found.length !== 1) {
    console.log(found.length === 0 ? "SKIPPED: no run in progress with this name." : `SKIPPED: ${found.length} runs in progress share this name; cancel it by hand.`);
    continue;
  }
  const run = found[0];
  const last = run.stepDocuments.find((l) => l.processStep.id === run.currentStepId)?.document;
  console.log(`${run.processDefinition.name} | stands after "${run.currentStep?.name}" = ${last?.documentNumber} "${last?.title}"`);

  const problems = [];
  if (!run.currentStep || run.currentStep.childSteps.length === 0) problems.push("the run is not waiting for a next document");
  if (run.stepDocuments.some((l) => l.processStep.parentStepId === run.currentStepId)) problems.push("a next document is already in progress in this run");

  // The MRs that belong to this comparison (they share its number) and where they sit now.
  const matches = [];
  for (const child of run.currentStep?.childSteps ?? []) {
    const wanted = idNumbers(`${last?.documentNumber} ${last?.title}`);
    if (!wanted.length) continue;
    const docs = await prisma.document.findMany({
      where: {
        documentTypeId: child.documentTypeId,
        ...(child.documentSubtypeId ? { documentSubtypeId: child.documentSubtypeId } : {}),
        projectId: run.projectId, isReference: false, status: { notIn: ["CANCELLED", "ARCHIVED"] },
        OR: wanted.flatMap((n) => [{ documentNumber: { contains: n } }, { title: { contains: n } }, { versions: { some: { originalName: { contains: n } } } }]),
      },
      select: {
        documentNumber: true, title: true,
        processLinks: { where: { isCurrent: true, processInstance: { status: { not: "CANCELLED" } } }, select: { processInstance: { select: { id: true, reference: true, status: true, stepDocuments: { where: { isCurrent: true, processStep: { parentStepId: null } }, select: { document: { select: { documentNumber: true } } } } } } } },
      },
    });
    matches.push(...docs);
  }
  if (matches.length === 0) problems.push("no MR of this comparison was found, so it is not clear it was replaced");
  for (const doc of matches) {
    const own = doc.processLinks.map((l) => l.processInstance).filter((r) => r.id !== run.id);
    console.log(`  MR ${doc.documentNumber} "${doc.title}" -> ${own.length ? own.map((r) => `run ${r.reference} (${r.status}, starts with ${r.stepDocuments.map((s) => s.document.documentNumber).join("/") || "?"})`).join("; ") : "NOT in any other run"}`);
    if (own.length === 0) problems.push(`MR ${doc.documentNumber} is not in a run of its own`);
  }

  if (problems.length) {
    console.log(`SKIPPED: ${problems.join("; ")}.`);
    continue;
  }
  if (!apply) {
    console.log("WOULD CANCEL this run (dry run).");
    continue;
  }
  const result = await prisma.processInstance.updateMany({ where: { id: run.id, status: "IN_PROGRESS" }, data: { status: "CANCELLED", completedAt: new Date() } });
  cancelled += result.count;
  console.log(result.count ? "CANCELLED." : "Nothing to cancel (it changed in the meantime).");
}
console.log(apply ? `\nCancelled ${cancelled} run(s).` : "\nNothing was changed. Add --apply to cancel the runs that passed the checks.");
await prisma.$disconnect();
