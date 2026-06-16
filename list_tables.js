const { Client } = require('pg');

async function run() {
  const client = new Client({
    connectionString: "postgresql://postgres.zqpxnnsbbqdlhememsyj:EWhbqnM6IWe5IJaV@aws-1-ap-northeast-1.pooler.supabase.com:6543/postgres"
  });
  await client.connect();
  
  const res = await client.query(`
    SELECT table_name 
    FROM information_schema.tables 
    WHERE table_schema = 'public'
    ORDER BY table_name;
  `);
  
  console.log("TABLES LIST:");
  console.log(res.rows.map(r => r.table_name));
  
  await client.end();
}

run().catch(console.error);
