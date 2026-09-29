const { Client } = require('pg');
require('dotenv').config();

const client = new Client({ connectionString: process.env.DATABASE_URL });

async function fixAll() {
  await client.connect();
  console.log('Starting full DB audit and fix...');

  try {
    // We will do these one by one without a transaction so if one fails, the others succeed. Or we handle them carefully.

    const fixUserCol = async (table, col) => {
      console.log(`Fixing ${table}.${col}...`);
      try {
        // Map names to UUIDs
        await client.query(`
          UPDATE ats.${table} t
          SET ${col} = u.id
          FROM ats.users u
          WHERE t.${col} = u.full_name OR t.${col} = u.email;
        `);
        // Map 'System' or unmapped text to NULL
        await client.query(`
          UPDATE ats.${table}
          SET ${col} = NULL
          WHERE ${col} IS NOT NULL AND ${col} !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
        `);
        // Cast to UUID
        await client.query(`ALTER TABLE ats.${table} ALTER COLUMN ${col} TYPE UUID USING ${col}::uuid`);
        console.log(`✅ ${table}.${col} fixed and cast to UUID.`);
      } catch (e) {
        console.log(`❌ Failed to fix ${table}.${col}: ${e.message}`);
      }
    };

    // User columns
    await fixUserCol('clients', 'created_by');
    await fixUserCol('clients', 'modified_by');
    await fixUserCol('clients', 'approved_by');
    
    await fixUserCol('recruiter_submissions', 'recruiter_id');
    
    await fixUserCol('bulk_uploads', 'created_by');
    
    await fixUserCol('job_assignment_logs', 'assigned_by');
    
    await fixUserCol('tenant_stage_remarks', 'created_by');
    await fixUserCol('user_invitations', 'created_by');

    // Tenant / Branch columns in tenant_stage_remarks
    console.log(`Fixing tenant_stage_remarks.branch_id...`);
    try {
      await client.query(`
        UPDATE ats.tenant_stage_remarks
        SET branch_id = NULL
        WHERE branch_id IS NOT NULL AND branch_id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
      `);
      await client.query(`ALTER TABLE ats.tenant_stage_remarks ALTER COLUMN branch_id TYPE UUID USING branch_id::uuid`);
      console.log(`✅ tenant_stage_remarks.branch_id fixed.`);
    } catch(e) { console.log(e.message); }

    console.log(`Fixing tenant_stage_remarks.tenant_id...`);
    try {
      await client.query(`
        UPDATE ats.tenant_stage_remarks
        SET tenant_id = NULL
        WHERE tenant_id IS NOT NULL AND tenant_id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
      `);
      await client.query(`ALTER TABLE ats.tenant_stage_remarks ALTER COLUMN tenant_id TYPE UUID USING tenant_id::uuid`);
      console.log(`✅ tenant_stage_remarks.tenant_id fixed.`);
    } catch(e) { console.log(e.message); }

  } catch (err) {
    console.error('Migration failed:', err);
  } finally {
    await client.end();
  }
}

fixAll();
