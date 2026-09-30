const { Client } = require("pg");
const client = new Client({ connectionString: "postgresql://ats_user:AtsDevPass2024@13.55.100.200:5432/ats_db?schema=ats" });
client.connect().then(async () => {
  // Check test@enfycon.com user
  const user = await client.query(`SELECT email, branch_id, business_unit_id, system_role, role_id FROM ats.users WHERE email = 'test@enfycon.com'`);
  console.log("USER:", JSON.stringify(user.rows, null, 2));

  // Check what business units exist for the branch
  if (user.rows[0]?.branch_id) {
    const units = await client.query(`SELECT id, name, branch_id FROM ats.business_units WHERE branch_id = $1`, [user.rows[0].branch_id]);
    console.log("BUSINESS UNITS for branch:", JSON.stringify(units.rows, null, 2));
    
    // Check branches
    const branch = await client.query(`SELECT id, name FROM ats.branches WHERE id = $1`, [user.rows[0].branch_id]);
    console.log("BRANCH:", JSON.stringify(branch.rows, null, 2));
  }
  
  await client.end();
}).catch(console.error);
