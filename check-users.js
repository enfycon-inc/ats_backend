const { Pool } = require('pg');
const pool = new Pool({ connectionString: 'postgresql://ats_user:AtsDevPass2024@13.55.100.200:5432/ats_db?schema=ats' });

async function checkUsers() {
  const mRes = await pool.query(`SELECT column_name, data_type FROM information_schema.columns WHERE table_schema = 'ats' AND table_name = 'users';`);
  console.log("Users columns:", mRes.rows.map(r => r.column_name).join(', '));
  pool.end();
}
checkUsers();
