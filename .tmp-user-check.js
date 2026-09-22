require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');

const adapter = new PrismaPg(process.env.DATABASE_URL);
const prisma = new PrismaClient({ adapter });

(async () => {
  const columns = await prisma.$queryRawUnsafe(`
    SELECT column_name, data_type, is_nullable
    FROM information_schema.columns
    WHERE table_name = 'User'
    ORDER BY ordinal_position;
  `);

  console.log('USER_COLUMNS', JSON.stringify(columns, null, 2));

  const rows = await prisma.user.findMany({
    select: { id: true, email: true, name: true, role: true, location: true, projectName: true },
  });
  console.log('USER_ROWS', JSON.stringify(rows, null, 2));

  await prisma.$disconnect();
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
