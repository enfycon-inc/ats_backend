const { Client } = require('pg');
const client = new Client({ connectionString: 'postgresql://ats_user:AtsDevPass2024@13.55.100.200:5432/ats_db?schema=ats' });
client.connect().then(() => {
  return client.query(
    SELECT u.email, t.domain as tenant_domain 
    FROM ats.users u 
    LEFT JOIN ats.tenants t ON u.tenant_id = t.id 
    WHERE u.email = 'imsahadeb@gmail.com'
  );
}).then(res => {
  console.table(res.rows);
  client.end();
}).catch(console.error);
