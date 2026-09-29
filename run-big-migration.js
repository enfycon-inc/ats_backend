const { Client } = require('pg');
require('dotenv').config();

async function runBigMigration() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  console.log('--- STARTING BIG MIGRATION ---');

  try {
    await client.query('BEGIN');

    // 1. Clean up `approved_by` = 'System' -> NULL
    console.log('Cleaning up approved_by...');
    await client.query(`UPDATE ats.jobs SET approved_by = NULL WHERE approved_by = 'System' OR approved_by = ''`);
    
    // Convert approved_by to UUID
    await client.query(`ALTER TABLE ats.jobs ALTER COLUMN approved_by TYPE UUID USING approved_by::uuid`);
    console.log('✅ approved_by cast to UUID');

    // 2. Migrate Clients (client_name -> client_id)
    console.log('Migrating clients...');
    const jobsWithClients = await client.query(`SELECT id, client_name, end_client_name FROM ats.jobs WHERE client_name IS NOT NULL OR end_client_name IS NOT NULL`);
    for (const job of jobsWithClients.rows) {
      let cId = null;
      let ecId = null;
      
      if (job.client_name && job.client_name !== 'Internal' && job.client_name !== 'Direct Client' && job.client_name !== 'N/A') {
        const res = await client.query(`SELECT id FROM ats.clients WHERE LOWER(client_name) = LOWER($1) LIMIT 1`, [job.client_name]);
        if (res.rows.length > 0) cId = res.rows[0].id;
      }
      
      if (job.end_client_name && job.end_client_name !== 'Internal' && job.end_client_name !== 'Direct Client' && job.end_client_name !== 'N/A') {
        const res = await client.query(`SELECT id FROM ats.clients WHERE LOWER(client_name) = LOWER($1) LIMIT 1`, [job.end_client_name]);
        if (res.rows.length > 0) ecId = res.rows[0].id;
      }

      if (cId || ecId) {
        await client.query(`UPDATE ats.jobs SET client_id = COALESCE($1, client_id), end_client_id = COALESCE($2, end_client_id) WHERE id = $3`, [cId, ecId, job.id]);
      }
    }
    console.log('✅ Clients migrated');

    // 3. Migrate Business Units
    console.log('Migrating business units...');
    const jobsWithBUs = await client.query(`SELECT id, business_unit, tenant_id FROM ats.jobs WHERE business_unit IS NOT NULL AND business_unit != ''`);
    for (const job of jobsWithBUs.rows) {
      if (job.business_unit) {
        let buId = null;
        const res = await client.query(`SELECT id FROM ats.business_units WHERE LOWER(name) = LOWER($1) AND tenant_id = $2 LIMIT 1`, [job.business_unit, job.tenant_id]);
        if (res.rows.length > 0) {
          buId = res.rows[0].id;
        } else {
          // Check if it's already an ID
          if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(job.business_unit)) {
             buId = job.business_unit;
          }
        }
        if (buId) {
          await client.query(`UPDATE ats.jobs SET business_unit_id = $1 WHERE id = $2`, [buId, job.id]);
        }
      }
    }
    console.log('✅ Business Units migrated');

    // 4. Drop Redundant / HRMS Columns
    console.log('Dropping redundant columns...');
    const colsToDrop = [
      'working_days', 
      'work_start_time', 
      'work_end_time', 
      'timing_snapshot_at',
      'assigned_to',
      'business_unit',
      'client_name',
      'end_client_name'
    ];

    for (const col of colsToDrop) {
      // Check if column exists first
      const check = await client.query(`SELECT column_name FROM information_schema.columns WHERE table_schema = 'ats' AND table_name = 'jobs' AND column_name = $1`, [col]);
      if (check.rows.length > 0) {
        await client.query(`ALTER TABLE ats.jobs DROP COLUMN ${col}`);
        console.log(`✅ Dropped ${col}`);
      }
    }

    await client.query('COMMIT');
    console.log('--- BIG MIGRATION SUCCESSFUL ---');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ MIGRATION FAILED:', err.message);
  } finally {
    await client.end();
  }
}

runBigMigration();
