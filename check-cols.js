const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  try {
    const result = await prisma.$queryRawUnsafe(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_schema = 'ats' AND table_name = 'jobs';
    `);
    console.log(JSON.stringify(result, null, 2));
  } catch(e) {
    console.error(e.message);
  } finally {
    await prisma.$disconnect();
  }
}
main();
