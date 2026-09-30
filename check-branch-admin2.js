const { Client } = require("pg");
const client = new Client({ connectionString: "postgresql://ats_user:AtsDevPass2024@13.55.100.200:5432/ats_db?schema=ats" });
client.connect().then(async () => {
  const user = await client.query(`SELECT email, branch_id, business_unit_id, role_id FROM ats.users WHERE email = 'test@enfycon.com'`);
  console.log("USER:", JSON.stringify(user.rows, null, 2));

  if (user.rows[0]?.branch_id) {
    const units = await client.query(`SELECT id, name, branch_id FROM ats.business_units WHERE branch_id = $1`, [user.rows[0].branch_id]);
    console.log("BUSINESS UNITS:", JSON.stringify(units.rows, null, 2));
    const branch = await client.query(`SELECT id, name FROM ats.branches WHERE id = $1`, [user.rows[0].branch_id]);
    console.log("BRANCH:", JSON.stringify(branch.rows, null, 2));
  }

  // What custom role does this user have?
  if (user.rows[0]?.role_id) {
    const role = await client.query(`SELECT id, name, permissions FROM ats.custom_roles WHERE id = $1`, [user.rows[0].role_id]);
    console.log("ROLE:", role.rows[0]?.name);
    const perms = typeof role.rows[0]?.permissions === 'string' ? JSON.parse(role.rows[0].permissions) : role.rows[0]?.permissions;
    console.log("PERMS includes user:manage:", perms?.includes('user:manage'));
    console.log("PERMS includes branch_admin:manage:", perms?.includes('branch_admin:manage'));
  }
  
  await client.end();
}).catch(console.error);
