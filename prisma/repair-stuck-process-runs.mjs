// Finds process runs that did not move forward although the document waiting at their next node is already approved,
// and puts them back on track (the same move the approval would have made).
//
//   node prisma/repair-stuck-process-runs.mjs            -> DRY RUN: only lists what it would change
//   node prisma/repair-stuck-process-runs.mjs --apply    -> makes the changes (one transaction per run)
//
// A run is "stuck" when it is IN_PROGRESS and a current document sits at one of the choices under its last approved
// node (for a new run: at the root) while that document is APPROVED. Such a run should already have moved on.
// Rules used for the move are exactly the ones of advanceProcessesForApprovedDocument():
//   currentStepId := that node, currentStepNumber := its number; a node without children completes the run.
// No notifications / e-mails are sent. People still find the next upload under My Tasks.
// Safe to run more than once. Also lists (never changes) other suspicious runs it noticed.
import nextEnv from "@next/env";
import { writeFile } from "node:fs/promises";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

nextEnv.loadEnvConfig(process.cwd(), true);
const apply = process.argv.includes("--apply");
const prisma = new PrismaClient({ adapter: new PrismaPg(process.env.DATABASE_URL) });

const runSelect = {
  id: true,
  reference: true,
  status: true,
  currentStepId: true,
  parentInstanceId: true,
  processDefinition: { select: { name: true } },
  stepDocuments: {
    where: { isCurrent: true },
    select: {
      documentId: true,
      processStep: { select: { id: true, name: true, parentStepId: true, stepNumber: true, _count: { select: { childSteps: true } } } },
      document: { select: { documentNumber: true, status: true, approvedAt: true } },
    },
  },
};

// The approved document waiting at the run's next node, if there is one.
function stuckLink(run) {
  return run.stepDocuments.find((link) => link.processStep.parentStepId === run.currentStepId && link.document.status === "APPROVED") ?? null;
}

async function findStuck() {
  const runs = await prisma.processInstance.findMany({ where: { status: "IN_PROGRESS" }, select: runSelect, orderBy: { startedAt: "asc" } });
  return runs.filter((run) => stuckLink(run));
}

async function repairRun(runId) {
  const steps = [];
  await prisma.$transaction(
    async (tx) => {
      for (let guard = 0; guard < 50; guard += 1) {
        await tx.$queryRaw`SELECT 1 FROM "ProcessInstance" WHERE "id" = ${runId} FOR UPDATE`;
        const run = await tx.processInstance.findUnique({ where: { id: runId }, select: runSelect });
        if (!run || run.status !== "IN_PROGRESS") return;
        const link = stuckLink(run);
        if (!link) return;
        const isEnd = link.processStep._count.childSteps === 0;
        await tx.processInstance.update({
          where: { id: runId },
          data: {
            currentStepId: link.processStep.id,
            currentStepNumber: link.processStep.stepNumber,
            ...(isEnd ? { status: "COMPLETED", completedAt: link.document.approvedAt ?? new Date() } : {}),
          },
        });
        steps.push(`${link.document.documentNumber} -> "${link.processStep.name}"${isEnd ? " (run completed)" : ""}`);
      }
    },
    { timeout: 30_000 },
  );
  return steps;
}

async function reportOther() {
  // A rejected / archived document that still counts as the run's current document blocks the next upload.
  const blocked = await prisma.processStepDocument.findMany({
    where: { isCurrent: true, isAddition: false, processInstance: { status: "IN_PROGRESS" }, document: { status: { in: ["CANCELLED"] } }, processStep: { parentStepId: { not: null } } },
    select: { processInstance: { select: { id: true, reference: true } }, document: { select: { documentNumber: true } } },
  });
  return blocked.map((row) => `run ${row.processInstance.reference ?? row.processInstance.id}: rejected document ${row.document.documentNumber} is still marked as the current one`);
}

const stuck = await findStuck();
console.log(`${apply ? "APPLY" : "DRY RUN"}: ${stuck.length} stuck run(s) found.\n`);
const report = [];
for (const run of stuck) {
  const link = stuckLink(run);
  const line = `${run.processDefinition.name} | run ${run.reference ?? run.id}${run.parentInstanceId ? " (follow-up run)" : ""} | waiting document ${link.document.documentNumber} (approved) at "${link.processStep.name}"`;
  if (!apply) {
    console.log(`WOULD FIX  ${line}`);
    report.push(`would fix | ${line}`);
    continue;
  }
  try {
    const moves = await repairRun(run.id);
    console.log(`FIXED      ${line}\n           ${moves.join("; ")}`);
    report.push(`fixed | ${line} | ${moves.join("; ")}`);
  } catch (error) {
    console.log(`FAILED     ${line}\n           ${error instanceof Error ? error.message : error}`);
    report.push(`FAILED | ${line} | ${error instanceof Error ? error.message : error}`);
  }
}

const others = await reportOther();
if (others.length) {
  console.log(`\nAlso noticed (not changed, please look at these):`);
  others.forEach((line) => console.log(`  ${line}`));
}

const left = apply ? (await findStuck()).length : stuck.length;
console.log(`\n${apply ? `Still stuck after the repair: ${left}` : "Nothing was changed. Run again with --apply to fix them."}`);
if (apply) {
  const file = `stuck-runs-repair-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.txt`;
  await writeFile(file, [...report, ...others].join("\n"));
  console.log(`Report written to ${file}`);
}
await prisma.$disconnect();
