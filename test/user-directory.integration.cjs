// Run with DIRECTORY_TEST_DATABASE_URL, or --emit to validate through a read-only SQL runner.
// Fixtures are CTEs, not inserts: this harness never modifies database records.
const assert = require('node:assert/strict');
require('ts-node').register({ transpileOnly: true });
const { UserManagementService } = require('../src/user-management/user-management.service');
const id = n => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const tenant = id(1), foreign = id(2), branch = id(3), unit = id(4), role = id(5);
const member = (n, name, extra = {}) => ({ id: id(n), tenant_id: tenant, branch_id: branch,
  business_unit_id: unit, full_name: name, email: `${name}@example.test`, city: 'BBSR',
  role_id: role, assigned_role_ids: [role], is_active: true, is_approved: true,
  created_at: '2026-01-01T00:00:00Z', ...extra });
const invite = (n, name, extra = {}) => ({ id: id(n), tenant_id: tenant, branch_id: branch,
  role_id: role, full_name: name, email: `${name}@example.test`, created_by: id(10),
  is_accepted: false, token_expires_at: '2099-01-01T00:00:00Z', created_at: '2026-01-01T00:00:00Z', ...extra });
const fixtures = {
  users: [member(10, 'Active'), member(11, 'Pending', { is_approved: false, requested_role: 'Recruiter' }),
    member(12, 'Blocked', { is_active: false }), member(13, 'Foreign', { tenant_id: foreign })],
  user_invitations: [invite(20, 'Invited'), invite(21, 'Expired', { token_expires_at: '2000-01-01T00:00:00Z' }),
    invite(22, 'Accepted', { is_accepted: true }), invite(23, 'Active'), invite(24, 'ForeignInvite', { tenant_id: foreign })],
  branches: [{ id: branch, tenant_id: tenant, name: 'Branch' }],
  business_units: [{ id: unit, tenant_id: tenant, branch_id: branch, name: 'Unit' }],
  custom_roles: [{ id: role, tenant_id: tenant, name: 'Recruiter', permissions: [] }],
};
const fixtureSql = Object.entries(fixtures).map(([table, rows]) =>
  `fixture_${table} AS (SELECT * FROM jsonb_populate_recordset(NULL::ats.${table}, '${JSON.stringify(rows).replaceAll("'", "''")}'))`).join(',\n');
function withFixtures(sql) {
  for (const table of Object.keys(fixtures)) sql = sql.replaceAll(`ats.${table}`, `fixture_${table}`);
  return sql.startsWith('WITH scoped') ? sql.replace('WITH scoped', `WITH ${fixtureSql}, scoped`) : `WITH ${fixtureSql} ${sql}`;
}
const cases = [
  { query: { state: 'pending' }, names: ['Invited', 'Pending'], total: 2 },
  { query: { state: 'pending', city: 'BBSR' }, names: ['Pending'], total: 1 },
  { query: { state: 'pending', search: 'Invited', role: 'Recruiter' }, names: ['Invited'], total: 1 },
  { query: { state: 'active', role: 'Recruiter' }, names: ['Active'], total: 1 },
  { query: { state: 'blocked' }, names: ['Blocked'], total: 1 },
  { query: { state: 'active', city: 'VIZAG' }, names: [], total: 0 },
  { query: { state: 'pending', pageSize: '1', page: '2' }, names: ['Pending'], total: 2 },
];
async function main() {
  const checks = [];
  for (const item of cases) {
    const calls = [];
    const db = { $queryRawUnsafe: async (sql, ...values) => {
      calls.push({ sql: withFixtures(sql), values });
      if (sql.includes('AS active')) return [{ active: 0, pending: 0, blocked: 0 }];
      if (sql.includes('AS count')) return [{ count: 0, cities: [], roles: [] }];
      return [];
    } };
    await new UserManagementService(db, { enabled: false }).list({ tenantId: tenant, dbId: id(10),
      permissions: ['user:manage', 'tenant:manage'] }, item.query);
    checks.push({ ...item, calls });
  }
  if (process.argv.includes('--emit')) { process.stdout.write(JSON.stringify(checks)); return; }
  if (!process.env.DIRECTORY_TEST_DATABASE_URL) throw new Error('Set DIRECTORY_TEST_DATABASE_URL to run the read-only PostgreSQL fixture checks.');
  const { Client } = require('pg');
  const client = new Client({ connectionString: process.env.DIRECTORY_TEST_DATABASE_URL });
  await client.connect();
  try {
    await client.query('BEGIN READ ONLY');
    await client.query('SET LOCAL statement_timeout=10000');
    for (const check of checks) {
      const results = [];
      for (const call of check.calls) results.push((await client.query(call.sql, call.values)).rows);
      assert.equal(results[2][0].count, check.total);
      assert.deepEqual(results[3].map(row => row.fullName), check.names);
      assert.deepEqual(results[2][0].roles, ['Recruiter']);
      const invited = results[3].find(row => row.kind === 'invitation');
      if (invited) {
        assert.equal(invited.branchName, 'Branch');
        assert.deepEqual(invited.assignedRoles, ['Recruiter']);
        assert.equal(invited.isApproved, false);
      }
    }
    console.log(`${checks.length} read-only PostgreSQL directory fixture checks passed.`);
  } finally { await client.query('ROLLBACK'); await client.end(); }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
