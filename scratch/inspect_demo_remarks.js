const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function main() {
  try {
    const res = await pool.query("SELECT id, tenant_id, stage, remark_text, branch_id, created_by FROM tenant_stage_remarks WHERE tenant_id = '1866f1b6-b56d-4a30-8529-81f88ae051ff'");
    console.log(`Demo tenant remarks count: ${res.rows.length}`);
    console.log('Sample rows:', res.rows.slice(0, 10));
    console.log('Branch IDs present in remarks:', [...new Set(res.rows.map(r => r.branch_id))]);
  } catch (err) {
    console.error('Error:', err);
  } finally {
    await pool.end();
  }
}

main();
