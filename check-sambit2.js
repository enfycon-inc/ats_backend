const { Client } = require("pg");
const client = new Client({ connectionString: "postgresql://ats_user:AtsDevPass2024@13.55.100.200:5432/ats_db?schema=ats" });
client.connect().then(async () => {
  // Check for duplicate users - this is the global uniqueness issue!
  const users = await client.query(`SELECT id, email, tenant_id, branch_id, business_unit_id, role_id, is_active FROM ats.users WHERE email = 'sambit@enfycon.com' ORDER BY created_at ASC`);
  console.log("ALL ROWS for sambit@enfycon.com:", JSON.stringify(users.rows, null, 2));
  
  // Check both roles
  for (const u of users.rows) {
    if (u.role_id) {
      const role = await client.query(`SELECT id, name FROM ats.custom_roles WHERE id = $1`, [u.role_id]);
      console.log(`Tenant ${u.tenant_id} -> Role: ${role.rows[0]?.name}, branch: ${u.branch_id}, bu: ${u.business_unit_id}`);
    }
  }
  
  await client.end();
}).catch(console.error);
