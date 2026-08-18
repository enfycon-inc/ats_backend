const { Client } = require('pg');
const client = new Client({
  connectionString: "postgresql://postgres.zqpxnnsbbqdlhememsyj:EWhbqnM6IWe5IJaV@aws-1-ap-northeast-1.pooler.supabase.com:6543/postgres",
  ssl: { rejectUnauthorized: false }
});

async function run() {
  try {
    await client.connect();
    console.log("SUCCESSFULLY CONNECTED TO SUPABASE POOLER DB (6543)!");
    const res = await client.query("SELECT NOW()");
    console.log("Time:", res.rows[0]);
    await client.end();
  } catch (err) {
    console.error("Pooler connection failed:", err.message);
  }
}
run();
