const { Client } = require('pg');
const client = new Client({ connectionString: 'postgresql://ats_user:AtsDevPass2024@13.55.100.200:5432/ats_db?schema=ats' });
client.connect().then(() => {
  return client.query("DELETE FROM ats.users WHERE id IN ('14e28a3f-eabd-49a8-9130-c150ec26c2ff', '220a9703-8e5e-407d-b85f-d5687bff2fa4')");
}).then(res => {
  console.log('Deleted rows:', res.rowCount);
  client.end();
}).catch(console.error);
