const { Client } = require("pg");
const client = new Client({ connectionString: "postgresql://ats_user:AtsDevPass2024@13.55.100.200:5432/ats_db" });
async function run() {
  await client.connect();
  
  // 1. Get column names for system_roles table
  const cols = await client.query("SELECT column_name FROM information_schema.columns WHERE table_schema='ats' AND table_name='system_roles' ORDER BY ordinal_position");
  console.log("=== system_roles columns ===");
  console.log(JSON.stringify(cols.rows.map(r => r.column_name)));
  
  // 2. System roles - all columns
  const sysRoles = await client.query("SELECT * FROM ats.system_roles ORDER BY system_key");
  console.log("=== SYSTEM_ROLES ===");
  console.log(JSON.stringify(sysRoles.rows, null, 2));
  
  // 3. Custom roles for Deb Technology
  const customRoles = await client.query(
    "SELECT cr.id, cr.name, cr.system_role_id, sr.system_key, cr.permissions, cr.is_system FROM ats.custom_roles cr LEFT JOIN ats.system_roles sr ON sr.id = cr.system_role_id WHERE cr.tenant_id = $1 ORDER BY cr.name",
    ["737f666b-916a-4e9c-91bd-b2bd37e475d1"]
  );
  console.log("=== CUSTOM_ROLES for Deb Technology ===");
  console.log(JSON.stringify(customRoles.rows, null, 2));
  
  // 4. BRANCH_ADMIN role details
  const branchAdminPerms = await client.query(
    "SELECT cr.name, cr.permissions, sr.system_key FROM ats.custom_roles cr LEFT JOIN ats.system_roles sr ON sr.id = cr.system_role_id WHERE cr.tenant_id = $1 AND (sr.system_key = 'BRANCH_ADMIN' OR UPPER(cr.name) = 'BRANCH_ADMIN') ORDER BY cr.is_system DESC",
    ["737f666b-916a-4e9c-91bd-b2bd37e475d1"]
  );
  console.log("=== BRANCH_ADMIN Role Permissions ===");
  console.log(JSON.stringify(branchAdminPerms.rows, null, 2));
  
  await client.end();
}
run().catch(function(e) { console.error("DB Error:", e.message); });
