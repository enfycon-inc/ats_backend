const { Client } = require('pg');
const client = new Client({ connectionString: 'postgresql://ats_user:AtsDevPass2024@13.55.100.200:5432/ats_db?schema=ats' });
client.connect().then(() => {
  return client.query("SELECT u.email, cr.name as role_name, sr.system_key as system_role FROM ats.users u LEFT JOIN ats.custom_roles cr ON u.role_id = cr.id LEFT JOIN ats.system_roles sr ON cr.system_role_id = sr.id WHERE u.email IN ('admin@enfycon.com', 'imsahadeb@gmail.com')");
}).then(res => {
  console.table(res.rows);
  client.end();
}).catch(console.error);
