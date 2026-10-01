const { Client } = require('pg');
const client = new Client({ connectionString: 'postgresql://ats_user:AtsDevPass2024@13.55.100.200:5432/ats_db?schema=ats' });
async function run() {
  await client.connect();
  const res = await client.query('SELECT id, name, code FROM ats.market_segments');
  console.log(res.rows);
  await client.end();
}
run();
