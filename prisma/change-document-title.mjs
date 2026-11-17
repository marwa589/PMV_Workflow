// Change a document's title (title only - MR number, files and status are not touched).
//
// Dry run (changes nothing):
//   node prisma/change-document-title.mjs --doc=MR-CR-2026-2672 --from=MR217889 --title=MR214889
//
// Apply:
//   node prisma/change-document-title.mjs --doc=MR-CR-2026-2672 --from=MR217889 --title=MR214889 --apply
//
// --from is a safety check: nothing changes unless the current title matches it exactly.

import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

const adapter = new PrismaPg(process.env.DATABASE_URL);
const prisma = new PrismaClient({ adapter });

const args = process.argv.slice(2);
const getArg = (name) => args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3).trim();
const apply = args.includes("--apply");
const docNumber = getArg("doc");
const fromTitle = getArg("from");
const newTitle = getArg("title");

async function main() {
  if (!docNumber || !fromTitle || !newTitle) {
    console.error('Usage: node prisma/change-document-title.mjs --doc=<document number> --from=<current title> --title=<new title> [--apply]');
    process.exitCode = 1;
    return;
  }

  const doc = await prisma.document.findUnique({
    where: { documentNumber: docNumber },
    select: { id: true, documentNumber: true, title: true, mrNumber: true, status: true, documentType: true, mrType: true, projectName: true, updatedAt: true, createdBy: { select: { name: true } } },
  });

  if (!doc) {
    const similar = await prisma.document.findMany({
      where: { OR: [{ documentNumber: { contains: docNumber.split("-").pop() } }, { title: { contains: fromTitle.replace(/^MR\s*/i, "") } }] },
      select: { documentNumber: true, title: true, mrNumber: true, status: true },
      take: 10,
    });
    console.error(`${docNumber} was not found. Nothing was changed.`);
    if (similar.length) {
      console.error("Possible matches:");
      similar.forEach((d) => console.error(`  ${d.documentNumber} | ${d.title} | MR ${d.mrNumber ?? "-"} | ${d.status}`));
    }
    process.exitCode = 1;
    return;
  }

  console.log(`${doc.documentNumber} | ${doc.documentType}${doc.mrType ? " " + doc.mrType : ""} | MR number ${doc.mrNumber ?? "-"} | ${doc.status} | project ${doc.projectName ?? "-"} | uploaded by ${doc.createdBy?.name ?? "-"}`);
  console.log(`Title: "${doc.title}" -> "${newTitle}"`);

  if (doc.title !== fromTitle) {
    console.error(`\nThe current title is "${doc.title}", not "${fromTitle}". Nothing was changed.`);
    process.exitCode = 1;
    return;
  }
  if (doc.title === newTitle) {
    console.log("Title is already correct. Nothing to change.");
    return;
  }

  if (!apply) {
    console.log("\nDry run only. Add --apply to save.");
    return;
  }

  const updated = await prisma.document.updateMany({
    where: { id: doc.id, title: fromTitle },
    data: { title: newTitle, updatedAt: doc.updatedAt }, // keep list ordering as it was
  });
  if (updated.count !== 1) throw new Error("The document changed while running.");

  console.log(`\nDone: ${doc.documentNumber} is now titled "${newTitle}".`);
}

try {
  await main();
} catch (error) {
  console.error("Failed, nothing was changed:", error.message);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
