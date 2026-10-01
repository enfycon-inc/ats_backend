const { Client } = require("pg");
const client = new Client({ connectionString: "postgresql://ats_user:AtsDevPass2024@13.55.100.200:5432/ats_db?schema=ats" });
client.connect().then(async () => {
  const buRes = await client.query(`SELECT id, name, market, market_segment_id FROM ats.business_units LIMIT 5;`);
  console.log("Business Units:", buRes.rows);
  const msRes = await client.query(`SELECT id, name, code FROM ats.market_segments;`);
  console.log("Market Segments:", msRes.rows);
  await client.end();
}).catch(console.error);
