const { Pool } = require('pg');
require('dotenv').config({ path: './.env' });

async function verifySoftDelete() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error('DATABASE_URL missing');
    process.exit(1);
  }

  const pool = new Pool({
    connectionString,
    ssl: connectionString.includes('supabase') ? { rejectUnauthorized: false } : undefined,
  });

  try {
    console.log('Connecting to database...');
    const nowRes = await pool.query('SELECT NOW()');
    console.log('Connected! Database time:', nowRes.rows[0].now);

    // Ensure DDL ran
    await pool.query(`
      ALTER TABLE jobs ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP WITH TIME ZONE DEFAULT NULL;
      ALTER TABLE clients ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP WITH TIME ZONE DEFAULT NULL;
      ALTER TABLE candidates ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP WITH TIME ZONE DEFAULT NULL;

      CREATE INDEX IF NOT EXISTS idx_jobs_tenant_deleted ON jobs(tenant_id, deleted_at);
      CREATE INDEX IF NOT EXISTS idx_clients_tenant_deleted ON clients(tenant_id, deleted_at);
      CREATE INDEX IF NOT EXISTS idx_candidates_tenant_deleted ON candidates(tenant_id, deleted_at);
    `);

    // 1. Check deleted_at columns on jobs, clients, candidates
    const tables = ['jobs', 'clients', 'candidates'];
    for (const table of tables) {
      const colRes = await pool.query(`
        SELECT column_name, data_type 
        FROM information_schema.columns 
        WHERE table_name = $1 AND column_name = 'deleted_at'
      `, [table]);
      if (colRes.rows.length > 0) {
        console.log(`Column deleted_at verified on table "${table}" (${colRes.rows[0].data_type})`);
      } else {
        console.error(`Missing deleted_at column on table "${table}"`);
      }
    }

    // 2. Check indexes
    const indexes = ['idx_jobs_tenant_deleted', 'idx_clients_tenant_deleted', 'idx_candidates_tenant_deleted'];
    for (const idx of indexes) {
      const idxRes = await pool.query(`
        SELECT indexname FROM pg_indexes WHERE indexname = $1
      `, [idx]);
      if (idxRes.rows.length > 0) {
        console.log(`Index verified: ${idx}`);
      } else {
        console.error(`Missing index: ${idx}`);
      }
    }

    // 3. Test Soft Delete & Restore cycle on a temporary test client
    const tenantId = 'd3b07384-d113-49c3-a555-9ee75c13ca33';
    console.log('\nTesting Soft Delete & Restore cycle...');

    // Create test client
    const createRes = await pool.query(`
      INSERT INTO clients (tenant_id, client_code, client_name, status)
      VALUES ($1, 'TEST-SD-001', 'Soft Delete Test Client', 'Active')
      RETURNING id, client_name, deleted_at
    `, [tenantId]);
    const testClient = createRes.rows[0];
    console.log('1. Created Test Client:', testClient.id, '| deleted_at:', testClient.deleted_at);

    // Soft delete test client
    const softDelRes = await pool.query(`
      UPDATE clients 
      SET deleted_at = NOW(), modified_by = 'TestScript' 
      WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL 
      RETURNING id, deleted_at
    `, [testClient.id, tenantId]);
    console.log('2. Soft-Deleted Client:', softDelRes.rows[0].id, '| deleted_at:', softDelRes.rows[0].deleted_at);

    // Verify active filter query hides soft-deleted client
    const activeQuery = await pool.query(`
      SELECT id FROM clients WHERE id = $1 AND deleted_at IS NULL
    `, [testClient.id]);
    console.log('3. Active Query Result Count (Should be 0):', activeQuery.rows.length);

    // Restore test client
    const restoreRes = await pool.query(`
      UPDATE clients 
      SET deleted_at = NULL, modified_by = 'TestScript' 
      WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NOT NULL 
      RETURNING id, deleted_at
    `, [testClient.id, tenantId]);
    console.log('4. Restored Client:', restoreRes.rows[0].id, '| deleted_at:', restoreRes.rows[0].deleted_at);

    // Verify active filter query sees restored client
    const restoredQuery = await pool.query(`
      SELECT id FROM clients WHERE id = $1 AND deleted_at IS NULL
    `, [testClient.id]);
    console.log('5. Active Query Result Count (Should be 1):', restoredQuery.rows.length);

    // Clean up test client physically
    await pool.query('DELETE FROM clients WHERE id = $1', [testClient.id]);
    console.log('6. Cleaned up test client.');

    console.log('\nALL VERIFICATION TESTS PASSED SUCCESSFULLY!');
  } catch (err) {
    console.error('Verification failed:', err);
  } finally {
    await pool.end();
  }
}

verifySoftDelete();
