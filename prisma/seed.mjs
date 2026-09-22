// import "dotenv/config";
// import bcrypt from "bcryptjs";
// import { PrismaPg } from "@prisma/adapter-pg";
// import { PrismaClient, UserRole, ErrAccessRole } from "@prisma/client";

// const adapter = new PrismaPg(process.env.DATABASE_URL);
// const prisma = new PrismaClient({ adapter });

// const users = [
//   {
//     name: "Aqueel Sayed",
//     email: "aqueel.sayed@ahmadiah.com",
//     password: "aqueel123",
//     role: UserRole.CLERK,
//   },
//   {
//     name: "Omar Merzek",
//     email: "omar.merzek@ahmadiah.com",
//     password: "omar123",
//     role: UserRole.CLERK,
//   },
//   {
//     name: "Mohammad Mehieddine",
//     email: "mohammad.mehieddine@ahmadiah.com",
//     password: "mohammad123",
//     role: UserRole.APPROVER_1,
//   },
//   {
//     name: "George Azzi",
//     email: "george.azzi@ahmadiah.com",
//     password: "george123",
//     role: UserRole.APPROVER_2,
//   },
//   {
//     name: "Marc Baddour",
//     email: "marc.baddour@ahmadiah.com",
//     password: "marc123",
//     role: UserRole.APPROVER_3,
//   },
//   {
//     name: "Mohamed Mahmoud",
//     email: "mohamed.mahmoud@ahmadiah.com",
//     password: "mohamed123",
//     role: UserRole.CLERK,
//   },
//   {
//     name: "Mohamed Shawky",
//     email: "mohamed.shawky@ahmadiah.com",
//     password: "shawky123",
//     role: UserRole.CLERK,
//   },
//   {
//     name: "Marwa Mehielddine",
//     email: "marwameheddien2000@gmail.com",
//     password: process.env.SEED_ADMIN_PASSWORD,
//     role: UserRole.ADMIN,
//   },
//   {
//     name: "Reine Al Souki",
//     email: "reine.alsouki@ahmadiah.com",
//     password: process.env.SEED_ERR_UPLOADER_PASSWORD || "ReineErr123!",
//     role: UserRole.ERR_USER,
//     errAccess: [ErrAccessRole.UPLOADER],
//   },
//   {
//     name: "Jad Kabalan",
//     email: "jad.kabalan@ahmadiah.com",
//     password: "jad123",
//     role: UserRole.CLERK,
//   },
// ];

// async function main() {
//   // await prisma.user.deleteMany({
//   //   where: { email: "samira_rajab86@yahoo.com" },
//   // });

//   for (const user of users) {
//   const existingUser = await prisma.user.findUnique({
//     where: { email: user.email },
//     select: { id: true },
//   });

//   if (typeof user.password !== "string" || !user.password) {
//     throw new Error(`Missing initial password for ${user.email}`);
//   }

//   const passwordHash = await bcrypt.hash(user.password, 12);

//   if (existingUser) {
//     console.log(`Skipped existing user: ${user.email}`);

//     if (user.errAccess?.length) {
//       const userRecord = await prisma.user.findUnique({
//         where: { email: user.email },
//         select: { id: true },
//       });

//       if (userRecord) {
//         for (const role of user.errAccess) {
//           await prisma.errUserAccess.upsert({
//             where: {
//               userId_role_projectId: {
//                 userId: userRecord.id,
//                 role,
//                 projectId: null,
//               },
//             },
//             update: { isActive: true },
//             create: {
//               userId: userRecord.id,
//               role,
//               projectId: null,
//               isActive: true,
//             },
//           });
//         }
//       }
//     }

//     continue;
//   }

//   const createdUser = await prisma.user.create({
//     data: {
//       name: user.name,
//       email: user.email,
//       role: user.role,
//       passwordHash,
//     },
//   });

//   if (user.errAccess?.length) {
//     await prisma.errUserAccess.createMany({
//       data: user.errAccess.map((role) => ({
//         userId: createdUser.id,
//         role,
//         projectId: null,
//         isActive: true,
//       })),
//     });
//   }

//   console.log(`Ensured account exists: ${user.email}`);
// }

//   console.log("Seed complete. Existing accounts were left unchanged.");
// }

// main()
//   .catch((error) => {
//     console.error(error);
//     process.exit(1);
//   })
//   .finally(async () => {
//     await prisma.$disconnect();
//   });