// Puts back the original emails saved by prisma/emails-to-test.mjs (from prisma/email-backup.json).
//
//   node prisma/emails-restore.mjs            -> DRY RUN: lists what would be restored, changes nothing
//   node prisma/emails-restore.mjs --apply    -> restores the emails, then renames the backup to
//                                                email-backup.restored-<date>.json (kept, not deleted)
//
// A user is only restored if their email is still the test address the script gave them. If someone changed it by hand
// since then, that user is skipped and listed, so a newer real address is not overwritten. Add --force to restore those too.
// Users deleted since the change are skipped. If the original address now belongs to another user, that user is skipped.
import fs from "node:fs";
import path from "node:path";
import nextEnv from "@next/env";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

nextEnv.loadEnvConfig(process.cwd(), true);
const apply = process.argv.includes("--apply");
const force = process.argv.includes("--force");
const backupPath = path.join(process.cwd(), "prisma", "email-backup.json");

if (!fs.existsSync(backupPath)) {
  console.error(`No backup found at ${backupPath} - nothing to restore.`);
  process.exit(1);
}
const backup = JSON.parse(fs.readFileSync(backupPath, "utf8"));
const prisma = new PrismaClient({ adapter: new PrismaPg(process.env.DATABASE_URL) });

try {
  const current = new Map(
    (await prisma.user.findMany({ select: { id: true, name: true, email: true } })).map((u) => [u.id, u]),
  );
  const restoring = new Set(backup.users.map((b) => b.id));
  const emailOwner = new Map([...current.values()].map((u) => [u.email.toLowerCase(), u.id]));

  const restore = [];
  const skipped = [];
  for (const b of backup.users) {
    const user = current.get(b.id);
    if (!user) { skipped.push(`${b.name}: user no longer exists`); continue; }
    if (user.email === b.oldEmail) { skipped.push(`${b.name}: already ${b.oldEmail}`); continue; }
    if (user.email !== b.newEmail && !force) {
      skipped.push(`${b.name}: email is now ${user.email} (changed since), use --force to restore ${b.oldEmail}`);
      continue;
    }
    const owner = emailOwner.get(b.oldEmail.toLowerCase());
    if (owner && owner !== b.id && !restoring.has(owner)) {
      skipped.push(`${b.name}: ${b.oldEmail} now belongs to another user (${current.get(owner).name})`);
      continue;
    }
    restore.push({ id: b.id, name: b.name, from: user.email, to: b.oldEmail });
  }

  console.log(`Backup from ${backup.createdAt}: ${restore.length} to restore, ${skipped.length} skipped.\n`);
  for (const r of restore) console.log(`  ${r.name}: ${r.from}  ->  ${r.to}`);
  if (skipped.length) {
    console.log("\nSkipped:");
    for (const s of skipped) console.log(`  ${s}`);
  }

  if (!apply) {
    console.log("\nDRY RUN - nothing changed. Run again with --apply to restore.");
  } else {
    if (restore.length) {
      await prisma.$transaction([
        ...restore.map((r) => prisma.user.update({ where: { id: r.id }, data: { email: `tmp-${r.id}@email-swap.invalid` } })),
        ...restore.map((r) => prisma.user.update({ where: { id: r.id }, data: { email: r.to } })),
      ]);
    }
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const kept = path.join(process.cwd(), "prisma", `email-backup.restored-${stamp}.json`);
    fs.renameSync(backupPath, kept);
    console.log(`\nDone: ${restore.length} email(s) restored. Backup kept as ${kept}`);
  }
} finally {
  await prisma.$disconnect();
}
