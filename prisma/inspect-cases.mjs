// READ-ONLY. Shows the cases the audit flagged: waiting runs whose next document already exists in the system.
//   node prisma/inspect-cases.mjs
import nextEnv from "@next/env";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

nextEnv.loadEnvConfig(process.cwd(), true);
const prisma = new PrismaClient({ adapter: new PrismaPg(process.env.DATABASE_URL) });
const idNumbers = (text) => [...new Set((String(text ?? "").match(/\d{5,}/g) ?? []).filter((n) => !/^20\d{2}$/.test(n)))];
const date = (d) => (d ? d.toISOString().slice(0, 10) : "-");

const runs = await prisma.processInstance.findMany({
  where: { status: "IN_PROGRESS", currentStepId: { not: null }, currentStep: { childSteps: { some: {} } } },
  select: {
    id: true, reference: true, projectId: true, parentInstanceId: true,
    project: { select: { code: true } },
    processDefinition: { select: { name: true } },
    currentStep: { select: { id: true, name: true, childSteps: { select: { id: true, name: true, documentTypeId: true, documentSubtypeId: true } } } },
    stepDocuments: { where: { isCurrent: true }, select: { processStep: { select: { id: true, parentStepId: true } }, document: { select: { id: true, documentNumber: true, title: true, approvedAt: true } } } },
  },
});

const cases = [];
for (const run of runs) {
  if (run.stepDocuments.some((l) => l.processStep.parentStepId === run.currentStep.id)) continue;
  const last = run.stepDocuments.find((l) => l.processStep.id === run.currentStep.id)?.document;
  if (!last) continue;
  const wanted = idNumbers(`${last.documentNumber} ${last.title}`);
  if (!wanted.length) continue;
  for (const child of run.currentStep.childSteps) {
    const docs = await prisma.document.findMany({
      where: {
        documentTypeId: child.documentTypeId,
        ...(child.documentSubtypeId ? { documentSubtypeId: child.documentSubtypeId } : {}),
        projectId: run.projectId,
        isReference: false,
        status: { notIn: ["CANCELLED", "ARCHIVED"] },
        OR: wanted.flatMap((n) => [{ documentNumber: { contains: n } }, { title: { contains: n } }, { versions: { some: { originalName: { contains: n } } } }]),
      },
      select: {
        id: true, documentNumber: true, title: true, status: true, approvedAt: true, createdAt: true,
        versions: { select: { originalName: true }, take: 3 },
        processLinks: { where: { isCurrent: true, processInstance: { status: { not: "CANCELLED" } } }, select: { isAddition: true, processStep: { select: { name: true } }, processInstance: { select: { reference: true, status: true, processDefinition: { select: { name: true } } } } } },
      },
    });
    if (docs.length) cases.push({ run, child, last, docs });
  }
}

console.log(`Waiting runs whose next document seems to exist already: ${cases.length}\n`);
for (const { run, child, last, docs } of cases) {
  console.log(`RUN ${run.reference ?? run.id} | ${run.processDefinition.name} | project ${run.project?.code ?? "-"}${run.parentInstanceId ? " | follow-up run" : ""}`);
  console.log(`  stands after: ${run.currentStep.name} = ${last.documentNumber} "${last.title}" (approved ${date(last.approvedAt)})`);
  console.log(`  waiting for : ${child.name}`);
  for (const d of docs) {
    console.log(`  FOUND       : ${d.documentNumber} "${d.title}" | ${d.status} | approved ${date(d.approvedAt)} | file: ${d.versions.map((v) => v.originalName).join(", ")}`);
    if (d.processLinks.length === 0) console.log("                not linked to any run");
    for (const l of d.processLinks) console.log(`                linked to run ${l.processInstance.reference ?? "?"} (${l.processInstance.processDefinition.name}, ${l.processInstance.status}) as "${l.processStep.name}"${l.isAddition ? " [added later]" : ""}`);
  }
  console.log("");
}
await prisma.$disconnect();
