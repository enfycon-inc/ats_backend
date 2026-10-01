const { Client } = require("pg");
const client = new Client({ connectionString: "postgresql://ats_user:AtsDevPass2024@13.55.100.200:5432/ats_db?schema=ats" });
client.connect().then(async () => {
  // Update market_segments
  const msRes = await client.query(`UPDATE ats.market_segments SET code = 'IND' WHERE code = 'DOM' RETURNING id, name, code;`);
  console.log("Updated market_segments:", msRes.rows);

  // Update business_units
  const buRes = await client.query(`UPDATE ats.business_units SET market = 'IND' WHERE market = 'DOM' RETURNING id, name, market;`);
  console.log("Updated business_units:", buRes.rows);

  await client.end();
}).catch(console.error);
