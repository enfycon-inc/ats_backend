const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
async function main() {
  const columns = await prisma.$queryRawUnsafe(`
    SELECT column_name, data_type 
    FROM information_schema.columns 
    WHERE table_schema = 'ats' AND table_name = 'jobs'
  `);
  console.log(columns);
  
  const rawJob = await prisma.$queryRawUnsafe(`
    SELECT assigned_to, recruiter_id FROM ats.jobs WHERE id = '639aaf25-6a6d-4107-9c54-582456d03296'
  `);
  console.log('Raw Job:', rawJob);
}
main().catch(console.error).finally(() => prisma.$disconnect());
