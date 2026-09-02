const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function main() {
  try {
    const remarkCols = await pool.query("SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'tenant_stage_remarks'");
    console.log('tenant_stage_remarks columns:', remarkCols.rows);

    const branchCols = await pool.query("SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'branches'");
    console.log('branches columns:', branchCols.rows);

    const sampleRemarks = await pool.query("SELECT id, tenant_id, stage, remark_text, branch_id FROM tenant_stage_remarks LIMIT 5");
    console.log('Sample remarks:', sampleRemarks.rows);

    const branchList = await pool.query("SELECT id, name, tenant_id FROM branches");
    console.log('Branches:', branchList.rows);
  } catch (err) {
    console.error('Error:', err);
  } finally {
    await pool.end();
  }
}

main();
