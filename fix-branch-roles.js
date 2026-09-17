const { Client } = require('pg');

const client = new Client({
  connectionString: 'postgresql://ats_user:AtsDevPass2024@13.55.100.200:5432/ats_db',
  searchPath: 'ats,public'
});

async function main() {
  await client.connect();

  // Find all users where branch_roles contains any non-UUID strings (like 'BDM', 'RECRUITER', etc.)
  const res = await client.query(`
    SELECT u.id, u.email, u.role_id, u.branch_roles
    FROM ats.users u
    WHERE u.branch_roles IS NOT NULL
      AND u.branch_roles::text != '{}'
      AND u.branch_roles::text != '[]'
  `);

  console.log(`Checking ${res.rows.length} users with branch_roles...`);

  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  // Build a lookup of role names -> UUIDs for the tenant
  const rolesRes = await client.query(`
    SELECT cr.id, cr.name, sr.system_key 
    FROM ats.custom_roles cr
    LEFT JOIN ats.system_roles sr ON sr.id = cr.system_role_id
  `);
  
  const roleNameToId = {};
  const roleSystemKeyToId = {};
  for (const r of rolesRes.rows) {
    if (r.name) roleNameToId[r.name.toUpperCase()] = r.id;
    if (r.system_key) roleSystemKeyToId[r.system_key.toUpperCase()] = r.id;
  }

  console.log('Role name->ID lookup:', roleNameToId);

  let fixedCount = 0;
  for (const u of res.rows) {
    let branchRoles = u.branch_roles;
    if (typeof branchRoles === 'string') branchRoles = JSON.parse(branchRoles);
    
    let needsFix = false;
    const fixed = {};

    for (const [branchId, roles] of Object.entries(branchRoles)) {
      if (!Array.isArray(roles)) continue;
      
      const cleanedRoles = [];
      for (const roleEntry of roles) {
        if (uuidPattern.test(roleEntry)) {
          // Valid UUID — keep it
          cleanedRoles.push(roleEntry);
        } else {
          // String role name — resolve to UUID
          const upper = roleEntry.toUpperCase();
          const resolved = roleNameToId[upper] || roleSystemKeyToId[upper];
          if (resolved) {
            console.log(`  [${u.email}] Resolving "${roleEntry}" -> ${resolved}`);
            if (!cleanedRoles.includes(resolved)) {
              cleanedRoles.push(resolved);
            }
            needsFix = true;
          } else {
            console.log(`  [${u.email}] WARNING: Cannot resolve "${roleEntry}" - skipping`);
            needsFix = true; // Remove it anyway
          }
        }
      }
      fixed[branchId] = cleanedRoles;
    }

    if (needsFix) {
      console.log(`\nFixing ${u.email}:`);
      console.log('  Before:', JSON.stringify(branchRoles));
      console.log('  After: ', JSON.stringify(fixed));
      
      await client.query(
        `UPDATE ats.users SET branch_roles = $1 WHERE id = $2`,
        [JSON.stringify(fixed), u.id]
      );
      fixedCount++;
    }
  }

  console.log(`\n✅ Fixed ${fixedCount} users with stale branch_roles data`);
  await client.end();
}

main().catch(console.error);
