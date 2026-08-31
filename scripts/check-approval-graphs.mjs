import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const prisma = new PrismaClient({ adapter: new PrismaPg(process.env.DATABASE_URL) });

// Get all GRAPH_UPLOAD_RESULT logs and filter client-side
const allLogs = await prisma.auditLog.findMany({
  where: { action: "GRAPH_UPLOAD_RESULT" },
  orderBy: { createdAt: "desc" },
  take: 20,
  select: { createdAt: true, details: true },
});

const approvalLogs = allLogs.filter((log) => {
  const details = JSON.parse(log.details || "{}");
  return details.context === "DOCUMENT_APPROVAL";
});

console.log("Recent DOCUMENT_APPROVAL Graph uploads:");
approvalLogs.forEach((log) => {
  const details = JSON.parse(log.details || "{}");
  console.log(`\n${log.createdAt}`);
  console.log(`  Status: ${details.status}`);
  console.log(`  Operation: ${details.operation}`);
  if (details.error) {
    console.log(`  ERROR: ${details.error}`);
  } else {
    console.log(`  itemId: ${details.itemId}`);
  }
});
