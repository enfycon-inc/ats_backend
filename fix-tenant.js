const { Client } = require('pg');

async function run() {
  const client = new Client({
    connectionString: "postgresql://postgres.zqpxnnsbbqdlhememsyj:EWhbqnM6IWe5IJaV@aws-1-ap-northeast-1.pooler.supabase.com:6543/postgres",
    ssl: { rejectUnauthorized: false }
  });

  await client.connect();
  
  // Try to find the tenant_id from users table
  const userRes = await client.query(`SELECT tenant_id FROM users WHERE email = 'recruiter@enfycon.com' LIMIT 1`);
  let tenantId = 'd3b07384-d113-49c3-a555-9ee75c13ca33';
  if (userRes.rows.length > 0) {
    tenantId = userRes.rows[0].tenant_id;
  }
  
  await client.query(`UPDATE clients SET tenant_id = $1`, [tenantId]);
  console.log("Updated clients tenant_id to:", tenantId);
  await client.end();
}

run();
