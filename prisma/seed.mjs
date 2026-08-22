import "dotenv/config";
import bcrypt from "bcryptjs";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, UserRole } from "@prisma/client";

const adapter = new PrismaPg(process.env.DATABASE_URL);
const prisma = new PrismaClient({ adapter });

const users = [
  {
    name: "Clerk User",
    email: "clerk@example.com",
    password: "clerk123",
    role: UserRole.CLERK,
  },
  {
    name: "Miara Kagami",
    email: "miarakagami@gmail.com",
    password: "miara123",
    role: UserRole.APPROVER_1,
  },
  {
    name: "George Azzi",
    email: "george.azzi@example.com",
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
    name: "Marwa Mehielddine",
    email: "marwameheddien2000@gmail.com",
    password: "admin123",
    role: UserRole.ADMIN,
  },
];

async function main() {
  await prisma.user.deleteMany({
    where: { email: "samira_rajab86@yahoo.com" },
  });

  const accountPasswords = {
    [UserRole.APPROVER_1]: "miara123",
    [UserRole.APPROVER_2]: "george123",
    [UserRole.APPROVER_3]: "marc123",
    [UserRole.ADMIN]: "admin123",
  };

  const managedUsers = users.filter((item) => item.role !== UserRole.CLERK);
  const existingManagedUsers = [];
  for (const user of managedUsers) {
    const existing = await prisma.user.findFirst({ where: { role: user.role } });
    if (existing) {
      existingManagedUsers.push({ user, existing });
      await prisma.user.update({
        where: { id: existing.id },
        data: { email: `${existing.id}@role-migration.local` },
      });
    }
  }

  for (const { user, existing } of existingManagedUsers) {
    await prisma.user.update({
      where: { id: existing.id },
      data: {
        name: user.name,
        email: user.email,
        passwordHash: await bcrypt.hash(accountPasswords[user.role], 10),
      },
    });
  }

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
