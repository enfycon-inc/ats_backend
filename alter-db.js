const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  try {
    await prisma.$executeRawUnsafe('ALTER TABLE ats.jobs RENAME COLUMN primary_recruiter_id TO recruiter_id;');
    console.log('Renamed primary_recruiter_id to recruiter_id');
  } catch(e) { console.error('Error renaming column:', e.message); }
  
  try {
    await prisma.$executeRawUnsafe('ALTER TABLE ats.jobs DROP COLUMN created_by;');
    console.log('Dropped created_by column from ats.jobs');
  } catch(e) { console.error('Error dropping column:', e.message); }
}

main().catch(console.error).finally(() => prisma.$disconnect());
