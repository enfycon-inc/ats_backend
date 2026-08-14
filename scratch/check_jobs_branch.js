const { Client } = require('pg');

async function checkJobsBranch() {
  const dbUrl = process.env.DATABASE_URL || "postgresql://postgres.zqpxnnsbbqdlhememsyj:EWhbqnM6IWe5IJaV@aws-1-ap-northeast-1.pooler.supabase.com:6543/postgres";
  const client = new Client({ connectionString: dbUrl });

  try {
    await client.connect();

    // Query jobs for Deb Technology
    const jobsRes = await client.query(`
      SELECT j.id, j.job_code, j.job_title, j.account_manager_id, j.created_by, j.branch_id, b.name as branch_name, b.code as branch_code
      FROM jobs j
      LEFT JOIN branches b ON j.branch_id = b.id
      WHERE j.tenant_id = 'fad0ccbf-db00-4560-bbfc-216eea7b107b'
      ORDER BY j.created_at DESC
    `);

    console.log(`--- DEB TECHNOLOGY JOBS BRANCH ASSIGNMENT (${jobsRes.rows.length} total jobs) ---`);
    console.table(jobsRes.rows);

  } catch (err) {
    console.error('Error:', err);
  } finally {
    await client.end();
  }
}

checkJobsBranch();
