const { Client } = require("pg");
const client = new Client({ connectionString: "postgresql://ats_user:AtsDevPass2024@13.55.100.200:5432/ats_db?schema=ats" });
client.connect().then(async () => {
  const brRes = await client.query(`UPDATE ats.branches SET market = 'IND' WHERE market = 'DOM' RETURNING id, name, market;`);
  console.log("Updated branches:", brRes.rows);
  await client.end();
}).catch(console.error);
