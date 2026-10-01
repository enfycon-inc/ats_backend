const { Client } = require("pg");
const client = new Client({ connectionString: "postgresql://ats_user:AtsDevPass2024@13.55.100.200:5432/ats_db?schema=ats" });
client.connect().then(async () => {
  const jobRes = await client.query(`UPDATE ats.jobs SET market = 'IND' WHERE market = 'DOM' RETURNING id, job_code, market;`);
  console.log("Updated jobs:", jobRes.rows);
  await client.end();
}).catch(console.error);
