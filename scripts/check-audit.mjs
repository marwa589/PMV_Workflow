import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const prisma = new PrismaClient({ adapter: new PrismaPg(process.env.DATABASE_URL) });

const recentLogs = await prisma.auditLog.findMany({
  where: { action: "GRAPH_UPLOAD_RESULT" },
  orderBy: { createdAt: "desc" },
  take: 10,
});

console.log("Recent GRAPH_UPLOAD_RESULT events:");
recentLogs.forEach((log, i) => {
  const details = JSON.parse(log.details || "{}");
  console.log(`\n${i + 1}. ${log.createdAt} - ${details.status}`);
  console.log(`   Context: ${details.context}`);
  console.log(`   Operation: ${details.operation || "unknown"}`);
  if (details.error) {
    console.log(`   ERROR: ${details.error}`);
  } else {
    console.log(`   itemId: ${details.itemId}`);
    console.log(`   webUrl: ${details.webUrl}`);
  }
});

await prisma.$disconnect();
