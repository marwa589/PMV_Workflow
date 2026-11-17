// READ-ONLY. Shows every process run a document belongs to, the tree that run follows, and where the run stands.
//   node prisma/diagnose-run.mjs 214469
// (the argument is part of a document number or title). Also lists completed runs that still have choices left.
import nextEnv from "@next/env";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

nextEnv.loadEnvConfig(process.cwd(), true);
const prisma = new PrismaClient({ adapter: new PrismaPg(process.env.DATABASE_URL) });
const search = process.argv[2];
if (!search) {
  console.log("Usage: node prisma/diagnose-run.mjs <part of a document number or title>");
  process.exit(1);
}

const code = (s) => `${s.documentType.code}${s.documentSubtype ? "-" + s.documentSubtype.code : ""}`;
const stepSelect = { id: true, name: true, stepNumber: true, parentStepId: true, versionNumber: true, allowMultipleUploads: true, documentType: { select: { code: true } }, documentSubtype: { select: { code: true } } };

const docs = await prisma.document.findMany({
  where: { OR: [{ documentNumber: { contains: search, mode: "insensitive" } }, { title: { contains: search, mode: "insensitive" } }] },
  select: { id: true, documentNumber: true, title: true, status: true, approvedAt: true, processLinks: { select: { processInstanceId: true } } },
  take: 30,
});
console.log(`Documents matching "${search}": ${docs.length}`);
docs.forEach((d) => console.log(`  ${d.documentNumber} | ${d.title} | ${d.status} | in ${d.processLinks.length} run link(s)`));

const runIds = [...new Set(docs.flatMap((d) => d.processLinks.map((l) => l.processInstanceId)))];
for (const runId of runIds) {
  const run = await prisma.processInstance.findUnique({
    where: { id: runId },
    select: {
      id: true, reference: true, status: true, stepVersion: true, startedAt: true, completedAt: true, parentInstanceId: true,
      followedDocument: { select: { documentNumber: true } },
      processDefinition: { select: { name: true, currentVersion: true, steps: { select: stepSelect } } },
      currentStep: { select: stepSelect },
      stepDocuments: {
        orderBy: { linkedAt: "asc" },
        select: { isCurrent: true, isAddition: true, linkedAt: true, processStep: { select: { id: true, name: true } }, document: { select: { documentNumber: true, status: true, approvedAt: true } } },
      },
    },
  });
  if (!run) continue;
  const tree = run.processDefinition.steps.filter((s) => s.versionNumber === run.stepVersion);
  console.log(`\n==== RUN ${run.reference ?? run.id} | ${run.processDefinition.name} | status ${run.status} ====`);
  console.log(`follows tree version ${run.stepVersion} (process is now on version ${run.processDefinition.currentVersion})${run.stepVersion !== run.processDefinition.currentVersion ? "  <-- process was edited after this run started" : ""}`);
  console.log(`started ${run.startedAt.toISOString()}  completed ${run.completedAt?.toISOString() ?? "-"}  ${run.parentInstanceId ? `follow-up run of ${run.followedDocument?.documentNumber}` : "ordinary run"}`);
  console.log(`last approved node: ${run.currentStep ? `${run.currentStep.name} (${code(run.currentStep)})` : "none"}`);
  console.log("Tree this run follows:");
  const print = (parentId, depth) => {
    for (const s of tree.filter((x) => x.parentStepId === parentId).sort((a, b) => a.stepNumber - b.stepNumber)) {
      const here = run.stepDocuments.filter((l) => l.processStep.id === s.id);
      const mark = s.id === run.currentStep?.id ? "  <== run stands here" : "";
      const held = here.length ? here.map((l) => `${l.document.documentNumber} [${l.document.status}${l.isCurrent ? "" : ", not current"}${l.isAddition ? ", ADDED LATER" : ""}]`).join(", ") : "-";
      console.log(`${"  ".repeat(depth + 1)}${s.stepNumber}. ${s.name} (${code(s)})${s.allowMultipleUploads ? " [multi]" : ""}: ${held}${mark}`);
      print(s.id, depth + 1);
    }
  };
  print(null, 0);
  const children = run.currentStep ? tree.filter((s) => s.parentStepId === run.currentStep.id) : [];
  if (run.status === "COMPLETED" && children.length) console.log(`!! COMPLETED although "${run.currentStep.name}" has ${children.length} choice(s) under it in this tree: ${children.map((c) => c.name).join(", ")}`);
}

// Completed runs whose last node still has choices under it (these should not have been completed).
const completed = await prisma.processInstance.findMany({
  where: { status: "COMPLETED", currentStepId: { not: null }, currentStep: { childSteps: { some: {} } } },
  select: { id: true, reference: true, completedAt: true, processDefinition: { select: { name: true } }, currentStep: { select: { name: true } } },
  orderBy: { completedAt: "desc" },
  take: 50,
});
console.log(`\nCompleted runs whose last node still has choices under it: ${completed.length}${completed.length === 50 ? " (first 50)" : ""}`);
completed.forEach((r) => console.log(`  ${r.processDefinition.name} | ${r.reference ?? r.id} | ended at "${r.currentStep.name}" | ${r.completedAt?.toISOString().slice(0, 10)}`));
await prisma.$disconnect();
