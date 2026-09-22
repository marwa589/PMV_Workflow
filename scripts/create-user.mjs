import "dotenv/config";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import bcrypt from "bcryptjs";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, UserRole, UserLocation } from "@prisma/client";

const adapter = new PrismaPg({
  connectionString: process.env.DATABASE_URL,
});

const prisma = new PrismaClient({ adapter });

const rl = readline.createInterface({ input, output });

async function ask(question) {
  return (await rl.question(question)).trim();
}

async function main() {
  console.log("\n=== Create PMV Workflow User ===\n");

  const name = await ask("Name: ");
  const email = await ask("Email: ");
  const password = await ask("Password: ");

  console.log("\nAvailable roles:");
  Object.values(UserRole).forEach((role, index) => {
    console.log(`${index + 1}. ${role}`);
  });

  const roleNumber = Number(await ask("Select role number: "));
  const roles = Object.values(UserRole);
  const role = roles[roleNumber - 1];

  if (!role) {
    throw new Error("Invalid role selection.");
  }

  console.log("\nAvailable locations:");
  console.log("0. None");

  Object.values(UserLocation).forEach((location, index) => {
    console.log(`${index + 1}. ${location}`);
  });

  const locationNumber = Number(await ask("Select location number: "));

  let location = null;

  if (locationNumber !== 0) {
    const locations = Object.values(UserLocation);
    location = locations[locationNumber - 1];

    if (!location) {
      throw new Error("Invalid location selection.");
    }
  }

  const existingUser = await prisma.user.findUnique({
    where: { email },
  });

  if (existingUser) {
    throw new Error(`A user with the email "${email}" already exists.`);
  }

  const passwordHash = await bcrypt.hash(password, 12);

  const user = await prisma.user.create({
    data: {
      name,
      email,
      passwordHash,
      role,
      location,
    },
  });

  console.log("\nUser created successfully.");
  console.log("--------------------------------");
  console.log(`ID:       ${user.id}`);
  console.log(`Name:     ${user.name}`);
  console.log(`Email:    ${user.email}`);
  console.log(`Role:     ${user.role}`);
  console.log(`Location: ${user.location ?? "None"}`);
  console.log("--------------------------------\n");
}

main()
  .catch((error) => {
    console.error("\nFailed to create user:");
    console.error(error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    rl.close();
    await prisma.$disconnect();
  });