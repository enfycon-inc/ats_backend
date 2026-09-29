const { Client } = require('pg');
require('dotenv').config();
const client = new Client({ connectionString: process.env.DATABASE_URL });
client.connect().then(async () => {
  const roleId = 'd7746edf-4e8a-4a9a-866b-7d5b90896003';

  // Check columns of custom_roles
  const cols1 = await client.query("SELECT column_name FROM information_schema.columns WHERE table_schema = 'ats' AND table_name = 'custom_roles'");
  console.log('custom_roles columns:', cols1.rows.map(r => r.column_name).join(', '));

  const cr = await client.query('SELECT * FROM ats.custom_roles WHERE id = $1', [roleId]);
  if (cr.rows.length > 0) {
    const row = cr.rows[0];
    console.log('custom_roles row:');
    console.log('  id:', row.id);
    console.log('  name:', row.name);
    console.log('  system_name:', row.system_name);
    console.log('  role_type:', row.role_type);
    console.log('  permissions:', JSON.stringify(row.permissions));
  } else {
    console.log('NOT in custom_roles');
    const sr = await client.query('SELECT * FROM ats.system_roles WHERE id = $1', [roleId]);
    console.log('system_roles:', JSON.stringify(sr.rows[0]));
  }

  await client.end();
}).catch(e => console.error('ERROR:', e.message));
