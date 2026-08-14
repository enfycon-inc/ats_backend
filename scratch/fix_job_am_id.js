require('dotenv').config();
const { Client } = require('pg');

async function fixJobAccountManagers() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL
  });
  await client.connect();

  console.log('=== FIXING ACCOUNT MANAGER IDS IN JOBS TABLE ===');

  // Update jobs where account_manager_id matches user full_name or email
  const updateRes = await client.query(`
    UPDATE jobs j
    SET account_manager_id = u.id::text
    FROM users u
    WHERE (LOWER(j.account_manager_id) = LOWER(u.full_name) OR LOWER(j.account_manager_id) = LOWER(u.email))
      AND j.account_manager_id != u.id::text
  `);
  console.log(`Updated ${updateRes.rowCount} jobs where account_manager_id was string name/email to user UUID.`);

  // Update jobs where account_manager_id is null or empty but created_by is set
  const updateCreatedRes = await client.query(`
    UPDATE jobs j
    SET account_manager_id = u.id::text
    FROM users u
    WHERE (j.account_manager_id IS NULL OR j.account_manager_id = '' OR j.account_manager_id = 'N/A')
      AND (j.created_by = u.id::text OR LOWER(j.created_by) = LOWER(u.email) OR LOWER(j.created_by) = LOWER(u.full_name))
  `);
  console.log(`Updated ${updateCreatedRes.rowCount} jobs where account_manager_id was empty to creator user UUID.`);

  // Verify BBS-260814-D0001
  const checkRes = await client.query(`
    SELECT j.job_code, j.job_title, j.account_manager_id, u.full_name as am_name, u.email as am_email
    FROM jobs j
    LEFT JOIN users u ON j.account_manager_id = u.id::text
    WHERE j.job_code = 'BBS-260814-D0001'
  `);
  console.log('\nVerified Job BBS-260814-D0001:', JSON.stringify(checkRes.rows, null, 2));

  await client.end();
}

fixJobAccountManagers();
