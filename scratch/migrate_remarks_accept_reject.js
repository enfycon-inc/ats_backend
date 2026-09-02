const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function migrate() {
  try {
    console.log('Starting Stage Remarks & Branch Global Remarks Migration...');

    // 1. Add columns to tenant_stage_remarks
    await pool.query(`
      ALTER TABLE tenant_stage_remarks ADD COLUMN IF NOT EXISTS remark_type VARCHAR(20) DEFAULT 'GENERAL';
      ALTER TABLE tenant_stage_remarks ADD COLUMN IF NOT EXISTS is_global BOOLEAN DEFAULT FALSE;
    `);
    console.log('Added remark_type and is_global to tenant_stage_remarks.');

    // 2. Add enable_global_remarks to branches
    await pool.query(`
      ALTER TABLE branches ADD COLUMN IF NOT EXISTS enable_global_remarks BOOLEAN DEFAULT FALSE;
    `);
    console.log('Added enable_global_remarks to branches.');

    // 3. Mark existing global / default remarks
    await pool.query(`
      UPDATE tenant_stage_remarks
      SET is_global = TRUE
      WHERE branch_id IS NULL OR created_by = 'system';
    `);
    console.log('Updated is_global flags.');

    // 4. Categorize remark_type for existing records
    await pool.query(`
      UPDATE tenant_stage_remarks
      SET remark_type = 'ACCEPT'
      WHERE remark_text LIKE '✓%' 
         OR LOWER(remark_text) LIKE 'selected%' 
         OR LOWER(remark_text) LIKE '%shortlisted%'
         OR LOWER(remark_text) LIKE '%passed%'
         OR LOWER(remark_text) LIKE '%offer letter%'
         OR LOWER(remark_text) LIKE '%joined client%';
    `);

    await pool.query(`
      UPDATE tenant_stage_remarks
      SET remark_type = 'REJECT'
      WHERE remark_text LIKE '✕%' 
         OR LOWER(remark_text) LIKE 'rejected%' 
         OR LOWER(remark_text) LIKE '%noshow%' 
         OR LOWER(remark_text) LIKE '%declined%' 
         OR LOWER(remark_text) LIKE '%not responding%'
         OR LOWER(remark_text) LIKE '%failed%';
    `);

    console.log('Categorized remark_type for all records.');

    // Verification check
    const typeCounts = await pool.query(`
      SELECT remark_type, is_global, COUNT(*) as count 
      FROM tenant_stage_remarks 
      GROUP BY remark_type, is_global
    `);
    console.log('Verification Breakdown:', typeCounts.rows);

    const branchSettings = await pool.query(`
      SELECT id, name, enable_global_remarks FROM branches LIMIT 5
    `);
    console.log('Sample Branch Settings:', branchSettings.rows);

  } catch (err) {
    console.error('Migration failed:', err);
  } finally {
    await pool.end();
  }
}

migrate();
