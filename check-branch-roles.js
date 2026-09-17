const { Client } = require('pg');

const client = new Client({
  connectionString: 'postgresql://ats_user:AtsDevPass2024@13.55.100.200:5432/ats_db',
  searchPath: 'ats,public'
});

async function main() {
  await client.connect();

  // Find user with 'am' or 'deb' in email
  const userRes = await client.query(`
    SELECT 
      u.id,
      u.email,
      u.role_id,
      u.assigned_role_ids,
      u.branch_roles,
      cr.name as role_name,
      sr.system_key as system_role
    FROM ats.users u
    LEFT JOIN ats.custom_roles cr ON cr.id = u.role_id
    LEFT JOIN ats.system_roles sr ON sr.id = cr.system_role_id
    WHERE u.email ILIKE '%am%' AND u.email ILIKE '%deb%'
    LIMIT 5
  `);

  console.log('Found users:', userRes.rows.length);

  for (const u of userRes.rows) {
    console.log('\n=== User:', u.email);
    console.log('Primary role_id:', u.role_id);
    console.log('Primary role name:', u.role_name, '(', u.system_role, ')');
    console.log('assigned_role_ids:', JSON.stringify(u.assigned_role_ids));
    console.log('\nbranch_roles (raw):');
    console.log(JSON.stringify(u.branch_roles, null, 2));
  }

  // Also show any user whose branch_roles contains 'BDM' text
  const bdmRes = await client.query(`
    SELECT u.email, u.role_id, u.assigned_role_ids, u.branch_roles
    FROM ats.users u
    WHERE u.branch_roles::text ILIKE '%BDM%'
    LIMIT 5
  `);
  
  if (bdmRes.rows.length > 0) {
    console.log('\n\n=== Users with BDM in branch_roles ===');
    for (const u of bdmRes.rows) {
      console.log('\nEmail:', u.email);
      console.log('branch_roles:', JSON.stringify(u.branch_roles, null, 2));
    }
  }

  await client.end();
}

main().catch(console.error);
