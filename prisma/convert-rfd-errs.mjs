// Switch ERRs that are really RFDs (Request for Diesel) from type PURCHASE to RFD.
//
// Step 1 - dry run (changes nothing). It lists every Purchase ERR and marks the ones
//          whose title, description or file names mention "RFD" or "diesel":
//            node prisma/convert-rfd-errs.mjs
//
// Step 2 - apply to the ERR numbers you confirm:
//            node prisma/convert-rfd-errs.mjs --numbers=ERR-000123,ERR-000124 --apply
//
// Without --apply, step 2 only shows what would change.
// Run "npx prisma migrate deploy" and "npx prisma generate" first so the RFD type exists.

import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

const adapter = new PrismaPg(process.env.DATABASE_URL);
const prisma = new PrismaClient({ adapter });

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const numbersArg = args.find((a) => a.startsWith("--numbers="));
const numbers = numbersArg
  ? [...new Set(numbersArg.slice("--numbers=".length).split(",").map((n) => n.trim()).filter(Boolean))]
  : [];

const RFD_PATTERN = /\bRFD\b|diesel/i;

function looksLikeRfd(err) {
  const texts = [err.title, err.description, err.projectNameSnapshot, ...err.files.map((f) => f.originalName)];
  return texts.some((t) => t && RFD_PATTERN.test(t));
}

function describe(err) {
  const files = err.files.map((f) => f.originalName).join(" | ") || "(no files)";
  return `${err.documentNumber} | ${err.status} | ${err.projectNameSnapshot ?? err.project?.name ?? "-"} | ${err.createdBy?.name ?? "-"} | ${err.createdAt.toISOString().slice(0, 10)} | ${err.title} | files: ${files}`;
}

const include = {
  files: { select: { originalName: true } },
  createdBy: { select: { name: true } },
  project: { select: { name: true } },
};

async function listCandidates() {
  const errs = await prisma.err.findMany({
    where: { type: "PURCHASE" },
    include,
    orderBy: { createdAt: "asc" },
  });

  const likely = errs.filter(looksLikeRfd);
  const others = errs.filter((e) => !looksLikeRfd(e));

  console.log(`Purchase ERRs found: ${errs.length}\n`);
  console.log(`LIKELY RFD (${likely.length}) - mention RFD or diesel:`);
  likely.forEach((e) => console.log("  " + describe(e)));
  console.log(`\nOTHER PURCHASE ERRs (${others.length}) - check these too:`);
  others.forEach((e) => console.log("  " + describe(e)));

  if (likely.length) {
    console.log("\nTo convert the likely ones, check the list, then run:");
    console.log(`  node prisma/convert-rfd-errs.mjs --numbers=${likely.map((e) => e.documentNumber).join(",")} --apply`);
  }
}

async function convert() {
  const errs = await prisma.err.findMany({
    where: { documentNumber: { in: numbers } },
    include,
  });

  const found = new Map(errs.map((e) => [e.documentNumber, e]));
  const missing = numbers.filter((n) => !found.has(n));
  const notPurchase = errs.filter((e) => e.type !== "PURCHASE");

  if (missing.length || notPurchase.length) {
    if (missing.length) console.error(`Not found: ${missing.join(", ")}`);
    notPurchase.forEach((e) => console.error(`Not a Purchase ERR (type ${e.type}): ${e.documentNumber}`));
    console.error("\nNothing was changed. Fix the list and run again.");
    process.exitCode = 1;
    return;
  }

  console.log(`${apply ? "Converting" : "Would convert"} ${errs.length} ERR(s) from PURCHASE to RFD:`);
  errs.forEach((e) => console.log("  " + describe(e)));

  if (!apply) {
    console.log("\nDry run only. Add --apply to save.");
    return;
  }

  // Only the type changes. updatedAt is kept so list ordering does not move.
  const result = await prisma.$transaction(async (tx) => {
    let count = 0;
    for (const e of errs) {
      const updated = await tx.err.updateMany({
        where: { id: e.id, type: "PURCHASE" },
        data: { type: "RFD", updatedAt: e.updatedAt },
      });
      if (updated.count !== 1) throw new Error(`${e.documentNumber} changed while running; rolled back.`);
      count += updated.count;
    }
    return count;
  });

  console.log(`\nDone: ${result} ERR(s) are now RFD.`);
}

try {
  if (numbers.length) await convert();
  else await listCandidates();
} catch (error) {
  console.error("Failed, nothing was changed:", error.message);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
