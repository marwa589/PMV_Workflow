// Puts process runs back on track that were marked COMPLETED although their last node still has next steps under it
// (for example: MR approved, run completed, then the PO was attached as "added later" and the run never moved).
//
//   node prisma/reopen-completed-runs.mjs                       -> DRY RUN: lists what it would change, changes nothing
//   node prisma/reopen-completed-runs.mjs --apply               -> makes the changes (one transaction per run)
//   node prisma/reopen-completed-runs.mjs --only 214469         -> only runs whose reference contains this text
//
// For every such run:
//   1. the run is reopened (IN_PROGRESS, no completion date);
//   2. a document that was attached "added later" at the next step becomes that step's normal document;
//   3. the run then moves forward exactly like an approval would: when that document is approved the run stands at
//      that step and now waits for the step after it (a step with nothing after it completes the run).
// Runs with nothing attached yet are simply reopened and wait for the next document (they show under My Tasks).
// If several documents were "added later" at the same step, the first one becomes the step's document and the others
// stay "added later" (listed in the report). No notifications or e-mails are sent. Safe to run more than once.
import nextEnv from "@next/env";
import { writeFile } from "node:fs/promises";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

//#region plan
// Pure planning: given a run and its links, the list of changes to make. No database access.
export function planRepair(run) {
  const links = run.stepDocuments.map((link) => ({ ...link }));
  const actions = [{ type: "reopen" }];
  const notes = [];
  let currentStepId = run.currentStepId;
  let currentStepNumber = run.currentStepNumber;
  let status = "IN_PROGRESS";
  const alive = (link) => link.isCurrent && link.document.status !== "CANCELLED" && link.document.status !== "ARCHIVED";

  for (let guard = 0; guard < 50; guard += 1) {
    const atNext = (link) => alive(link) && link.processStep.parentStepId === currentStepId;

    // 2. A document attached "added later" at the next step becomes the step's real document.
    if (!links.some((link) => atNext(link) && !link.isAddition)) {
      const additions = links.filter((link) => atNext(link) && link.isAddition).sort((a, b) => new Date(a.linkedAt) - new Date(b.linkedAt));
      if (additions.length > 0) {
        const chosen = additions[0];
        chosen.isAddition = false;
        actions.push({ type: "convert", linkId: chosen.id, text: `${chosen.document.documentNumber} becomes the real document of "${chosen.processStep.name}"` });
        for (const other of additions.slice(1)) notes.push(`${other.document.documentNumber} stays "added later" (the step already has ${chosen.document.documentNumber})`);
      }
    }

    // 3. The document at the next step is approved: the run moves on to that step.
    const approved = links.find((link) => atNext(link) && !link.isAddition && link.document.status === "APPROVED");
    if (!approved) break;
    const isEnd = approved.processStep._count.childSteps === 0;
    currentStepId = approved.processStep.id;
    currentStepNumber = approved.processStep.stepNumber;
    actions.push({
      type: "advance",
      stepId: currentStepId,
      stepNumber: currentStepNumber,
      isEnd,
      completedAt: approved.document.approvedAt ?? null,
      text: `moves to "${approved.processStep.name}"${isEnd ? " and completes (nothing after it)" : ""}`,
    });
    if (isEnd) {
      status = "COMPLETED";
      break;
    }
  }
  return { actions, notes, finalStatus: status, finalStepId: currentStepId };
}
//#endregion

const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].split(/[\\/]/).pop());
if (isMain) {
  nextEnv.loadEnvConfig(process.cwd(), true);
  const apply = process.argv.includes("--apply");
  const onlyIndex = process.argv.indexOf("--only");
  const only = onlyIndex > -1 ? process.argv[onlyIndex + 1] : null;
  const prisma = new PrismaClient({ adapter: new PrismaPg(process.env.DATABASE_URL) });

  const runSelect = {
    id: true,
    reference: true,
    currentStepId: true,
    currentStepNumber: true,
    parentInstanceId: true,
    processDefinition: { select: { name: true } },
    currentStep: { select: { name: true } },
    stepDocuments: {
      select: {
        id: true,
        isCurrent: true,
        isAddition: true,
        linkedAt: true,
        processStep: { select: { id: true, name: true, parentStepId: true, stepNumber: true, _count: { select: { childSteps: true } } } },
        document: { select: { documentNumber: true, status: true, approvedAt: true } },
      },
    },
  };
  const candidateWhere = {
    status: "COMPLETED",
    currentStepId: { not: null },
    currentStep: { childSteps: { some: {} } },
    ...(only ? { reference: { contains: only, mode: "insensitive" } } : {}),
  };

  const runs = await prisma.processInstance.findMany({ where: candidateWhere, select: runSelect, orderBy: { completedAt: "asc" } });
  console.log(`${apply ? "APPLY" : "DRY RUN"}: ${runs.length} completed run(s) that still have steps left under their last node.\n`);

  const report = [];
  let reopened = 0;
  for (const run of runs) {
    const plan = planRepair(run);
    const label = `${run.processDefinition.name} | ${run.reference ?? run.id}${run.parentInstanceId ? " (follow-up run)" : ""} | was completed at "${run.currentStep?.name}"`;
    const steps = plan.actions.filter((a) => a.text).map((a) => a.text);
    const summary = `${steps.length ? steps.join("; ") : "reopened, waiting for the next document"}${plan.notes.length ? ` [${plan.notes.join("; ")}]` : ""}`;

    if (!apply) {
      console.log(`WOULD FIX  ${label}\n           ${summary}`);
      report.push(`would fix | ${label} | ${summary}`);
      continue;
    }
    try {
      await prisma.$transaction(
        async (tx) => {
          await tx.$queryRaw`SELECT 1 FROM "ProcessInstance" WHERE "id" = ${run.id} FOR UPDATE`;
          // Re-read inside the lock: only repair a run that is still in the broken state.
          const fresh = await tx.processInstance.findFirst({ where: { id: run.id, ...candidateWhere }, select: runSelect });
          if (!fresh) return;
          for (const action of planRepair(fresh).actions) {
            if (action.type === "reopen") await tx.processInstance.update({ where: { id: run.id }, data: { status: "IN_PROGRESS", completedAt: null } });
            if (action.type === "convert") await tx.processStepDocument.update({ where: { id: action.linkId }, data: { isAddition: false } });
            if (action.type === "advance") {
              await tx.processInstance.update({
                where: { id: run.id },
                data: {
                  currentStepId: action.stepId,
                  currentStepNumber: action.stepNumber,
                  ...(action.isEnd ? { status: "COMPLETED", completedAt: action.completedAt ?? new Date() } : {}),
                },
              });
            }
          }
        },
        { timeout: 30_000 },
      );
      reopened += 1;
      console.log(`FIXED      ${label}\n           ${summary}`);
      report.push(`fixed | ${label} | ${summary}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.log(`FAILED     ${label}\n           ${message}`);
      report.push(`FAILED | ${label} | ${message}`);
    }
  }

  if (apply) {
    const left = await prisma.processInstance.count({ where: candidateWhere });
    console.log(`\nFixed ${reopened} run(s). Still in the broken state: ${left}`);
    const file = `reopen-completed-runs-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.txt`;
    await writeFile(file, report.join("\n"));
    console.log(`Report written to ${file}`);
  } else {
    console.log("\nNothing was changed. Run again with --apply to fix them (back up the database first).");
  }
  await prisma.$disconnect();
}
