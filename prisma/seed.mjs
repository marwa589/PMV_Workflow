import "dotenv/config";
import bcrypt from "bcryptjs";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, UserRole } from "@prisma/client";

const adapter = new PrismaPg(process.env.DATABASE_URL);
const prisma = new PrismaClient({ adapter });

const users = [
  {
    name: "Aqueel Sayed",
    email: "aqueel.sayed@ahmadiah.com",
    password: "aqueel123",
    role: UserRole.CLERK,
  },
  {
    name: "Omar Merzek",
    email: "omar.merzek@ahmadiah.com",
    password: "omar123",
    role: UserRole.CLERK,
  },
  {
    name: "Mohammad Mehieddine",
    email: "mohammad.mehieddine@example.com",
    password: "mohammad123",
    role: UserRole.APPROVER_1,
  },
  {
    name: "George Azzi",
    email: "george.azzi@ahmadiah.com",
    password: "george123",
    role: UserRole.APPROVER_2,
  },
  {
    name: "Marc Baddour",
    email: "marc.baddour@ahmadiah.com",
    password: "marc123",
    role: UserRole.APPROVER_3,
  },
  {
    name: "Mohamed Mahmoud",
    email: "mohamed.mahmoud@ahmadiah.com",
    password: "mohamed123",
    role: UserRole.CLERK,
  },
  {
    name: "Mohamed Shawky",
    email: "mohamed.shawky@ahmadiah.com",
    password: "shawky123",
    role: UserRole.CLERK,
  },
  {
    name: "Marwa Mehielddine",
    email: "marwa.mehieddine@ahmadiah.com",
    password: process.env.SEED_ADMIN_PASSWORD,
    role: UserRole.ADMIN,
  },
  {
    name: "Ahmad Mero",
    email: "ahmad.mero@ahmadiah.com",
    password: "ahmadmero123",
    role: UserRole.ADMIN,
  },
];

async function main() {
  const accountPasswords = {
    [UserRole.APPROVER_1]: "miara123",
    [UserRole.APPROVER_2]: "george123",
    [UserRole.APPROVER_3]: "marc123",
    [UserRole.ADMIN]: "admin123",
  };

  for (const user of users) {
    const passwordHash = await bcrypt.hash(user.password, 10);

    await prisma.user.upsert({
      where: { email: user.email },
      update: {
        name: user.name,
        role: user.role,
        passwordHash,
      },
      create: {
        name: user.name,
        email: user.email,
        role: user.role,
        passwordHash,
      },
    });
  }

  const oldClerk = await prisma.user.findUnique({ where: { email: "clerk@example.com" }, select: { id: true } });
  const aqueel = await prisma.user.findUnique({ where: { email: "aqueel.sayed@ahmadiah.com" }, select: { id: true } });
  if (oldClerk && aqueel) {
    await prisma.$transaction(async (tx) => {
      await tx.document.updateMany({ where: { createdById: oldClerk.id }, data: { createdById: aqueel.id } });
      await tx.documentVersion.updateMany({ where: { uploadedById: oldClerk.id }, data: { uploadedById: aqueel.id } });
      await tx.approvalHistory.updateMany({ where: { performedById: oldClerk.id }, data: { performedById: aqueel.id } });
      await tx.deletionRequest.updateMany({ where: { requestedById: oldClerk.id }, data: { requestedById: aqueel.id } });
      await tx.notification.updateMany({ where: { userId: oldClerk.id }, data: { userId: aqueel.id } });
      await tx.emailNotificationEvent.updateMany({ where: { recipientId: oldClerk.id }, data: { recipientId: aqueel.id } });
      await tx.auditLog.updateMany({ where: { performedById: oldClerk.id }, data: { performedById: aqueel.id } });
      await tx.trustedDevice.updateMany({ where: { userId: oldClerk.id }, data: { userId: aqueel.id } });
      await tx.otpChallenge.updateMany({ where: { userId: oldClerk.id }, data: { userId: aqueel.id } });
      await tx.user.delete({ where: { id: oldClerk.id } });
    });
  }

  console.log(`Seeded ${users.length} users.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });