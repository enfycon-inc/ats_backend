const { Client } = require("pg");
const client = new Client({ connectionString: "postgresql://ats_user:AtsDevPass2024@13.55.100.200:5432/ats_db" });
async function run() {
  await client.connect();
  const sysRoles = await client.query("SELECT id, system_key, name FROM ats.system_roles ORDER BY system_key");
  console.log("=== SYSTEM_ROLES ===");
  console.log(JSON.stringify(sysRoles.rows, null, 2));
  const branchAdmin = await client.query(
    "SELECT cr.id, cr.name, cr.permissions, sr.system_key, cr.is_system FROM ats.custom_roles cr LEFT JOIN ats.system_roles sr ON sr.id = cr.system_role_id WHERE cr.tenant_id = $1 AND sr.system_key = 'BRANCH_ADMIN' ORDER BY cr.is_system DESC",
    ["737f666b-916a-4e9c-91bd-b2bd37e475d1"]
  );
  console.log("=== BRANCH_ADMIN Role(s) ===");
  console.log(JSON.stringify(branchAdmin.rows, null, 2));
  const branchAdminHasUserManage = branchAdmin.rows.some(r => {
    const perms = Array.isArray(r.permissions) ? r.permissions : JSON.parse(r.permissions || "[]");
    return perms.includes("user:manage");
  });
  console.log("BRANCH_ADMIN has user:manage?", branchAdminHasUserManage);
  const branchAdminHasTenantSettings = branchAdmin.rows.some(r => {
    const perms = Array.isArray(r.permissions) ? r.permissions : JSON.parse(r.permissions || "[]");
    return perms.includes("tenant:settings");
  });
  console.log("BRANCH_ADMIN has tenant:settings?", branchAdminHasTenantSettings);
  await client.end();
}
run().catch(function(e) { console.error("DB Error:", e.message); });
