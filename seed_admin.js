// Manually seed the platform super admin into ATS DB
// Run from ats_backend directory
require('dotenv').config({ path: './.env' });
const { Pool } = require('pg');

const DB_URL = process.env.DATABASE_URL || 
  'postgresql://ats_user:AtsDevPass2024@13.55.100.200:5432/ats_db?schema=ats&options=-csearch_path%3Dats,mass_mail,public';

const DEFAULT_TENANT_ID = process.env.DEFAULT_TENANT_ID || 'd3b07384-d113-49c3-a555-9ee75c13ca33';
const ADMIN_EMAIL = process.env.PLATFORM_ADMIN_EMAIL || 'admin@enfycon.com';
const ADMIN_NAME = process.env.PLATFORM_ADMIN_NAME || 'Enfy Super Admin';
const ADMIN_USER_ID = '1d4ac532-4229-4c95-9b11-af573060020b';

async function main() {
  const pool = new Pool({ connectionString: DB_URL });
  const client = await pool.connect();

  try {
    console.log('Connected to ATS DB...');

    // 1. Ensure system_roles exist
    await client.query(`
      INSERT INTO system_roles (id, name, system_key, description, permissions) VALUES
        (gen_random_uuid(), 'Super Admin', 'SUPER_ADMIN', 'Platform Super Admin', '["*"]'),
        (gen_random_uuid(), 'Tenant Admin', 'TENANT_ADMIN', 'Company Admin', '[]'),
        (gen_random_uuid(), 'Branch Admin', 'BRANCH_ADMIN', 'Branch Admin', '[]'),
        (gen_random_uuid(), 'Account Manager', 'ACCOUNT_MANAGER', 'Account Manager', '[]'),
        (gen_random_uuid(), 'Recruiter', 'RECRUITER', 'Recruiter', '[]')
      ON CONFLICT (system_key) DO NOTHING
    `);
    console.log('✅ System roles ensured');

    // 2. Get or create SUPER_ADMIN role for the default tenant
    let superAdminRoleId;
    const existingRole = await client.query(
      `SELECT cr.id FROM custom_roles cr 
       JOIN system_roles sr ON cr.system_role_id = sr.id 
       WHERE cr.tenant_id = $1 AND sr.system_key = 'SUPER_ADMIN' LIMIT 1`,
      [DEFAULT_TENANT_ID]
    );

    if (existingRole.rows.length > 0) {
      superAdminRoleId = existingRole.rows[0].id;
      console.log('✅ SUPER_ADMIN role exists:', superAdminRoleId);
    } else {
      const sysRole = await client.query(`SELECT id FROM system_roles WHERE system_key = 'SUPER_ADMIN' LIMIT 1`);
      const sysRoleId = sysRole.rows[0]?.id;
      const newRole = await client.query(
        `INSERT INTO custom_roles (tenant_id, name, description, is_system, permissions, system_role_id)
         VALUES ($1, 'SUPER_ADMIN', 'Platform Super Admin', true, '["*"]', $2)
         ON CONFLICT DO NOTHING RETURNING id`,
        [DEFAULT_TENANT_ID, sysRoleId]
      );
      superAdminRoleId = newRole.rows[0]?.id;
      console.log('✅ SUPER_ADMIN role created:', superAdminRoleId);
    }

    // 3. Ensure tenant_auth_settings allow password login
    await client.query(`
      INSERT INTO tenant_auth_settings (tenant_id, allow_password_login, allow_microsoft_sso, allow_google_sso, enforce_sso_only)
      VALUES ($1, true, true, true, false)
      ON CONFLICT (tenant_id) DO UPDATE SET allow_password_login = true, enforce_sso_only = false
    `, [DEFAULT_TENANT_ID]);
    console.log('✅ Tenant auth settings ensured (password login enabled)');

    // 4. Upsert the super admin user
    await client.query(`
      INSERT INTO users (id, tenant_id, email, full_name, is_active, is_approved, role_id, assigned_role_ids, keycloak_id)
      VALUES ($1, $2, $3, $4, true, true, $5, ARRAY[$5::uuid], $1)
      ON CONFLICT (id) DO UPDATE SET
        is_active = true,
        is_approved = true,
        role_id = EXCLUDED.role_id,
        assigned_role_ids = EXCLUDED.assigned_role_ids,
        email = EXCLUDED.email
    `, [ADMIN_USER_ID, DEFAULT_TENANT_ID, ADMIN_EMAIL, ADMIN_NAME, superAdminRoleId]);
    console.log('✅ Super admin user seeded:', ADMIN_EMAIL);

    // Verify
    const check = await client.query('SELECT id, email, is_active, is_approved FROM users WHERE email = $1', [ADMIN_EMAIL]);
    console.log('\n📋 User in DB:', JSON.stringify(check.rows[0], null, 2));

    console.log('\n🚀 Done! You can now log in with:');
    console.log('   Email:   ', ADMIN_EMAIL);
    console.log('   Password: enfycon123  (as set in Keycloak)');

  } catch (err) {
    console.error('❌ Error:', err.message);
  } finally {
    client.release();
    await pool.end();
  }
}

main();
