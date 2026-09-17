const { Client } = require('pg');

const client = new Client({
  connectionString: 'postgresql://ats_user:AtsDevPass2024@13.55.100.200:5432/ats_db',
});

async function main() {
  await client.connect();

  const res = await client.query(`
    SELECT id, email, role_id, assigned_role_ids, branch_roles 
    FROM ats.users 
    WHERE branch_roles IS NOT NULL AND branch_roles::text != '{}'
  `);

  console.log(`Checking ${res.rows.length} users with branch_roles...`);
  
  let mismatchCount = 0;
  for (const u of res.rows) {
    const branchRolesObj = u.branch_roles;
    let bRoles = [];
    for (const roles of Object.values(branchRolesObj)) {
      if (Array.isArray(roles)) bRoles.push(...roles);
    }
    
    // Deduplicate
    bRoles = Array.from(new Set(bRoles));
    const assignedRoles = u.assigned_role_ids || [];
    
    // Check if bRoles are all in assignedRoles
    const missingInAssigned = bRoles.filter(r => !assignedRoles.includes(r));
    
    if (missingInAssigned.length > 0) {
      console.log(`\nUser: ${u.email}`);
      console.log(`  branch_roles has: ${bRoles}`);
      console.log(`  assigned_role_ids has: ${assignedRoles}`);
      console.log(`  MISSING in assigned_role_ids: ${missingInAssigned}`);
      mismatchCount++;
    }
  }

  console.log(`\nFound ${mismatchCount} users where branch_roles has roles NOT in assigned_role_ids.`);
  
  await client.end();
}

main().catch(console.error);
