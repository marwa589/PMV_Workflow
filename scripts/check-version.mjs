import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const prisma = new PrismaClient({ adapter: new PrismaPg(process.env.DATABASE_URL) });

// Find the most recent document version
const recentVersion = await prisma.documentVersion.findFirst({
  orderBy: { uploadedAt: "desc" },
  select: {
    id: true,
    versionNumber: true,
    filePath: true,
    originalName: true,
    driveId: true,
    itemId: true,
    webUrl: true,
    graphUploadedAt: true,
    uploadedAt: true,
    document: {
      select: {
        documentNumber: true,
      },
    },
  },
});

console.log("Most recent document version:");
console.log(JSON.stringify(recentVersion, null, 2));

if (recentVersion) {
  // Check audit logs for this version
  const logs = await prisma.auditLog.findMany({
    where: {
      documentId: recentVersion.document?.documentNumber ? { contains: "" } : undefined,
      action: "GRAPH_UPLOAD_RESULT",
    },
    orderBy: { createdAt: "desc" },
    take: 3,
    select: { createdAt: true, action: true, details: true },
  });

  console.log("\nRecent GRAPH_UPLOAD_RESULT audit logs for this document:");
  logs.forEach((log) => {
    const details = JSON.parse(log.details || "{}");
    console.log(`- ${log.createdAt}: ${details.status} - ${details.fileName}`);
  });
}

await prisma.$disconnect();
