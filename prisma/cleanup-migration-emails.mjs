import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

const adapter = new PrismaPg(process.env.DATABASE_URL);
const prisma = new PrismaClient({ adapter });

async function cleanup() {
  try {
    console.log("Searching for @role-migration.local emails...");
    
    const orphanedUsers = await prisma.user.findMany({
      where: {
        email: {
          endsWith: "@role-migration.local",
        },
      },
      select: { id: true, email: true, name: true },
    });

    if (orphanedUsers.length === 0) {
      console.log("✓ No @role-migration.local emails found. Database is clean!");
      return;
    }

    console.log(`Found ${orphanedUsers.length} orphaned user(s):`);
    orphanedUsers.forEach((user) => {
      console.log(`  - ${user.email} (ID: ${user.id})`);
    });

    // Get a valid user to reassign records to
    const validUser = await prisma.user.findUnique({
      where: { email: "aqueel.sayed@ahmadiah.com" },
      select: { id: true },
    });

    if (!validUser) {
      console.error("Error: Could not find aqueel.sayed@ahmadiah.com to reassign records to.");
      process.exit(1);
    }

    console.log(`\nReassigning all orphaned records to ${validUser.id}...`);
    
    // Reassign all records that reference these orphaned users
    const orphanedIds = orphanedUsers.map(u => u.id);
    
    // ApprovalHistory - performedById
    const approvalCount = await prisma.approvalHistory.updateMany({
      where: { performedById: { in: orphanedIds } },
      data: { performedById: validUser.id },
    });
    console.log(`  ✓ Updated ${approvalCount.count} approval history records`);

    // AuditLog - performedById
    const auditCount = await prisma.auditLog.updateMany({
      where: { performedById: { in: orphanedIds } },
      data: { performedById: validUser.id },
    });
    console.log(`  ✓ Updated ${auditCount.count} audit log records`);

    // DocumentVersion - uploadedById
    const versionCount = await prisma.documentVersion.updateMany({
      where: { uploadedById: { in: orphanedIds } },
      data: { uploadedById: validUser.id },
    });
    console.log(`  ✓ Updated ${versionCount.count} document version records`);

    // Document - createdById
    const docCreatedCount = await prisma.document.updateMany({
      where: { createdById: { in: orphanedIds } },
      data: { createdById: validUser.id },
    });
    console.log(`  ✓ Updated ${docCreatedCount.count} document (createdById) records`);

    // Document - currentApproverId
    const docApproverCount = await prisma.document.updateMany({
      where: { currentApproverId: { in: orphanedIds } },
      data: { currentApproverId: validUser.id },
    });
    console.log(`  ✓ Updated ${docApproverCount.count} document (currentApproverId) records`);

    // DeletionRequest - requestedById
    const deletionCount = await prisma.deletionRequest.updateMany({
      where: { requestedById: { in: orphanedIds } },
      data: { requestedById: validUser.id },
    });
    console.log(`  ✓ Updated ${deletionCount.count} deletion request records`);

    // EmailNotificationEvent - recipientId
    const emailCount = await prisma.emailNotificationEvent.updateMany({
      where: { recipientId: { in: orphanedIds } },
      data: { recipientId: validUser.id },
    });
    console.log(`  ✓ Updated ${emailCount.count} email notification records`);

    // Notification - userId
    const notifCount = await prisma.notification.updateMany({
      where: { userId: { in: orphanedIds } },
      data: { userId: validUser.id },
    });
    console.log(`  ✓ Updated ${notifCount.count} notification records`);

    // TrustedDevice - userId
    const deviceCount = await prisma.trustedDevice.updateMany({
      where: { userId: { in: orphanedIds } },
      data: { userId: validUser.id },
    });
    console.log(`  ✓ Updated ${deviceCount.count} trusted device records`);

    // OtpChallenge - userId
    const otpCount = await prisma.otpChallenge.updateMany({
      where: { userId: { in: orphanedIds } },
      data: { userId: validUser.id },
    });
    console.log(`  ✓ Updated ${otpCount.count} OTP challenge records`);

    console.log(`\n✓ All records safely reassigned. Total updates: ${approvalCount.count + auditCount.count + versionCount.count + docCreatedCount.count + docApproverCount.count + deletionCount.count + emailCount.count + notifCount.count + deviceCount.count + otpCount.count}`);

    console.log("\nDeleting orphaned users...");
    const deleted = await prisma.user.deleteMany({
      where: {
        email: {
          endsWith: "@role-migration.local",
        },
      },
    });

    console.log(`✓ Successfully deleted ${deleted.count} orphaned user(s).`);
    console.log("✓ Database cleanup complete. No data loss.");
  } catch (error) {
    console.error("Error during cleanup:", error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

cleanup();
