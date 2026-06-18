const { Client } = require('pg');

async function run() {
  const client = new Client({
    connectionString: "postgresql://postgres.zqpxnnsbbqdlhememsyj:EWhbqnM6IWe5IJaV@aws-1-ap-northeast-1.pooler.supabase.com:6543/postgres",
    ssl: { rejectUnauthorized: false }
  });

  await client.connect();
  
  const userRes = await client.query(`SELECT email, tenant_id FROM users`);
  console.log("Users in DB:", userRes.rows);
  
  const clientRes = await client.query(`SELECT COUNT(*), tenant_id FROM clients GROUP BY tenant_id`);
  console.log("Clients grouped by tenant_id:", clientRes.rows);
  
  await client.end();
}

run();
