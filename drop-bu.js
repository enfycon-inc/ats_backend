const { Client } = require("pg");
const client = new Client({ connectionString: "postgresql://ats_user:AtsDevPass2024@13.55.100.200:5432/ats_db?schema=ats" });

async function run() {
  await client.connect();
  await client.query(`
    ALTER TABLE ats.business_units
    DROP COLUMN IF EXISTS market,
    DROP COLUMN IF EXISTS currency;
  `);
  console.log("Success dropping columns");
  await client.end();
}
run().catch(console.error);
