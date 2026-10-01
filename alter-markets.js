const { Client } = require("pg");
const client = new Client({ connectionString: "postgresql://ats_user:AtsDevPass2024@13.55.100.200:5432/ats_db?schema=ats" });

async function run() {
  await client.connect();
  await client.query(`
    ALTER TABLE ats.market_segments
    DROP COLUMN IF EXISTS tenant_id,
    DROP COLUMN IF EXISTS default_timezone,
    DROP COLUMN IF EXISTS default_shift,
    DROP COLUMN IF EXISTS default_start_time,
    DROP COLUMN IF EXISTS default_end_time;
  `);
  console.log("Success");
  await client.end();
}
run().catch(console.error);
