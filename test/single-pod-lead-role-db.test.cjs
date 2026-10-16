// Run only against an explicitly supplied, empty disposable PostgreSQL test database.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { Client } = require('pg');
const url = process.env.POD_ROLE_TEST_DATABASE_URL;
test('database guard serializes simultaneous custom-role creation and isolates tenants', { skip: !url }, async () => {
  const admin = new Client({ connectionString: url });
  const second = new Client({ connectionString: url });
  let ownedSchema = false;
  const a = '11111111-1111-4111-8111-111111111111';
  const b = '22222222-2222-4222-8222-222222222222';
  const system = '33333333-3333-4333-8333-333333333333';
  const role1 = '44444444-4444-4444-8444-444444444444';
  const role2 = '55555555-5555-4555-8555-555555555555';
  const insert = `INSERT INTO ats.custom_roles(id,tenant_id,system_role_id,name) VALUES($1,$2,$3,$4)`;
  try {
    await admin.connect();
    assert.match(new URL(url).pathname, /_test$/i, 'Use a disposable database ending in _test');
    assert.equal((await admin.query("SELECT to_regnamespace('ats') AS existing")).rows[0].existing, null, 'Database must not contain the application schema');
    await admin.query('CREATE SCHEMA ats');
    ownedSchema = true;
    await admin.query(`CREATE TABLE ats.system_roles(id uuid PRIMARY KEY,system_key text);
      CREATE TABLE ats.custom_roles(id uuid PRIMARY KEY,tenant_id uuid,system_role_id uuid,is_system boolean DEFAULT false,branch_id uuid,business_unit_id uuid,name text);`);
    await admin.query('INSERT INTO ats.system_roles VALUES($1,$2)', [system, 'POD_LEAD']);
    await admin.query(fs.readFileSync('prisma/migrations/20261016090000_single_custom_pod_lead_role/migration.sql', 'utf8'));
    await second.connect();
    await second.query("SET statement_timeout='5s'");
    await admin.query('BEGIN');
    await admin.query(insert, [role1,a,system,'Recruitment Captain']);
    // Start and observe rejection immediately, avoiding unhandled rejected promises.
    const rejected = assert.rejects(second.query(insert, [role2,a,system,'Team Lead']), { code: '23505' });
    await admin.query('COMMIT');
    await rejected;
    assert.equal((await admin.query('SELECT count(*)::int AS count FROM ats.custom_roles WHERE tenant_id=$1 AND is_system=false', [a])).rows[0].count, 1);
    await admin.query(insert, [role2,b,system,'Different tenant name']);
    await assert.rejects(admin.query('UPDATE ats.custom_roles SET tenant_id=$1 WHERE id=$2', [a,role2]), { code: '23505' });
    await assert.rejects(admin.query('UPDATE ats.custom_roles SET branch_id=$1 WHERE id=$2', [a,role1]), { code: '23514' });
    await admin.query('UPDATE ats.custom_roles SET name=$1 WHERE id=$2', ['Talent Lead',role1]);
  } finally {
    await admin.query('ROLLBACK').catch(() => {});
    await second.end().catch(() => {});
    if (ownedSchema) await admin.query('DROP SCHEMA ats CASCADE');
    await admin.end();
  }
});
