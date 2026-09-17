const { Client } = require('pg');

const client = new Client({
  connectionString: 'postgresql://ats_user:AtsDevPass2024@13.55.100.200:5432/ats_db',
});

async function main() {
  await client.connect();

  // Find all users with more than one entry in assigned_branch_ids
  const res = await client.query(`
    SELECT id, email, branch_id, assigned_branch_ids, branch_roles
    FROM ats.users
    WHERE branch_id IS NOT NULL
      AND array_length(assigned_branch_ids, 1) > 1
  `);

  console.log(`Found ${res.rows.length} users with multiple assigned_branch_ids`);

  let fixed = 0;
  for (const u of res.rows) {
    const primaryBranchId = u.branch_id;
    const oldAssigned = u.assigned_branch_ids;
    
    // Keep only the primary branch in assigned_branch_ids
    const newAssigned = [primaryBranchId];

    // Keep only branch_roles for the primary branch
    let branchRoles = u.branch_roles || {};
    const newBranchRoles = {};
    if (branchRoles[primaryBranchId]) {
      newBranchRoles[primaryBranchId] = branchRoles[primaryBranchId];
    }

    console.log(`\nFixing ${u.email}:`);
    console.log(`  assigned_branch_ids: ${JSON.stringify(oldAssigned)} -> ${JSON.stringify(newAssigned)}`);
    console.log(`  branch_roles keys: ${Object.keys(branchRoles).join(', ')} -> ${Object.keys(newBranchRoles).join(', ') || '(empty)'}`);

    await client.query(
      `UPDATE ats.users SET assigned_branch_ids = $1::uuid[], branch_roles = $2::jsonb WHERE id = $3`,
      [newAssigned, JSON.stringify(newBranchRoles), u.id]
    );
    fixed++;
  }

  // Also fix users where assigned_branch_ids is empty but branch_id exists
  const backfill = await client.query(`
    SELECT id, branch_id FROM ats.users
    WHERE branch_id IS NOT NULL
      AND (assigned_branch_ids IS NULL OR cardinality(assigned_branch_ids) = 0)
  `);
  console.log(`\nBackfilling ${backfill.rows.length} users with empty assigned_branch_ids...`);
  for (const u of backfill.rows) {
    await client.query(
      `UPDATE ats.users SET assigned_branch_ids = ARRAY[$1::uuid] WHERE id = $2`,
      [u.branch_id, u.id]
    );
  }

  console.log(`\n✅ Fixed ${fixed} multi-branch users, backfilled ${backfill.rows.length} users`);
  await client.end();
}

main().catch(console.error);
