const { Client } = require('pg');
const client = new Client({ connectionString: 'postgresql://ats_user:AtsDevPass2024@13.55.100.200:5432/ats_db?schema=ats' });
client.connect().then(() => {
  return client.query("SELECT id, email, tenant_id, is_active FROM ats.users WHERE email IN ('sambit@enfycon.com', 'admin@enfycon.com') ORDER BY email, created_at");
}).then(res => {
  console.table(res.rows);
  client.end();
}).catch(console.error);
