const { Client } = require('pg');
const client = new Client({
  connectionString: "postgresql://postgres.zqpxnnsbbqdlhememsyj:EWhbqnM6IWe5IJaV@aws-1-ap-northeast-1.pooler.supabase.com:6543/postgres",
  ssl: { rejectUnauthorized: false }
});

async function run() {
  try {
    await client.connect();
    
    // Check keycloak tables
    const tablesRes = await client.query(
      "SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name LIKE 'user_%' OR table_name LIKE 'realm%' OR table_name LIKE 'client%'"
    );
    console.log("=== KEYCLOAK TABLES IN SUPABASE ===");
    console.log(tablesRes.rows.map(r => r.table_name));

    // Check user_entity table (Keycloak Users)
    const usersRes = await client.query("SELECT id, username, email, realm_id FROM user_entity LIMIT 10");
    console.log("\n=== KEYCLOAK USERS IN SUPABASE DB ===");
    console.log(usersRes.rows);

    // Check realm table
    const realmRes = await client.query("SELECT id, name FROM realm");
    console.log("\n=== REALMS IN SUPABASE DB ===");
    console.log(realmRes.rows);

    await client.end();
  } catch (err) {
    console.error("Verification failed:", err.message);
  }
}
run();
