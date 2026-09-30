const { Client } = require('pg');
const client = new Client({ connectionString: 'postgresql://ats_user:AtsDevPass2024@13.55.100.200:5432/ats_db?schema=ats' });
client.connect().then(() => {
  return client.query("SELECT email, tenant_id, branch_id FROM ats.users WHERE email IN ('imsahadeb@gmail.com', 'admin@enfycon.com')");
}).then(res => {
  console.log(res.rows);
  client.end();
}).catch(console.error);
