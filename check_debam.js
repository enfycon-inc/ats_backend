const { Client } = require('pg');

async function main() {
  const client = new Client({
    connectionString: 'postgresql://postgres.zqpxnnsbbqdlhememsyj:EWhbqnM6IWe5IJaV@aws-1-ap-northeast-1.pooler.supabase.com:6543/postgres',
    ssl: { rejectUnauthorized: false },
  });

  try {
    await client.connect();
    const res = await client.query("SELECT email, roles FROM users WHERE email='debam@deb.com'");
    console.log("DEBAM DB RECORD:", JSON.stringify(res.rows[0]));
  } catch (err) {
    console.error("DB ERROR:", err);
  } finally {
    await client.end();
  }
}

main();
