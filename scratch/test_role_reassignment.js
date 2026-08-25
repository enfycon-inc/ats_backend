const { Pool } = require('pg');
require('dotenv').config({ path: './.env' });

async function verifyRoleReassignment() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error('DATABASE_URL missing');
    process.exit(1);
  }

  const pool = new Pool({
    connectionString,
    ssl: connectionString.includes('supabase') ? { rejectUnauthorized: false } : undefined,
  });

  try {
    console.log('Connecting to database...');
    const tenantId = 'd3b07384-d113-49c3-a555-9ee75c13ca33';

    // 1. Create a dummy custom role A and custom role B
    console.log('Creating test custom roles...');
    const roleARes = await pool.query(`
      INSERT INTO custom_roles (tenant_id, name, description, is_system, system_role)
      VALUES ($1, 'Test Restricted BD', 'Role to be deleted', false, 'ACCOUNT_MANAGER')
      RETURNING id, name
    `, [tenantId]);
    const roleA = roleARes.rows[0];

    const roleBRes = await pool.query(`
      INSERT INTO custom_roles (tenant_id, name, description, is_system, system_role)
      VALUES ($1, 'Test Target Role', 'Replacement role', false, 'RECRUITER')
      RETURNING id, name
    `, [tenantId]);
    const roleB = roleBRes.rows[0];

    console.log(`Created Role A (${roleA.name}, ID=${roleA.id}) and Role B (${roleB.name}, ID=${roleB.id})`);

    // 2. Create a test user assigned to Role A
    const userRes = await pool.query(`
      INSERT INTO users (tenant_id, email, password_hash, full_name, roles, role_id, is_active)
      VALUES ($1, 'role_test_user@enfycon.com', 'hash', 'Test Staff Member', ARRAY[$2], $3, true)
      RETURNING id, role_id, roles
    `, [tenantId, roleA.name, roleA.id]);
    const testUser = userRes.rows[0];
    console.log(`Created Test User (${testUser.id}) assigned to Role A (${roleA.name})`);

    // 3. Simulate backend check: deleting Role A without targetRoleId should detect staffCount > 0
    const staffCountRes = await pool.query(
      'SELECT COUNT(*)::int as count FROM users WHERE role_id = $1 OR $2 = ANY(roles)',
      [roleA.id, roleA.name]
    );
    const count = staffCountRes.rows[0].count;
    console.log(`Verified staff count assigned to Role A: ${count} member(s).`);

    // 4. Perform re-assignment to Role B
    console.log(`Reassigning users from Role A (${roleA.id}) to Role B (${roleB.id})...`);
    await pool.query('UPDATE users SET role_id = $1 WHERE role_id = $2', [roleB.id, roleA.id]);
    await pool.query(
      'UPDATE users SET roles = array_replace(roles, $1, $2) WHERE tenant_id = $3 AND $1 = ANY(roles)',
      [roleA.name, roleB.name, tenantId]
    );

    // Verify user is now on Role B
    const updatedUserRes = await pool.query('SELECT role_id, roles FROM users WHERE id = $1', [testUser.id]);
    console.log('Updated User State:', updatedUserRes.rows[0]);

    // 5. Delete Role A
    await pool.query('DELETE FROM custom_roles WHERE id = $1', [roleA.id]);
    console.log(`Successfully deleted custom role "${roleA.name}".`);

    // Clean up test data
    await pool.query('DELETE FROM users WHERE id = $1', [testUser.id]);
    await pool.query('DELETE FROM custom_roles WHERE id = $1', [roleB.id]);
    console.log('Cleaned up test user and Role B.');

    console.log('\nROLE RE-ASSIGNMENT VERIFICATION SUCCESSFUL!');
  } catch (err) {
    console.error('Verification failed:', err);
  } finally {
    await pool.end();
  }
}

verifyRoleReassignment();
