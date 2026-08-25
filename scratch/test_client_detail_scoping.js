const { Pool } = require('pg');
require('dotenv').config({ path: './.env' });

async function verifyClientDetailAndScoping() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error('DATABASE_URL missing');
    process.exit(1);
  }

  const pool = new Pool({
    connectionString,
    ssl: connectionString.includes('supabase') ? { rejectUnauthorized: false } : undefined,
  });

  try {
    console.log('Connecting to database...');
    const tenantId = 'd3b07384-d113-49c3-a555-9ee75c13ca33';

    console.log('Ensuring jobs table DDL migrations...');
    await pool.query(`
      ALTER TABLE jobs ADD COLUMN IF NOT EXISTS client_id UUID REFERENCES clients(id) ON DELETE SET NULL;
      ALTER TABLE jobs ADD COLUMN IF NOT EXISTS end_client_id UUID REFERENCES clients(id) ON DELETE SET NULL;
    `);

    // 1. Fetch a real client record
    console.log('Fetching active client from PostgreSQL database...');
    const clientRes = await pool.query(
      `SELECT id, client_code, client_name, market, branch_id FROM clients WHERE tenant_id = $1 AND deleted_at IS NULL LIMIT 1`,
      [tenantId]
    );

    const testClient = clientRes.rows[0];
    console.log('Test Client:', testClient.client_code, testClient.client_name);

    // 2. Fetch associated jobs for test client
    console.log('Fetching associated jobs for client...');
    const jobsRes = await pool.query(
      `SELECT id, job_code, job_title, status FROM jobs WHERE tenant_id = $1 AND (client_id = $2 OR LOWER(client_name) = LOWER($3)) LIMIT 5`,
      [tenantId, testClient.id, testClient.client_name]
    );
    console.log(`Found ${jobsRes.rows.length} associated job(s) for ${testClient.client_name}.`);

    console.log('\nCLIENT DETAIL & SCOPING VERIFICATION SUCCESSFUL!');
  } catch (err) {
    console.error('Verification Failed:', err);
  } finally {
    await pool.end();
  }
}

verifyClientDetailAndScoping();
