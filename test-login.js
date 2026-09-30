const { Client } = require('pg');
const client = new Client({ connectionString: 'postgresql://ats_user:AtsDevPass2024@13.55.100.200:5432/ats_db?schema=ats' });
client.connect().then(() => {
  return client.query("SELECT u.id, u.email, u.full_name, u.tenant_id, sr.system_key FROM ats.users u LEFT JOIN ats.custom_roles cr ON u.role_id = cr.id LEFT JOIN ats.system_roles sr ON cr.system_role_id = sr.id WHERE LOWER(TRIM(u.email)) = 'admin@enfycon.com' LIMIT 1");
}).then(res => {
  console.table(res.rows);
  client.end();
}).catch(console.error);
