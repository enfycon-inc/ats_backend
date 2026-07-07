const { Client } = require('pg');

async function run() {
  const client = new Client({
    connectionString: "postgresql://postgres.zqpxnnsbbqdlhememsyj:EWhbqnM6IWe5IJaV@aws-1-ap-northeast-1.pooler.supabase.com:6543/postgres"
  });

  try {
    await client.connect();
    console.log("CONNECTED TO DATABASE");
    const res = await client.query("SELECT id, client_code, client_name, primary_owner, created_by, created_at FROM clients WHERE client_code = 'CL_CL-003' OR client_code = 'CL-CL-003' OR client_name = 'deb technology'");
    console.log("CLIENTS FOUND:");
    console.log(JSON.stringify(res.rows, null, 2));
  } catch (err) {
    console.error(err);
  } finally {
    await client.end();
  }
}

run();
