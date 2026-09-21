require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');
const bcrypt = require('bcryptjs');

const adapter = new PrismaPg(process.env.DATABASE_URL);
const prisma = new PrismaClient({ adapter });

(async () => {
  const email = 'marwameheddien2000@gmail.com';
  const input = 'Admin123!';
  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, email: true, name: true, role: true, location: true, passwordHash: true },
  });

  console.log('USER', JSON.stringify(user, null, 2));
  console.log('MATCH', user ? await bcrypt.compare(input, user.passwordHash) : false);
  await prisma.$disconnect();
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
