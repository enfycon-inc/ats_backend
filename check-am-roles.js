const { Client } = require('pg');

const client = new Client({
  connectionString: 'postgresql://ats_user:AtsDevPass2024@13.55.100.200:5432/ats_db',
});

async function main() {
  await client.connect();

  // Show am@deb.com branch_roles after fix, with role names
  const res = await client.query(`
    SELECT u.email, u.role_id, u.assigned_role_ids, u.branch_roles
    FROM ats.users u
    WHERE u.email = 'am@deb.com'
  `);

  const u = res.rows[0];
  console.log('Email:', u.email);
  console.log('Primary role_id:', u.role_id);
  console.log('assigned_role_ids:', u.assigned_role_ids);
  
  const branchRoles = u.branch_roles;
  for (const [branchId, roles] of Object.entries(branchRoles)) {
    console.log('\nBranch:', branchId);
    
    // Resolve branch name
    const bRes = await client.query(`SELECT name FROM ats.branches WHERE id = $1`, [branchId]);
    console.log('Branch name:', bRes.rows[0]?.name || 'NOT FOUND');
    
    console.log('Assigned roles in this branch:');
    for (const rId of roles) {
      const rRes = await client.query(`
        SELECT cr.name, sr.system_key, cr.permissions
        FROM ats.custom_roles cr
        LEFT JOIN ats.system_roles sr ON sr.id = cr.system_role_id
        WHERE cr.id = $1
      `, [rId]);
      const role = rRes.rows[0];
      if (role) {
        console.log(`  - ${role.name} (${role.system_key}) | permissions: ${(role.permissions || []).length}`);
      } else {
        console.log(`  - UNKNOWN role: ${rId}`);
      }
    }
  }

  await client.end();
}

main().catch(console.error);
