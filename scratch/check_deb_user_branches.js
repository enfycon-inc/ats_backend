const { Client } = require('pg');
require('dotenv').config();
const client = new Client({ connectionString: process.env.DATABASE_URL });
async function main() {
  await client.connect();
  const tid = 'fad0ccbf-db00-4560-bbfc-216eea7b107b';
  const users = await client.query('SELECT u.id, u.full_name, u.email, u.role_id, u.roles, u.branch_id, u.assigned_branch_ids, b.name as branch_name, cr.name as role_name, cr.branch_id as role_branch_id FROM users u LEFT JOIN branches b ON u.branch_id = b.id LEFT JOIN custom_roles cr ON u.role_id = cr.id WHERE u.tenant_id = $1', [tid]);
  console.log('USERS IN DEB WITH BRANCHES:', JSON.stringify(users.rows, null, 2));
  await client.end();
}
main().catch(console.error);
