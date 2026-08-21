const { Pool } = require('pg');
require('dotenv').config();
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function check() {
  try {
    const branches = await pool.query('SELECT * FROM branches');
    console.log('Branches:', branches.rows);

    const cols = await pool.query("SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'tenant_stage_remarks'");
    console.log('tenant_stage_remarks columns:', cols.rows);

    const tenants = await pool.query('SELECT * FROM tenants');
    console.log('Tenants:', tenants.rows);

    const remarks = await pool.query("SELECT id, tenant_id, stage, remark_text FROM tenant_stage_remarks");
    console.log('Total remarks count:', remarks.rows.length);
    console.log('Remarks by stage:', remarks.rows.reduce((acc, r) => {
      acc[r.stage] = (acc[r.stage] || 0) + 1;
      return acc;
    }, {}));
  } catch (err) {
    console.error('Error:', err);
  } finally {
    await pool.end();
  }
}

check();
