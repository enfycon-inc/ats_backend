const { Client } = require('pg');
require('dotenv').config();

async function deepSchemaAudit() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  console.log('--- DEEP SCHEMA AUDIT OF ats.jobs ---');

  // 1. Get all columns in ats.jobs
  const jobsCols = await client.query(`
    SELECT column_name, data_type, character_maximum_length, column_default, is_nullable
    FROM information_schema.columns 
    WHERE table_schema = 'ats' AND table_name = 'jobs'
    ORDER BY ordinal_position
  `);
  
  console.log('\n[1] ALL COLUMNS IN ats.jobs:');
  jobsCols.rows.forEach(r => {
    let type = r.data_type;
    if (r.character_maximum_length) type += `(${r.character_maximum_length})`;
    console.log(`- ${r.column_name}: ${type} (Nullable: ${r.is_nullable}) ${r.column_default ? 'Default: ' + r.column_default : ''}`);
  });

  // 2. Sample data for Business Unit
  const buData = await client.query(`SELECT id, job_code, business_unit, business_unit_id FROM ats.jobs LIMIT 5`);
  console.log('\n[2] BUSINESS UNIT SAMPLE:');
  console.table(buData.rows);

  // 3. Sample data for Approver Role
  const approverData = await client.query(`SELECT id, job_code, assigned_approver_id, assigned_approver_role FROM ats.jobs WHERE assigned_approver_role IS NOT NULL LIMIT 5`);
  console.log('\n[3] APPROVER ROLE SAMPLE:');
  console.table(approverData.rows);

  // 4. Sample data for Working Days & Shift
  const shiftData = await client.query(`SELECT id, job_code, working_days, shift_timing, timing_snapshot_at FROM ats.jobs LIMIT 5`);
  console.log('\n[4] SHIFT & WORKING DAYS SAMPLE:');
  console.table(shiftData.rows);

  // 5. Look for Pod references in jobs
  const podData = await client.query(`
    SELECT column_name 
    FROM information_schema.columns 
    WHERE table_schema = 'ats' AND table_name = 'jobs' AND column_name LIKE '%pod%'
  `);
  console.log('\n[5] POD COLUMNS IN JOBS:');
  console.table(podData.rows);

  // 6. Check existing Foreign Keys on ats.jobs
  const fks = await client.query(`
    SELECT
      tc.constraint_name, kcu.column_name, 
      ccu.table_name AS foreign_table_name,
      ccu.column_name AS foreign_column_name 
    FROM information_schema.table_constraints AS tc 
    JOIN information_schema.key_column_usage AS kcu
      ON tc.constraint_name = kcu.constraint_name
    JOIN information_schema.constraint_column_usage AS ccu
      ON ccu.constraint_name = tc.constraint_name
    WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = 'ats' AND tc.table_name = 'jobs'
  `);
  console.log('\n[6] FOREIGN KEYS ON ats.jobs:');
  console.table(fks.rows);

  await client.end();
}

deepSchemaAudit().catch(console.error);
