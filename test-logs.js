const { Pool } = require('pg');
const pool = new Pool({ connectionString: 'postgresql://ats_user:AtsDevPass2024@13.55.100.200:5432/ats_db?schema=ats' });

async function check() {
  const jobId = '639aaf25-6a6d-4107-9c54-582456d03296';
  const res = await pool.query(`SELECT * FROM ats.job_assignment_logs WHERE job_id = $1 ORDER BY assigned_at DESC LIMIT 5`, [jobId]);
  console.log("Assignment Logs:", res.rows);
  pool.end();
}
check();
