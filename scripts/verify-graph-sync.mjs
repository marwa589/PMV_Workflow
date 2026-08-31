#!/usr/bin/env node
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const prisma = new PrismaClient({
  adapter: new PrismaPg(process.env.DATABASE_URL),
});

async function main() {
  console.log("🔍 Graph Sync Verification Report\n");

  // 1. Check for versions with complete metadata
  const syncedVersions = await prisma.documentVersion.findMany({
    where: {
      driveId: { not: null },
      itemId: { not: null },
      webUrl: { not: null },
      graphUploadedAt: { not: null },
    },
    select: {
      id: true,
      documentId: true,
      versionNumber: true,
      filePath: true,
      driveId: true,
      itemId: true,
      webUrl: true,
      graphUploadedAt: true,
      uploadedAt: true,
    },
    orderBy: { graphUploadedAt: "desc" },
    take: 10,
  });

  console.log(`✅ Recently Synced Versions (last 10):`);
  if (syncedVersions.length === 0) {
    console.log("   No synced versions found.");
  } else {
    syncedVersions.forEach((v) => {
      console.log(`   - Doc ${v.documentId} v${v.versionNumber}`);
      console.log(`     Synced: ${v.graphUploadedAt.toISOString()}`);
      console.log(`     ItemId: ${v.itemId.substring(0, 20)}...`);
      console.log(`     DriveId: ${v.driveId.substring(0, 20)}...`);
    });
  }

  // 2. Check for versions without metadata
  const unsyncedVersions = await prisma.documentVersion.findMany({
    where: {
      OR: [
        { driveId: null },
        { itemId: null },
        { webUrl: null },
        { graphUploadedAt: null },
      ],
    },
    select: {
      id: true,
      documentId: true,
      versionNumber: true,
      filePath: true,
      driveId: true,
      itemId: true,
      webUrl: true,
      graphUploadedAt: true,
      uploadedAt: true,
    },
    orderBy: { uploadedAt: "desc" },
    take: 10,
  });

  console.log(`\n⚠️  Unsynced or Partial Versions (last 10):`);
  if (unsyncedVersions.length === 0) {
    console.log("   All versions are fully synced!");
  } else {
    unsyncedVersions.forEach((v) => {
      console.log(`   - Doc ${v.documentId} v${v.versionNumber}`);
      console.log(`     Uploaded: ${v.uploadedAt.toISOString()}`);
      console.log(`     driveId: ${v.driveId ? "✓" : "✗"}`);
      console.log(`     itemId: ${v.itemId ? "✓" : "✗"}`);
      console.log(`     webUrl: ${v.webUrl ? "✓" : "✗"}`);
      console.log(`     graphUploadedAt: ${v.graphUploadedAt ? "✓" : "✗"}`);
    });
  }

  // 3. Check recent Graph audit events
  const graphAudits = await prisma.auditLog.findMany({
    where: {
      action: { in: ["GRAPH_UPLOAD_RESULT", "GRAPH_DELETE_RESULT"] },
    },
    select: {
      id: true,
      action: true,
      details: true,
      createdAt: true,
    },
    orderBy: { createdAt: "desc" },
    take: 10,
  });

  console.log(`\n📋 Recent Graph Audit Events (last 10):`);
  graphAudits.forEach((audit) => {
    try {
      const details = JSON.parse(audit.details || "{}");
      const status = details.status || "unknown";
      const statusEmoji = status === "success" ? "✅" : "❌";
      console.log(
        `   ${statusEmoji} ${audit.action} (${audit.createdAt.toISOString()})`
      );
      console.log(`      Context: ${details.context || "—"}`);
      if (details.error) console.log(`      Error: ${details.error}`);
    } catch {
      console.log(`   ❓ ${audit.action} (${audit.createdAt.toISOString()})`);
    }
  });

  // 4. Summary stats
  const totalVersions = await prisma.documentVersion.count();
  const syncedCount = await prisma.documentVersion.count({
    where: {
      driveId: { not: null },
      itemId: { not: null },
      webUrl: { not: null },
      graphUploadedAt: { not: null },
    },
  });

  const syncPercentage = totalVersions > 0 ? ((syncedCount / totalVersions) * 100).toFixed(1) : 0;

  console.log(`\n📊 Summary:`);
  console.log(`   Total Versions: ${totalVersions}`);
  console.log(`   Synced to Graph: ${syncedCount}`);
  console.log(`   Sync Rate: ${syncPercentage}%`);

  console.log("\n✨ Verification complete!\n");
}

main()
  .catch((e) => {
    console.error("Error:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
