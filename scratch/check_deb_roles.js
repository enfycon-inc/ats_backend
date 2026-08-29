const { Client } = require('pg');
require('dotenv').config();
const client = new Client({ connectionString: process.env.DATABASE_URL });
async function main() {
  await client.connect();
  const tid = 'fad0ccbf-db00-4560-bbfc-216eea7b107b';
  const roles = await client.query('SELECT cr.id, cr.name, cr.is_system, cr.system_role, cr.branch_id FROM custom_roles cr WHERE cr.tenant_id = $1', [tid]);
  console.log('CUSTOM_ROLES:', JSON.stringify(roles.rows, null, 2));
  const users = await client.query('SELECT u.id, u.full_name, u.email, u.role_id, cr.name as role_name, cr.is_system, cr.system_role FROM users u LEFT JOIN custom_roles cr ON u.role_id = cr.id WHERE u.tenant_id = $1', [tid]);
  console.log('USERS IN DEB:', JSON.stringify(users.rows, null, 2));
  await client.end();
}
main().catch(console.error);
