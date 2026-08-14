const { Client } = require('pg');

async function testDebamUser() {
  const dbUrl = process.env.DATABASE_URL || "postgresql://postgres.zqpxnnsbbqdlhememsyj:EWhbqnM6IWe5IJaV@aws-1-ap-northeast-1.pooler.supabase.com:6543/postgres";
  const client = new Client({ connectionString: dbUrl });

  try {
    await client.connect();

    // 1. Inspect user debam@deb.com in users table
    const userRes = await client.query(`
      SELECT u.id, u.tenant_id, u.email, u.full_name, u.role_id, u.branch_id, u.is_active, u.password_hash,
             t.name as tenant_name, t.domain as tenant_domain,
             r.system_role,
             b.name as branch_name, b.code as branch_code
      FROM users u
      LEFT JOIN tenants t ON u.tenant_id = t.id
      LEFT JOIN custom_roles r ON u.role_id = r.id
      LEFT JOIN branches b ON u.branch_id = b.id
      WHERE LOWER(u.email) = 'debam@deb.com'
    `);

    console.log('--- USER DEBAM@DEB.COM RECORD ---');
    console.table(userRes.rows);

    if (userRes.rows.length === 0) {
      console.log('User debam@deb.com NOT FOUND in database!');
      return;
    }

    const user = userRes.rows[0];

    // 2. Check Jobs created by or assigned to debam@deb.com or debam
    const jobsRes = await client.query(`
      SELECT id, job_code, job_title, account_manager_id, created_by, branch_id, market
      FROM jobs
      WHERE tenant_id = $1
        AND (
          account_manager_id = $2
          OR LOWER(account_manager_id) = 'debam@deb.com'
          OR LOWER(account_manager_id) LIKE '%debam%'
          OR LOWER(created_by) = 'debam@deb.com'
          OR LOWER(created_by) LIKE '%debam%'
        )
    `, [user.tenant_id, user.id]);

    console.log(`\n--- JOBS FOR DEBAM (${jobsRes.rows.length} jobs) ---`);
    console.table(jobsRes.rows);

  } catch (err) {
    console.error('Error:', err);
  } finally {
    await client.end();
  }
}

testDebamUser();
