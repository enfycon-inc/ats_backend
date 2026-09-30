const { Client } = require("pg");
const client = new Client({ connectionString: "postgresql://ats_user:AtsDevPass2024@13.55.100.200:5432/ats_db?schema=ats" });
client.connect().then(async () => {
  const res = await client.query(`SELECT column_name, data_type FROM information_schema.columns WHERE table_schema = 'ats' AND table_name = 'market_segments'`);
  console.log("market_segments columns:", JSON.stringify(res.rows, null, 2));
  
  const data = await client.query(`SELECT * FROM ats.market_segments LIMIT 5`);
  console.log("market_segments data:", JSON.stringify(data.rows, null, 2));

  await client.end();
}).catch(console.error);
