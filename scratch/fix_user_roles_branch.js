const { Client } = require('pg');
require('dotenv').config();
const client = new Client({ connectionString: process.env.DATABASE_URL });
async function main() {
  await client.connect();
  const tid = 'fad0ccbf-db00-4560-bbfc-216eea7b107b';
  
  // Reset vizag-am-us@deb.com to ACCOUNT_MANAGER system template
  const amSysRole = await client.query("SELECT id FROM custom_roles WHERE tenant_id = $1 AND name = 'ACCOUNT_MANAGER' AND is_system = true LIMIT 1", [tid]);
  if (amSysRole.rows[0]) {
    await client.query("UPDATE users SET role_id = $1, roles = ARRAY['ACCOUNT_MANAGER'] WHERE email = 'vizag-am-us@deb.com' AND tenant_id = $2", [amSysRole.rows[0].id, tid]);
    console.log('Reset vizag-am-us@deb.com to ACCOUNT_MANAGER');
  }

  // Reset raja@deb.com to ACCOUNT_MANAGER
  if (amSysRole.rows[0]) {
    await client.query("UPDATE users SET role_id = $1, roles = ARRAY['ACCOUNT_MANAGER'] WHERE email = 'raja@deb.com' AND tenant_id = $2", [amSysRole.rows[0].id, tid]);
    console.log('Reset raja@deb.com to ACCOUNT_MANAGER');
  }

  // Reset vizag-recruiter-us-it@deb.com to RECRUITER system template
  const recSysRole = await client.query("SELECT id FROM custom_roles WHERE tenant_id = $1 AND name = 'RECRUITER' AND is_system = true LIMIT 1", [tid]);
  if (recSysRole.rows[0]) {
    await client.query("UPDATE users SET role_id = $1, roles = ARRAY['RECRUITER'] WHERE email = 'vizag-recruiter-us-it@deb.com' AND tenant_id = $2", [recSysRole.rows[0].id, tid]);
    console.log('Reset vizag-recruiter-us-it@deb.com to RECRUITER system template');
  }

  const users = await client.query('SELECT u.id, u.full_name, u.email, u.role_id, cr.name as role_name, b.name as branch_name FROM users u LEFT JOIN branches b ON u.branch_id = b.id LEFT JOIN custom_roles cr ON u.role_id = cr.id WHERE u.tenant_id = $1', [tid]);
  console.log('UPDATED USERS:', JSON.stringify(users.rows, null, 2));

  await client.end();
}
main().catch(console.error);
