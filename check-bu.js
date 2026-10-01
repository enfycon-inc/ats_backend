const { Client } = require("pg");
const client = new Client({ connectionString: "postgresql://ats_user:AtsDevPass2024@13.55.100.200:5432/ats_db?schema=ats" });

async function run() {
  await client.connect();
  const res1 = await client.query(`SELECT column_name, data_type FROM information_schema.columns WHERE table_schema = 'ats' AND table_name = 'business_units'`);
  console.log("BUSINESS UNITS COLUMNS:");
  console.log(res1.rows);
  await client.end();
}
run().catch(console.error);
