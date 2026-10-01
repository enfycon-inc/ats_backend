const { Client } = require("pg");
const client = new Client({ connectionString: "postgresql://ats_user:AtsDevPass2024@13.55.100.200:5432/ats_db?schema=ats" });

async function checkAdmin() {
  await client.connect();
  const res = await client.query(`SELECT id, email, tenant_id FROM ats.users WHERE email = 'admin@enfycon.com';`);
  console.log("ADMIN:", res.rows);
  await client.end();
}

checkAdmin().catch(console.error);
