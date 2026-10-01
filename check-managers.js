const { Pool } = require('pg');
const pool = new Pool({ connectionString: 'postgresql://ats_user:AtsDevPass2024@13.55.100.200:5432/ats_db?schema=ats' });

async function checkManagers() {
  const mRes = await pool.query(`SELECT A."A" as branch_id, A."B" as user_id, U.full_name FROM ats."_BranchManagers" A JOIN ats.users U ON A."B" = U.id;`);
  console.log("Managers mapping:", mRes.rows);
  pool.end();
}
checkManagers();
