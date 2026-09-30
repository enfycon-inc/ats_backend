const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  try {
    await prisma.$executeRawUnsafe(`
      ALTER TABLE ats.jobs 
      DROP COLUMN IF EXISTS assigned_approver_role,
      DROP COLUMN IF EXISTS business_unit,
      DROP COLUMN IF EXISTS assigned_to,
      DROP COLUMN IF EXISTS work_start_time,
      DROP COLUMN IF EXISTS work_end_time,
      DROP COLUMN IF EXISTS working_days,
      DROP COLUMN IF EXISTS timing_snapshot_at;
    `);
    console.log('Successfully dropped columns from ats.jobs');
  } catch(e) {
    console.error('Error dropping columns:', e.message);
  } finally {
    await prisma.$disconnect();
  }
}

main();
