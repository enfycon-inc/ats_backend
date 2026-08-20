const { Client } = require('pg');
const client = new Client({
  connectionString: "postgresql://postgres.zqpxnnsbbqdlhememsyj:EWhbqnM6IWe5IJaV@aws-1-ap-northeast-1.pooler.supabase.com:6543/postgres",
  ssl: { rejectUnauthorized: false }
});

async function run() {
  try {
    await client.connect();
    const branchRoles = {
      "c6dcb074-4fda-44e8-a8bf-7c337f0ca108": ["POD_LEAD", "ACCOUNT_MANAGER"],
      "4ca219ac-cb28-4a77-90dc-352158b2b772": ["BD MANAGER"]
    };
    const roles = ["BD MANAGER", "POD_LEAD", "ACCOUNT_MANAGER"];

    const res = await client.query(
      "UPDATE users SET branch_roles = $1, roles = $2 WHERE email = $3 RETURNING email, roles, branch_roles",
      [JSON.stringify(branchRoles), roles, "debam@deb.com"]
    );
    console.log("Successfully updated debam@deb.com:");
    console.log(JSON.stringify(res.rows[0], null, 2));
    await client.end();
  } catch (err) {
    console.error("Error updating user:", err);
  }
}

run();
