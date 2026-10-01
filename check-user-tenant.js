const { Pool } = require('pg');
const pool = new Pool({ connectionString: 'postgresql://ats_user:AtsDevPass2024@13.55.100.200:5432/ats_db?schema=ats' });

async function checkUser() {
  const mRes = await pool.query(`SELECT id, email, tenant_id, branch_id, role_id FROM ats.users WHERE email = 'sambit@enfycon.com';`);
  console.log("Users:", mRes.rows);
  pool.end();
}
checkUser();
