const { Client } = require('pg');
const client = new Client({ connectionString: 'postgresql://ats_user:AtsDevPass2024@13.55.100.200:5432/ats_db?schema=ats' });
client.connect().then(() => {
  return client.query("SELECT * FROM ats.users WHERE email IN ('imsahadeb@gmail.com', 'admin@enfycon.com')");
}).then(res => {
  res.rows.forEach(r => console.log(r.id, r.email, r.tenant_id));
  client.end();
}).catch(console.error);
