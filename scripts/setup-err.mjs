import nextEnv from "@next/env";
import { randomBytes } from "node:crypto";
import { hash } from "bcryptjs";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const { loadEnvConfig } = nextEnv;
loadEnvConfig(process.cwd(), true);

const directors = [
  {
    name: "Rosly Salim",
    email: "rosly.salim@example.com",
    projects: ["ABDALI FARM"],
  },
  {
    name: "Saleh",
    email: "n.hashisho@ahmadiah.com",
    projects: ["GOOGLE"],
  },
  {
    name: "Jabra",
    email: "sami.thabet@ahmadiah.com",
    projects: ["ARZAQ LIGHT INDUST.", "KGOC"],
  },
  {
    name: "Ramez Khalil",
    email: "rkhalil@ahmadiah.com",
    projects: ["Amghara Services Workshop"],
  },
  {
    name: "Hani Omar",
    email: "readymix@ahmadiah.com",
    projects: ["BATCHING PLANT"],
  },
  {
    name: "Abas",
    email: "shirlyaranaha@gmail.com",
    projects: ["BUSINESS DISTRICT"],
  },
  {
    name: "Nabil Azer",
    email: "nabiltadres2021@gmail.com",
    projects: ["SHUIABA LABOR CAMP"],
  },
  {
    name: "Naser Adeeb",
    email: "wissam.abdallah@ahmadiah.com",
    projects: ["KAZMA CAMP - 237"],
  },
  {
    name: "Mohamed Ibrahim",
    email: "m.ibrahim@ahmadiah.com",
    projects: ["FARM (SABAH AL_SALEM)", "Khiran Sports plex"],
  },
  {
    name: "Shabaz",
    email: "shahbaz.husain@ahmadiah.com",
    projects: ["JAHRA STORE", "MINA ABD/STORE"],
  },
];

const accounts = [
  {
    name: "Edmond Houeiss",
    email: "edmond.houeiss@ahmadiah.com",
    permission: "UPLOADER",
    projects: [],
  },
  ...directors.map((director) => ({
    ...director,
    permission: "PROJECT_DIRECTOR",
  })),
  {
    name: "Joseph Gebara",
    email: "joseph.gebara@ahmadiah.com",
    permission: "ACTING_CEO",
    projects: [],
  },
  {
    name: "Elie N. Hani",
    email: "elie.elhani@ahmadiah.com",
    permission: "CEO",
    projects: [],
  },
];

async function main() {
  const connectionString = process.env.DATABASE_URL;

  if (!connectionString) {
    throw new Error("DATABASE_URL is missing.");
  }

  const target = new URL(connectionString);

  if (
    !["localhost", "127.0.0.1"].includes(target.hostname) ||
    target.pathname !== "/pmv_workflow_test"
  ) {
    throw new Error(
      "Stopped: use the local pmv_workflow_test database only.",
    );
  }

  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString }),
  });

  try {
    // Prepare passwords before opening the database transaction.
    const prepared = await Promise.all(
      accounts.map(async (account) => {
        const password =
          "Aa1!" + randomBytes(18).toString("base64url");

        return {
          ...account,
          email: account.email.trim().toLowerCase(),
          password,
          passwordHash: await hash(password, 12),
        };
      }),
    );

    const results = await prisma.$transaction(
      async (tx) => {
        const createdCredentials = [];
        const notices = [];

        for (const account of prepared) {
          // Case-insensitive lookup avoids duplicating mixed-case emails.
          const matches = await tx.user.findMany({
            where: {
              email: {
                equals: account.email,
                mode: "insensitive",
              },
            },
            select: { id: true, email: true },
            take: 2,
          });

          if (matches.length > 1) {
            throw new Error(
              `Multiple accounts match ${account.email}. Resolve this first.`,
            );
          }

          let user = matches[0];

          if (!user) {
            user = await tx.user.create({
              data: {
                name: account.name,
                email: account.email,
                role: "ERR_USER",
                passwordHash: account.passwordHash,
              },
              select: { id: true, email: true },
            });

            createdCredentials.push({
              email: user.email,
              temporaryPassword: account.password,
            });
          } else {
            notices.push(`Reused account: ${user.email}`);
          }

          if (account.projects.length === 0) {
            const access = await tx.errUserAccess.upsert({
              where: {
                userId_role_projectId: {
                  userId: user.id,
                  role: account.permission,
                  projectId: null,
                },
              },
              update: {},
              create: {
                userId: user.id,
                role: account.permission,
                projectId: null,
                isActive: true,
              },
            });

            if (!access.isActive) {
              notices.push(
                `Permission remains inactive: ${user.email} / ${account.permission}`,
              );
            }
          }

          for (const projectName of account.projects) {
            const project = await tx.errProject.upsert({
              where: { name: projectName },
              update: {},
              create: {
                name: projectName,
                directorId: user.id,
                isActive: true,
              },
            });

            const access = await tx.errUserAccess.upsert({
              where: {
                userId_role_projectId: {
                  userId: user.id,
                  role: account.permission,
                  projectId: project.id,
                },
              },
              update: {},
              create: {
                userId: user.id,
                role: account.permission,
                projectId: project.id,
                isActive: true,
              },
            });

            if (!access.isActive) {
              notices.push(
                `Permission remains inactive: ${user.email} / ${account.permission} / ${projectName}`,
              );
            }

            if (
              project.directorId !== user.id ||
              !project.isActive
            ) {
              notices.push(
                `Existing project configuration preserved: ${projectName}`,
              );
            }
          }
        }

        return { createdCredentials, notices };
      },
      { timeout: 30000 },
    );

    console.log("ERR test setup completed.");

    for (const notice of results.notices) {
      console.log(notice);
    }

    if (results.createdCredentials.length > 0) {
      console.log(
        "\nSave these NEW account passwords privately. Do not share this output.",
      );
      console.table(results.createdCredentials);
    } else {
      console.log("No new accounts created. Existing passwords unchanged.");
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  // Avoid printing connection details or generated passwords on failure.
  if (error?.code === "P2002") {
    console.error(
      "Setup stopped because a unique value already exists. No partial setup was committed.",
    );
  } else {
    console.error(
      "Setup failed. Check the test database, generated Prisma client, and account configuration.",
    );
  }

  process.exitCode = 1;
});