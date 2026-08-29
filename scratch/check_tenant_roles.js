const { Client } = require('pg');
require('dotenv').config();

const client = new Client({ connectionString: process.env.DATABASE_URL });

async function main() {
  await client.connect();
  const tid = 'fad0ccbf-db00-4560-bbfc-216eea7b107b';
  const roles = await client.query(
    `SELECT cr.id, cr.tenant_id, cr.branch_id, b.name as branch_name, cr.name, cr.is_system, cr.system_role 
     FROM custom_roles cr 
     LEFT JOIN branches b ON b.id = cr.branch_id 
     WHERE cr.tenant_id = $1`,
    [tid]
  );
  console.log('ROLES IN DB:');
  console.table(roles.rows);

  const branches = await client.query('SELECT id, name, is_active FROM branches WHERE tenant_id = $1', [tid]);
  console.log('BRANCHES IN DB:');
  console.table(branches.rows);

  await client.end();
}

main().catch(console.error);
