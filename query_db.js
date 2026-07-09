const { Pool } = require('pg');
const pool = new Pool({
  connectionString: "postgresql://postgres.zqpxnnsbbqdlhememsyj:EWhbqnM6IWe5IJaV@aws-1-ap-northeast-1.pooler.supabase.com:6543/postgres",
  ssl: { rejectUnauthorized: false }
});

async function main() {
  try {
    const tenants = await pool.query('SELECT id, name, domain FROM tenants');
    console.log('Tenants:', tenants.rows);
    
    const users = await pool.query('SELECT id, email, full_name, roles, tenant_id FROM users');
    console.log('Users:', users.rows);
    const jobs = await pool.query('SELECT * FROM jobs');
    console.log('Jobs:', jobs.rows.map(r => ({ id: r.id, tenant_id: r.tenant_id, job_code: r.job_code, job_title: r.job_title, status: r.status, market: r.market })));
  } catch (err) {
    console.error(err);
  } finally {
    await pool.end();
  }
}
main();
