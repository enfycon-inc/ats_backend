const { Pool } = require('pg');
const pool = new Pool({ connectionString: 'postgresql://ats_user:AtsDevPass2024@13.55.100.200:5432/ats_db?schema=ats' });

async function checkUser() {
  const mRes = await pool.query(`SELECT id, email, role_id, assigned_role_ids FROM ats.users WHERE email = 'sambit@enfycon.com';`);
  console.log("User:", mRes.rows);
  
  if (mRes.rows.length > 0) {
     const roleId = mRes.rows[0].role_id;
     if (roleId) {
        const rRes = await pool.query(`SELECT id, name, system_role_id FROM ats.custom_roles WHERE id = $1`, [roleId]);
        console.log("Role:", rRes.rows);
        if (rRes.rows.length > 0) {
           const sysRes = await pool.query(`SELECT system_key FROM ats.system_roles WHERE id = $1`, [rRes.rows[0].system_role_id]);
           console.log("System Role:", sysRes.rows);
        }
     }
  }
  pool.end();
}
checkUser();
