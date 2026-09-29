const { Client } = require('pg');
require('dotenv').config();

async function migrateOtherIds() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  console.log('Starting migration for ats.jobs other ID columns...');

  const columnsToFix = ['primary_recruiter_id', 'recruitment_manager_id', 'created_by'];

  for (const col of columnsToFix) {
    const jobs = await client.query(`
      SELECT id, job_code, ${col} as val
      FROM ats.jobs 
      WHERE deleted_at IS NULL 
      AND ${col} IS NOT NULL 
      AND ${col} != ''
    `);

    let updatedCount = 0;
    for (const job of jobs.rows) {
      const val = job.val;
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(val);
      if (isUuid) continue;

      const resolvedUser = await client.query(`
        SELECT id FROM ats.users 
        WHERE LOWER(email) = LOWER($1) OR LOWER(full_name) = LOWER($1)
        LIMIT 1
      `, [val]);

      if (resolvedUser.rows.length > 0) {
        const uuid = resolvedUser.rows[0].id;
        await client.query(`UPDATE ats.jobs SET ${col} = $1 WHERE id = $2`, [uuid, job.id]);
        console.log(`✅ Job ${job.job_code}: updated ${col} from "${val}" to ${uuid}`);
        updatedCount++;
      } else {
        console.log(`❌ Job ${job.job_code}: Could not resolve ${col} "${val}"`);
      }
    }
    console.log(`Finished ${col}. Updated ${updatedCount} rows.\n`);
  }

  // Check if we can alter types to UUID
  console.log('Testing alter column types to UUID...');
  try {
    await client.query(`
      BEGIN;
      ALTER TABLE ats.jobs ALTER COLUMN account_manager_id TYPE UUID USING account_manager_id::uuid;
      ALTER TABLE ats.jobs ALTER COLUMN primary_recruiter_id TYPE UUID USING primary_recruiter_id::uuid;
      ALTER TABLE ats.jobs ALTER COLUMN recruitment_manager_id TYPE UUID USING recruitment_manager_id::uuid;
      ALTER TABLE ats.jobs ALTER COLUMN created_by TYPE UUID USING created_by::uuid;
      COMMIT;
    `);
    console.log('✅ Alter table types to UUID successful!');
  } catch (err) {
    await client.query('ROLLBACK;');
    console.error('❌ Failed to alter table types:', err.message);
  }

  await client.end();
}

migrateOtherIds().catch(console.error);
