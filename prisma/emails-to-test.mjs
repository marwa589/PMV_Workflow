// Points every non-Admin user's email at one Gmail inbox, using Gmail "+" addressing:
//   Abas  ->  marwameheddien2000+abas@gmail.com
//
//   node prisma/emails-to-test.mjs            -> DRY RUN: lists old -> new for every user, changes nothing
//   node prisma/emails-to-test.mjs --apply    -> saves the original emails to prisma/email-backup.json, then changes them
//
// The tag after "+" is the user's full name, lowercased, with spaces and other characters removed (only a-z and 0-9 kept).
// If nothing is left (e.g. a name written only in Arabic), the part of the current email before "@" is used instead.
// Two users that end up with the same tag get -2, -3 ... added.
// Admin users (user type code "admin") are left unchanged.
//
// To undo: node prisma/emails-restore.mjs --apply
// The script refuses to run --apply while prisma/email-backup.json exists, so the original emails can never be overwritten
// by running it twice. Restore first (it renames the backup), or move the file away yourself.
import fs from "node:fs";
import path from "node:path";
import nextEnv from "@next/env";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const INBOX_USER = "marwameheddien2000";
const INBOX_DOMAIN = "gmail.com";

nextEnv.loadEnvConfig(process.cwd(), true);
const apply = process.argv.includes("--apply");
const backupPath = path.join(process.cwd(), "prisma", "email-backup.json");
const prisma = new PrismaClient({ adapter: new PrismaPg(process.env.DATABASE_URL) });

try {
  if (apply && fs.existsSync(backupPath)) {
    console.error(`Stopped: ${backupPath} already exists, so the emails were probably changed already.`);
    console.error("Run node prisma/emails-restore.mjs --apply first, or move that file away if you are sure.");
    process.exitCode = 1;
  } else {
    const users = await prisma.user.findMany({
      select: { id: true, name: true, email: true, userType: { select: { code: true } } },
      orderBy: { name: "asc" },
    });
    const admins = users.filter((u) => u.userType.code === "admin");
    const targets = users.filter((u) => u.userType.code !== "admin");

    const taken = new Set(admins.map((u) => u.email.toLowerCase()));
    const changes = [];
    for (const user of targets) {
      let tag = user.name.toLowerCase().replace(/[^a-z0-9]/g, "");
      if (!tag) tag = user.email.split("@")[0].toLowerCase().split("+")[0].replace(/[^a-z0-9]/g, "") || "user";
      let email = `${INBOX_USER}+${tag}@${INBOX_DOMAIN}`;
      for (let n = 2; taken.has(email); n += 1) email = `${INBOX_USER}+${tag}-${n}@${INBOX_DOMAIN}`;
      taken.add(email);
      changes.push({ id: user.id, name: user.name, oldEmail: user.email, newEmail: email });
    }

    console.log(`${changes.length} user(s) to change, ${admins.length} Admin user(s) left as they are.\n`);
    for (const c of changes) console.log(`  ${c.name}: ${c.oldEmail}  ->  ${c.newEmail}`);
    if (admins.length) {
      console.log("\nSkipped (Admin):");
      for (const a of admins) console.log(`  ${a.name}: ${a.email}`);
    }

    if (!apply) {
      console.log("\nDRY RUN - nothing changed. Run again with --apply to change the emails.");
    } else if (changes.length) {
      // Write the backup BEFORE touching the database, so the originals are on disk even if the update fails.
      fs.writeFileSync(backupPath, JSON.stringify({ createdAt: new Date().toISOString(), users: changes }, null, 2));
      // Two steps inside one transaction so a new address can never clash with another user's old one mid-way
      // (email is unique).
      await prisma.$transaction([
        ...changes.map((c) => prisma.user.update({ where: { id: c.id }, data: { email: `tmp-${c.id}@email-swap.invalid` } })),
        ...changes.map((c) => prisma.user.update({ where: { id: c.id }, data: { email: c.newEmail } })),
      ]);
      console.log(`\nDone: ${changes.length} email(s) changed. Originals saved to ${backupPath}`);
      console.log("Keep that file - node prisma/emails-restore.mjs --apply needs it to put them back.");
    }
  }
} finally {
  await prisma.$disconnect();
}
