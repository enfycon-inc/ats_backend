const { Client } = require('pg');
require('dotenv').config();
const client = new Client({ connectionString: process.env.DATABASE_URL });
client.connect().then(async () => {
  const r = await client.query("SELECT column_name FROM information_schema.columns WHERE table_schema = 'ats' AND table_name = 'business_units'");
  console.log(r.rows.map(x => x.column_name).join(', '));
  await client.end();
});
