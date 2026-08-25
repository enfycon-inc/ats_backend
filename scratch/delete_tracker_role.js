const { Pool } = require('pg');
require('dotenv').config({ path: './.env' });

async function removeTrackerRole() {
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

    // 1. Find TRACKER role IDs
    const trackerRoles = await pool.query(`
      SELECT id, tenant_id, name FROM custom_roles 
      WHERE UPPER(name) = 'TRACKER' OR UPPER(system_role) = 'TRACKER'
    `);

    console.log(`Found ${trackerRoles.rows.length} TRACKER role record(s) in custom_roles.`);

    for (const role of trackerRoles.rows) {
      console.log(`Cleaning up TRACKER role ID=${role.id} (tenant=${role.tenant_id})...`);
      
      // Remove role_id from users and substitute with RECRUITER or NULL
      const fallbackRoleRes = await pool.query(`
        SELECT id FROM custom_roles 
        WHERE tenant_id = $1 AND (UPPER(name) = 'RECRUITER' OR UPPER(system_role) = 'RECRUITER')
        LIMIT 1
      `, [role.tenant_id]);
      
      const fallbackRoleId = fallbackRoleRes.rows[0]?.id || null;

      if (fallbackRoleId) {
        await pool.query('UPDATE users SET role_id = $1 WHERE role_id = $2', [fallbackRoleId, role.id]);
      } else {
        await pool.query('UPDATE users SET role_id = NULL WHERE role_id = $1', [role.id]);
      }

      // Remove 'TRACKER' from users.roles array
      await pool.query(
        `UPDATE users SET roles = array_remove(roles, 'TRACKER') WHERE tenant_id = $1 AND 'TRACKER' = ANY(roles)`,
        [role.tenant_id]
      );

      // Clear role permissions
      await pool.query('DELETE FROM role_permissions WHERE role_id = $1', [role.id]).catch(() => {});
      await pool.query('DELETE FROM user_roles WHERE role_id = $1', [role.id]).catch(() => {});

      // Delete custom_roles row
      await pool.query('DELETE FROM custom_roles WHERE id = $1', [role.id]);
      console.log(`Deleted TRACKER role ID=${role.id}.`);
    }

    console.log('\nTRACKER ROLE CLEANUP COMPLETED SUCCESSFULLY!');
  } catch (err) {
    console.error('Failed to remove TRACKER role:', err);
  } finally {
    await pool.end();
  }
}

removeTrackerRole();
