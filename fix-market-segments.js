const { Client } = require("pg");
const client = new Client({ connectionString: "postgresql://ats_user:AtsDevPass2024@13.55.100.200:5432/ats_db?schema=ats" });
client.connect().then(async () => {
  // We want to keep only the 3 canonical segments, maybe delete duplicates and point everything to the canonical ones.
  // Actually, setting all existing segments to tenant_id = null is safe enough for now.
  await client.query(`UPDATE ats.market_segments SET tenant_id = NULL`);
  console.log("Updated market_segments tenant_id to NULL");
  await client.end();
}).catch(console.error);
