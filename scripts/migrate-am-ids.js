const { Client } = require('pg');
require('dotenv').config();

async function migrateAccountManagerIds() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  console.log('Starting migration for ats.jobs account_manager_id...');

  const jobs = await client.query(`
    SELECT id, job_code, account_manager_id, created_by 
    FROM ats.jobs 
    WHERE deleted_at IS NULL 
    AND account_manager_id IS NOT NULL 
    AND account_manager_id != ''
  `);

  let updatedCount = 0;

  for (const job of jobs.rows) {
    const amId = job.account_manager_id;
    // Check if it's already a UUID
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(amId);
    if (isUuid) continue;

    // Try to resolve the user
    const resolvedUser = await client.query(`
      SELECT id FROM ats.users 
      WHERE LOWER(email) = LOWER($1) OR LOWER(full_name) = LOWER($1)
      LIMIT 1
    `, [amId]);

    if (resolvedUser.rows.length > 0) {
      const uuid = resolvedUser.rows[0].id;
      await client.query(`UPDATE ats.jobs SET account_manager_id = $1 WHERE id = $2`, [uuid, job.id]);
      console.log(`✅ Job ${job.job_code}: updated account_manager_id from "${amId}" to ${uuid}`);
      updatedCount++;
    } else {
      console.log(`❌ Job ${job.job_code}: Could not resolve account_manager_id "${amId}"`);
    }
  }

  console.log(`\nMigration complete. Updated ${updatedCount} rows.`);
  await client.end();
}

migrateAccountManagerIds().catch(console.error);
