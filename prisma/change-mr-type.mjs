// Change an MR between Cash and Credit.
//
// Dry run (changes nothing) - shows the MR, its files, invoices, POs and anything that blocks the change:
//   node prisma/change-mr-type.mjs --doc=DOC-4202 --to=CREDIT
//
// Apply (database only, files stay where they are):
//   node prisma/change-mr-type.mjs --doc=DOC-4202 --to=CREDIT --apply
//
// Apply and also move the files from "MRs Cash" to "MRs Credit" (or the other way):
//   node prisma/change-mr-type.mjs --doc=DOC-4202 --to=CREDIT --move-files --apply

import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { existsSync } from "node:fs";
import { mkdir, rename } from "node:fs/promises";
import path from "node:path";

const adapter = new PrismaPg(process.env.DATABASE_URL);
const prisma = new PrismaClient({ adapter });

const args = process.argv.slice(2);
const getArg = (name) => args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3).trim();
const apply = args.includes("--apply");
const moveFiles = args.includes("--move-files");
const docNumber = getArg("doc");
const target = getArg("to")?.toUpperCase();

const FOLDER = { CASH: "MRs Cash", CREDIT: "MRs Credit" };

function swapFolder(relativePath, from, to) {
  if (!relativePath) return relativePath;
  const parts = relativePath.replaceAll("\\", "/").split("/");
  const index = parts.indexOf(FOLDER[from]);
  if (index === -1) return null;
  parts[index] = FOLDER[to];
  return parts.join("/");
}

function absolute(root, relativePath) {
  return path.resolve(root, ...relativePath.replaceAll("\\", "/").split("/"));
}

