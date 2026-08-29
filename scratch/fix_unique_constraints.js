const { Client } = require('pg');
require('dotenv').config();

const client = new Client({ connectionString: process.env.DATABASE_URL });

async function main() {
  await client.connect();
  console.log('Connected to DB. Dropping outdated tenant_id + name unique constraints...');

  // 1. Drop outdated custom_roles constraint
  await client.query(`
    ALTER TABLE custom_roles DROP CONSTRAINT IF EXISTS custom_roles_tenant_id_name_key;
    DROP INDEX IF EXISTS idx_custom_roles_tenant_name;
    CREATE UNIQUE INDEX IF NOT EXISTS idx_custom_roles_branch_name 
      ON custom_roles (tenant_id, branch_id, UPPER(name)) 
      WHERE is_system = false AND branch_id IS NOT NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS idx_custom_roles_system_name 
      ON custom_roles (tenant_id, UPPER(name)) 
      WHERE is_system = true;
  `);
  console.log('Successfully updated custom_roles unique indexes.');

  // 2. Drop outdated pods constraint
  await client.query(`
    ALTER TABLE pods ADD COLUMN IF NOT EXISTS branch_id UUID REFERENCES branches(id) ON DELETE CASCADE;
    ALTER TABLE pods DROP CONSTRAINT IF EXISTS pods_tenant_id_name_key;
    DROP INDEX IF EXISTS idx_pods_tenant_name;
    CREATE UNIQUE INDEX IF NOT EXISTS idx_pods_branch_name 
      ON pods (tenant_id, branch_id, UPPER(name)) 
      WHERE branch_id IS NOT NULL;
  `);
  console.log('Successfully updated pods unique indexes.');

  await client.end();
}

main().catch(console.error);
