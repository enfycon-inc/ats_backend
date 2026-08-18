const { Client } = require('pg');
const client = new Client({
  connectionString: "postgresql://postgres.zqpxnnsbbqdlhememsyj:EWhbqnM6IWe5IJaV@aws-1-ap-northeast-1.pooler.supabase.com:6543/postgres",
  ssl: { rejectUnauthorized: false }
});

async function inspectUser() {
  try {
    await client.connect();
    
    const userRes = await client.query("SELECT * FROM user_entity WHERE username = 'debam@deb.com'");
    console.log("=== USER_ENTITY RECORD IN SUPABASE ===");
    console.log(userRes.rows[0]);

    const credRes = await client.query("SELECT * FROM credential WHERE user_id = $1", [userRes.rows[0].id]);
    console.log("\n=== CREDENTIAL RECORDS IN SUPABASE ===");
    console.log(credRes.rows);

    const attrRes = await client.query("SELECT * FROM user_attribute WHERE user_id = $1", [userRes.rows[0].id]);
    console.log("\n=== USER_ATTRIBUTE RECORDS IN SUPABASE ===");
    console.log(attrRes.rows);

    const reqRes = await client.query("SELECT * FROM user_required_action WHERE user_id = $1", [userRes.rows[0].id]);
    console.log("\n=== USER_REQUIRED_ACTION RECORDS IN SUPABASE ===");
    console.log(reqRes.rows);

    await client.end();
  } catch (err) {
    console.error(err);
  }
}

inspectUser();
