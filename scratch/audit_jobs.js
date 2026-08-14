const { Client } = require('pg');

async function audit() {
  const dbUrl = process.env.DATABASE_URL || "postgresql://postgres.zqpxnnsbbqdlhememsyj:EWhbqnM6IWe5IJaV@aws-1-ap-northeast-1.pooler.supabase.com:6543/postgres";
  const client = new Client({ connectionString: dbUrl });

  try {
    await client.connect();
    console.log('Connected to PostgreSQL DB.');

    // 1. Audit Tenants
    const tenantsRes = await client.query('SELECT id, name, domain, status, default_market FROM tenants ORDER BY created_at ASC');
    console.log('\n--- TENANTS AUDIT ---');
    console.table(tenantsRes.rows);

    // 2. Audit Branches
    const branchesRes = await client.query('SELECT id, tenant_id, name, code, market FROM branches ORDER BY name ASC');
    console.log('\n--- BRANCHES AUDIT ---');
    console.table(branchesRes.rows);

    // 3. Audit Jobs across all tenants
    const jobsRes = await client.query(`
      SELECT j.id, j.tenant_id, t.name as tenant_name, j.job_code, j.job_title, j.business_unit, j.branch_id, b.code as branch_code, j.created_at
      FROM jobs j
      LEFT JOIN tenants t ON j.tenant_id = t.id
      LEFT JOIN branches b ON j.branch_id = b.id
      ORDER BY j.created_at ASC
    `);
    console.log('\n--- JOBS AUDIT ---');
    console.table(jobsRes.rows);

    // 4. Audit Submissions count per job
    const subsRes = await client.query(`
      SELECT job_id, COUNT(*) as submission_count 
      FROM recruiter_submissions 
      GROUP BY job_id
    `);
    console.log('\n--- SUBMISSIONS COUNT PER JOB ---');
    console.table(subsRes.rows);

  } catch (err) {
    console.error('Audit Error:', err);
  } finally {
    await client.end();
  }
}

audit();
