/**
 * clean_and_reseed.js
 * 
 * Wipes all user/tenant data from ATS DB (tables stay intact),
 * deletes all Keycloak users (except system accounts),
 * then the backend will auto-reseed the Super Admin on next boot.
 */

require('dotenv').config({ path: 'c:/Users/deb/enfyProjects/ATS_DOCKERREPO/ats_backend/.env' });
const { Pool } = require('pg');
const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));

// Hardcode the remote DB URL directly as a fallback
const DB_URL = process.env.DATABASE_URL ||
  'postgresql://ats_user:AtsDevPass2024@13.55.100.200:5432/ats_db?schema=ats&options=-csearch_path%3Dats,mass_mail,public';


// ─── DB ───────────────────────────────────────────────────────────────────────
async function wipeAtsData() {
  const pool = new Pool({ connectionString: DB_URL });
  console.log('🔌 Connected to ATS DB...');

  const client = await pool.connect();
  try {
    // Delete each table independently so one missing table doesn't abort everything
    const tables = [
      'ats.recruiter_submissions',
      'ats.candidates',
      'ats.client_contacts',
      'ats.clients',
      'ats.jobs',
      'ats.custom_roles',
      'ats.business_units',
      'ats.pods',
      'ats.branches',
      'ats.users',
      'ats.tenant_domains',
      'ats.tenant_auth_settings',
      'ats.tenants',
      'ats.system_roles',
      'mass_mail.campaigns',
      'mass_mail.recipients',
      'mass_mail.templates',
      'mass_mail.email_accounts',
      'mass_mail.email_preferences',
      'mass_mail.delivery_settings',
    ];

    for (const table of tables) {
      try {
        const res = await client.query(`DELETE FROM ${table}`);
        console.log(`  ✅ Cleared ${table} (${res.rowCount} rows)`);
      } catch (err) {
        console.log(`  ⚠️  Skipped ${table}: ${err.message}`);
      }
    }

    console.log('✅ ATS DB wiped successfully. All tables intact.');
  } catch (err) {
    console.error('❌ ATS DB wipe failed:', err.message);
  } finally {
    client.release();
    await pool.end();
  }
}

// ─── KEYCLOAK ─────────────────────────────────────────────────────────────────
async function wipeKeycloakUsers() {
  const adminUrl = process.env.KEYCLOAK_INTERNAL_URL || 'https://auth.enfyjobs.com';
  const adminUser = process.env.KEYCLOAK_ADMIN || 'admin';
  const adminPass = process.env.KEYCLOAK_ADMIN_PASSWORD || 'admin';
  const issuer = process.env.KEYCLOAK_ISSUER || 'https://auth.enfyjobs.com/realms/enfycon-ats';
  const realm = issuer.split('/realms/')[1] || 'enfycon-ats';

  console.log(`\n🔐 Getting Keycloak admin token from ${adminUrl}...`);

  // Get admin token
  const tokenRes = await fetch(`${adminUrl}/realms/master/protocol/openid-connect/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'password',
      client_id: 'admin-cli',
      username: adminUser,
      password: adminPass,
    }).toString(),
  });

  if (!tokenRes.ok) {
    const body = await tokenRes.text();
    console.error('❌ Could not get Keycloak admin token:', body);
    return;
  }

  const { access_token } = await tokenRes.json();
  console.log('  ✅ Admin token obtained.');

  // Get all users in the ATS realm
  const usersRes = await fetch(`${adminUrl}/admin/realms/${realm}/users?max=200`, {
    headers: { Authorization: `Bearer ${access_token}` },
  });

  if (!usersRes.ok) {
    console.error('❌ Could not list Keycloak users:', await usersRes.text());
    return;
  }

  const users = await usersRes.json();
  console.log(`  Found ${users.length} users in realm "${realm}"`);

  // Skip system/service accounts
  const SKIP_USERNAMES = ['service-account-enfycon-ats', 'admin'];

  let deleted = 0;
  for (const user of users) {
    if (SKIP_USERNAMES.includes(user.username)) {
      console.log(`  ⏭️  Skipping system account: ${user.username}`);
      continue;
    }
    const delRes = await fetch(`${adminUrl}/admin/realms/${realm}/users/${user.id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${access_token}` },
    });
    if (delRes.ok || delRes.status === 204) {
      console.log(`  ✅ Deleted Keycloak user: ${user.email || user.username}`);
      deleted++;
    } else {
      console.log(`  ⚠️  Failed to delete ${user.email || user.username}: ${delRes.status}`);
    }
  }

  console.log(`\n✅ Keycloak cleanup done. Deleted ${deleted} users.`);
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log('═══════════════════════════════════════════════════');
  console.log('  EnfyATS — Full Clean Slate (data only, no DDL)  ');
  console.log('═══════════════════════════════════════════════════\n');

  await wipeAtsData();
  await wipeKeycloakUsers();

  console.log('\n🚀 Done! The backend will auto-reseed the Super Admin on next container restart.');
  console.log('   Email:    admin@enfycon.com');
  console.log('   Password: enfycon123  (Keycloak password, set at boot)');
}

main().catch(console.error);
