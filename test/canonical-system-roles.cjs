// Integration check: session-local temporary tables only; no application tables are modified.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const { Client } = require('pg');
require('dotenv').config({ quiet: true });
const mod = { exports: {} };
new Function('exports', ts.transpileModule(fs.readFileSync('src/auth/services/canonical-system-roles.ts','utf8'), {compilerOptions: {module: ts.ModuleKind.CommonJS}}).outputText)(mod.exports);
const sql = mod.exports.CANONICAL_SYSTEM_ROLES_SQL.replaceAll('ats.', 'pg_temp.');
(async () => {
 const c = new Client({connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 5000});
 try {
  await c.connect();
  await c.query('BEGIN');
  await c.query(`CREATE TEMP TABLE system_roles(id uuid primary key, name text unique, system_key text unique, updated_at timestamptz);
   CREATE TEMP TABLE custom_roles(id uuid primary key, tenant_id uuid, name text, is_system boolean, system_role_id uuid references system_roles(id), permissions jsonb);
   CREATE TEMP TABLE user_invitations(system_role_id uuid references system_roles(id));`);
  const legacy='00000000-0000-0000-0000-000000000001',canonical='00000000-0000-0000-0000-000000000002',role='00000000-0000-0000-0000-000000000003';
  for (const both of [false,true]) {
   await c.query('TRUNCATE pg_temp.user_invitations, pg_temp.custom_roles, pg_temp.system_roles');
   await c.query("INSERT INTO pg_temp.system_roles VALUES ($1,'Admin','ADMIN',now())",[legacy]);
   if(both) await c.query("INSERT INTO pg_temp.system_roles VALUES ($1,'Tenant Admin','TENANT_ADMIN',now())",[canonical]);
   await c.query("INSERT INTO pg_temp.custom_roles VALUES ($1,$1,'Admin',true,$2,'[]')",[role,legacy]);
   await c.query('INSERT INTO pg_temp.user_invitations VALUES ($1)',[legacy]);
   if(both) await c.query("INSERT INTO pg_temp.custom_roles VALUES ($1,$2,'Tenant Admin',true,$3,'[]')",[canonical,role,canonical]);
   await c.query(sql);
   await c.query(sql);
   assert.equal((await c.query("SELECT count(*)::int n FROM pg_temp.system_roles WHERE system_key='ADMIN'")).rows[0].n,0);
   assert.equal((await c.query("SELECT count(*)::int n FROM pg_temp.system_roles WHERE system_key='TENANT_ADMIN'")).rows[0].n,1);
   const r=(await c.query('SELECT * FROM pg_temp.custom_roles WHERE id=$1',[role])).rows[0];
   assert.equal(r.system_role_id,both?canonical:legacy);
   assert.deepEqual(r.permissions,[]);
   assert.ok(r.name.startsWith('Tenant Admin'));
   assert.equal((await c.query('SELECT system_role_id FROM pg_temp.user_invitations')).rows[0].system_role_id,both?canonical:legacy);
  }
  await c.query('ROLLBACK');
  console.log('PASS: legacy-only, duplicate roles, FK references, permission preservation, and idempotence (temporary tables only)');
 } finally { await c.end(); }
})().catch(e=>{ console.error('Migration test failed:', e.code || e.message); process.exitCode=1; });
