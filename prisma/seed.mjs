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
    name: "Marwa Meheddien",
    email: "marwameheddien@gmail.com",
    password: "marwa123",
    role: UserRole.APPROVER_1,
  },
  {
    name: "Samira Rajab",
    email: "samira_rajab86@yahoo.com",
    password: "samira123",
    role: UserRole.APPROVER_2,
  },
  {
    name: "Miara Kagami",
    email: "miarakagami@gmail.com",
    password: "miara123",
    role: UserRole.APPROVER_3,
  },
  {
    name: "Admin User",
    email: "admin@example.com",
    password: "admin123",
    role: UserRole.ADMIN,
  },
];

async function main() {
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