async function main() {
  if (!docNumber || !["CASH", "CREDIT"].includes(target)) {
    console.error("Usage: node prisma/change-mr-type.mjs --doc=DOC-4202 --to=CREDIT|CASH [--move-files] [--apply]");
    process.exitCode = 1;
    return;
  }

  const doc = await prisma.document.findUnique({
    where: { documentNumber: docNumber },
    include: {
      createdBy: { select: { name: true, email: true } },
      workflowTemplate: { select: { name: true, documentSubtype: true } },
      versions: { orderBy: { versionNumber: "asc" } },
      invoices: { select: { id: true, originalName: true } },
      purchaseOrderLinks: { include: { purchaseOrder: { select: { poNumber: true } } } },
    },
  });

  if (!doc) {
    console.error(`${docNumber} was not found. Nothing was changed.`);
    process.exitCode = 1;
    return;
  }

  const from = doc.mrType;
  const blockers = [];
  const warnings = [];

  if (doc.documentType !== "MATERIAL_REQUISITION") blockers.push(`${docNumber} is a ${doc.documentType}, not an MR.`);
  if (from === target) blockers.push(`${docNumber} is already ${target}.`);
  if (!from) warnings.push("The MR has no Cash/Credit type set yet; it will be set to " + target + ".");

  // Cash MRs get invoices attached directly; Credit MRs get them through a PO.
  if (target === "CREDIT" && doc.invoices.length) {
    blockers.push(`It has ${doc.invoices.length} invoice(s) attached directly (Cash style): ${doc.invoices.map((i) => i.originalName).join(", ")}. They would be hidden on a Credit MR. Remove or move them first.`);
  }
  if (target === "CASH" && doc.purchaseOrderLinks.length) {
    blockers.push(`It is linked to PO(s) ${doc.purchaseOrderLinks.map((l) => l.purchaseOrder?.poNumber ?? "?").join(", ")}. Cash MRs do not have POs. Unlink them first.`);
  }

  // A pending MR whose approval flow was picked for the old type might need a different flow.
  const pending = !["APPROVED", "REJECTED"].includes(doc.status);
  if (pending && doc.workflowTemplate?.documentSubtype && doc.workflowTemplate.documentSubtype === from) {
    blockers.push(`It is still ${doc.status} on the "${doc.workflowTemplate.name}" flow, which is set up for ${from} MRs only. Finish or reject it first, or ask for the flow to be switched too.`);
  } else if (pending) {
    warnings.push(`It is still ${doc.status}; it keeps its current approvers.`);
  }

  // File moves.
  const moves = [];
  if (moveFiles && from) {
    const root = process.env.UPLOAD_PATH?.trim();
    if (!root) blockers.push("UPLOAD_PATH is not set in .env, so files cannot be moved.");
    for (const v of doc.versions) {
      const newPath = swapFolder(v.filePath, from, target);
      if (!newPath) {
        warnings.push(`v${v.versionNumber} is not inside a "${FOLDER[from]}" folder, left where it is: ${v.filePath}`);
        continue;
      }
      const move = { version: v, newPath, newFolder: swapFolder(v.storageFolder, from, target) ?? v.storageFolder };
      if (root) {
        move.src = absolute(root, v.filePath);
        move.dest = absolute(root, newPath);
        if (!existsSync(move.src)) blockers.push(`File missing on disk for v${v.versionNumber}: ${move.src}`);
        if (existsSync(move.dest)) blockers.push(`A file already exists at the target for v${v.versionNumber}: ${move.dest}`);
      }
      moves.push(move);
    }
  }

  console.log(`${docNumber} | ${doc.title} | MR ${doc.mrNumber ?? "-"} | ${doc.status} | project ${doc.projectName ?? "-"} | uploaded by ${doc.createdBy?.name ?? "-"}`);
  console.log(`Type: ${from ?? "(none)"} -> ${target}`);
  console.log(`Approval flow: ${doc.workflowTemplate?.name ?? "(built-in)"}`);
  console.log(`POs linked: ${doc.purchaseOrderLinks.length} | invoices attached directly: ${doc.invoices.length}`);
  console.log("Files:");
  doc.versions.forEach((v) => console.log(`  v${v.versionNumber}: ${v.filePath}`));
  if (moves.length) {
    console.log("Files to move:");
    moves.forEach((m) => console.log(`  v${m.version.versionNumber}: ${m.version.filePath}\n      -> ${m.newPath}`));
  } else if (!moveFiles) {
    console.log("Files stay where they are (add --move-files to move them).");
  }
  if (target === "CREDIT") console.log('After the change the MR will show PO status "Pending" until a PO is linked.');
  warnings.forEach((w) => console.log("Note: " + w));

  if (blockers.length) {
    console.error("\nCannot change it:");
    blockers.forEach((b) => console.error("  - " + b));
    console.error("Nothing was changed.");
    process.exitCode = 1;
    return;
  }

  if (!apply) {
    console.log("\nDry run only. Add --apply to save.");
    return;
  }

  // Move files on disk first, so the database is only updated if every move worked.
  const done = [];
  try {
    for (const m of moves) {
      await mkdir(path.dirname(m.dest), { recursive: true });
      await rename(m.src, m.dest);
      done.push(m);
    }

    await prisma.$transaction(async (tx) => {
      for (const m of moves) {
        await tx.documentVersion.update({
          where: { id: m.version.id },
          data: { filePath: m.newPath, storageFolder: m.newFolder },
        });
      }
      const subtypeIsType = !doc.documentSubtype || doc.documentSubtype === from;
      await tx.document.update({
        where: { id: doc.id },
        data: {
          mrType: target,
          ...(subtypeIsType ? { documentSubtype: target } : {}),
          updatedAt: doc.updatedAt, // keep list ordering as it was
        },
      });
    });
  } catch (error) {
    // Put any moved files back.
    for (const m of done.reverse()) {
      try { await rename(m.dest, m.src); } catch { console.error(`Could not move back: ${m.dest}`); }
    }
    throw error;
  }

  console.log(`\nDone: ${docNumber} is now MR ${target === "CREDIT" ? "Credit" : "Cash"}${moves.length ? ` and ${moves.length} file(s) were moved` : ""}.`);
}

try {
  await main();
} catch (error) {
  console.error("Failed, nothing was changed:", error.message);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
