const { Client } = require("pg");
const client = new Client({ connectionString: "postgresql://ats_user:AtsDevPass2024@13.55.100.200:5432/ats_db?schema=ats" });
client.connect().then(async () => {
  await client.query(`ALTER TABLE ats.market_segments ALTER COLUMN tenant_id DROP NOT NULL;`);
  console.log("Made tenant_id nullable in DB.");
  await client.end();
}).catch(console.error);
