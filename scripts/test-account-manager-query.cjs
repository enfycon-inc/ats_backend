// Run against an isolated, disposable PostgreSQL container with synthetic data.
// docker run --rm -d --name codex-am-dashboard-test --network none -e POSTGRES_HOST_AUTH_METHOD=trust postgres:16-alpine
// node scripts/test-account-manager-query.cjs codex-am-dashboard-test
// docker stop codex-am-dashboard-test
require('ts-node/register/transpile-only');
const { spawnSync } = require('node:child_process');
const assert = require('node:assert/strict');
const { AccountManagerDashboardService } = require('../src/business-units/account-manager-dashboard.service');
const { AccountManagerDetailService } = require('../src/business-units/account-manager-detail.service');
const container = process.argv[2];
if (!container || !/^codex-am-dashboard-test$/.test(container)) throw new Error('An isolated dashboard test container is required.');
const uuid = n => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
function sql(query) {
  const result = spawnSync('docker', ['exec', '-i', container, 'psql', '-U', 'postgres', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1'], { input: query, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr || result.error?.message);
  return result.stdout.trim();
}
const literal = value => value === null ? 'NULL' : typeof value === 'boolean' ? String(value) : typeof value === 'number' ? String(value) : `'${(value instanceof Date ? value.toISOString() : String(value)).replace(/'/g, "''")}'`;
sql(`
  DROP SCHEMA IF EXISTS ats CASCADE;
  CREATE SCHEMA ats;
  CREATE TABLE ats.system_roles(id uuid PRIMARY KEY, system_key text);
  CREATE TABLE ats.custom_roles(id uuid PRIMARY KEY, tenant_id uuid, system_role_id uuid, base_role_id uuid);
  CREATE TABLE ats.users(id uuid PRIMARY KEY, tenant_id uuid, branch_id uuid, business_unit_id uuid, full_name text,
    is_active boolean, is_approved boolean, role_id uuid, assigned_role_ids uuid[], email text DEFAULT 'manager@example.test', profile_picture text);
  CREATE TABLE ats.clients(id uuid PRIMARY KEY, tenant_id uuid, client_name text, created_by uuid, created_at timestamptz DEFAULT '2026-10-03', status text DEFAULT 'Active', branch_id uuid, primary_owner text, deleted_at timestamptz);
  CREATE TABLE ats.jobs(id uuid PRIMARY KEY, tenant_id uuid, branch_id uuid, business_unit_id uuid, account_manager_id uuid,
    client_id uuid, market text, job_type text, status text, approval_status text, deleted_at timestamptz, no_of_positions int DEFAULT 2, approved_at timestamptz DEFAULT '2026-10-01T00:00:00Z', job_title text DEFAULT 'Synthetic Job', job_code text DEFAULT 'JOB-TEST');
  CREATE TABLE ats.recruiter_submissions(id uuid PRIMARY KEY, tenant_id uuid, job_id uuid, final_status text, l1_status text, l2_status text, l3_status text, created_at timestamptz DEFAULT '2026-10-10T00:00:00Z');
  CREATE TABLE ats.submission_events(tenant_id uuid, submission_id uuid, kind text, details jsonb, created_at timestamptz);
  INSERT INTO ats.system_roles VALUES ('${uuid(10)}', 'ACCOUNT_MANAGER');
  INSERT INTO ats.custom_roles VALUES ('${uuid(11)}', '${uuid(1)}', '${uuid(10)}', NULL), ('${uuid(12)}', '${uuid(1)}', NULL, '${uuid(11)}');
  INSERT INTO ats.clients VALUES ('${uuid(20)}', '${uuid(1)}', 'Synthetic Client');
  ${Array.from({ length: 11 }, (_, i) => `INSERT INTO ats.users VALUES ('${uuid(100 + i)}', '${uuid(1)}', '${uuid(2)}', '${uuid(3)}', 'Manager ${i}', true, true,
    ${i % 2 ? 'NULL' : `'${uuid(11)}'`}, ARRAY['${uuid(12)}']::uuid[]);`).join('\n')}
  INSERT INTO ats.users VALUES ('${uuid(200)}', '${uuid(9)}', '${uuid(2)}', '${uuid(3)}', 'Foreign manager', true, true, '${uuid(11)}', '{}');
  INSERT INTO ats.jobs VALUES
    ('${uuid(300)}', '${uuid(1)}', '${uuid(2)}', '${uuid(3)}', '${uuid(100)}', '${uuid(20)}', 'INDIA', 'Full Time', 'Active', 'APPROVED', NULL),
    ('${uuid(301)}', '${uuid(1)}', '${uuid(2)}', '${uuid(3)}', '${uuid(100)}', '${uuid(20)}', 'US', 'Contract', 'CLOSED', 'APPROVED', NULL),
    ('${uuid(302)}', '${uuid(1)}', '${uuid(2)}', '${uuid(3)}', '${uuid(100)}', '${uuid(20)}', 'INDIA', 'Full Time', 'DRAFT', 'APPROVED', NULL),
    ('${uuid(303)}', '${uuid(1)}', '${uuid(2)}', '${uuid(3)}', '${uuid(100)}', '${uuid(20)}', 'INDIA', 'Full Time', 'ACTIVE', 'PENDING', NULL),
    ('${uuid(304)}', '${uuid(9)}', '${uuid(2)}', '${uuid(3)}', '${uuid(100)}', '${uuid(20)}', 'INDIA', 'Full Time', 'ACTIVE', 'APPROVED', NULL),
    ('${uuid(305)}', '${uuid(1)}', '${uuid(2)}', '${uuid(8)}', '${uuid(100)}', '${uuid(20)}', 'INDIA', 'Full Time', 'ACTIVE', 'APPROVED', NULL),
    ('${uuid(306)}', '${uuid(1)}', '${uuid(2)}', '${uuid(3)}', NULL, '${uuid(20)}', 'INDIA', 'Full Time', 'ACTIVE', 'APPROVED', NULL);
  INSERT INTO ats.recruiter_submissions VALUES
    ('${uuid(400)}', '${uuid(1)}', '${uuid(300)}', 'JOIN', 'CLEARED', 'CLEARED', 'CLEARED'),
    ('${uuid(401)}', '${uuid(1)}', '${uuid(300)}', 'PENDING_APPROVAL', 'PENDING', NULL, NULL),
    ('${uuid(402)}', '${uuid(1)}', '${uuid(301)}', 'IN_PROGRESS', 'CLEARED', 'PENDING', NULL),
    ('${uuid(403)}', '${uuid(9)}', '${uuid(300)}', 'JOIN', 'CLEARED', 'CLEARED', 'CLEARED');
  INSERT INTO ats.submission_events VALUES
    ('${uuid(1)}','${uuid(400)}','UPDATE','{"changes":{"finalStatus":{"before":"SELECTED","after":"OFFER"}}}','2026-10-02T00:00:00Z'),
    ('${uuid(1)}','${uuid(400)}','UPDATE','{"changes":{"finalStatus":{"before":"OFFER","after":"JOIN"}}}','2026-10-11T00:00:00Z'),
    ('${uuid(1)}','${uuid(400)}','UPDATE','{"changes":{"finalStatus":{"before":"OFFER","after":"JOIN"}}}','2026-10-12T00:00:00Z'),
    ('${uuid(1)}','${uuid(401)}','BASELINE','{"changes":{"finalStatus":{"before":"OFFER","after":"JOIN"}}}','2026-10-12T00:00:00Z'),
    ('${uuid(9)}','${uuid(401)}','UPDATE','{"changes":{"finalStatus":{"before":"OFFER","after":"JOIN"}}}','2026-10-12T00:00:00Z');
`);
const prisma = { $queryRaw: async query => {
  const bound = query.text.replace(/\$(\d+)/g, (_, index) => literal(query.values[Number(index) - 1]));
  return JSON.parse(sql(`SELECT COALESCE(json_agg(result), '[]'::json) FROM (${bound}) result;`));
}, tenant: { findUnique: async () => ({ clientsVisibleAcrossUnits: false, bdmClientsTenantWide: false }) },
user: { findMany: async () => [{ id: uuid(100), email: 'manager@example.test' }] },
client: { findMany: async () => JSON.parse(sql(`SELECT json_agg(row) FROM (SELECT id, client_name AS "clientName", created_by AS "createdBy", created_at AS "createdAt", status FROM ats.clients WHERE tenant_id = '${uuid(1)}' AND deleted_at IS NULL ORDER BY client_name) row`)).map(row => ({ ...row, createdAt: new Date(row.createdAt) })) } };
const scope = { scope: async () => ({ where: { tenantId: uuid(1), branchId: uuid(2), businessUnitId: uuid(3) }, unit: { id: uuid(3), name: 'Test unit', branch: { name: 'Test branch' } } }) };
const service = new AccountManagerDashboardService(prisma, scope);
const actor = { tenantId: uuid(1), dbId: uuid(900), email: 'viewer@example.test', permissions: ['unit_admin:manage', 'user:manage', 'job:view', 'submission:view', 'submission:internal_screening', 'client:view'] };
async function main() {
  const page = await service.dashboard(actor, {});
  assert.equal(page.total, 11); assert.equal(page.rows.length, 10); assert.equal(page.nextOffset, 10);
  assert.deepEqual(page.summary, { postedJobs: 2, activeJobs: 1, joined: 1, unassignedJobs: 1 });
  assert.equal(page.rows[0].id, uuid(100));
  assert.equal(page.rows[0].submissions, 3); assert.equal(page.rows[0].review, 1); assert.equal(page.rows[0].l2, 1);
  assert.equal(page.rows[0].closedJobs, 1); assert.equal(page.rows[0].positions, 4); assert.equal(page.rows[0].offers, 1);
  assert.equal(page.rows[0].email, 'manager@example.test'); assert.equal(page.rows[0].avatar, null);
  assert.deepEqual(page.options.clients, [{ id: uuid(20), name: 'Synthetic Client' }]);
  assert.deepEqual(page.options.employmentTypes, ['Contract', 'Full Time']);
  assert.equal((await service.dashboard(actor, { offset: 10, snapshot: page.snapshot })).rows.length, 1);
  const filtered = await service.dashboard(actor, { employmentType: 'Contract' });
  assert.equal(filtered.summary.postedJobs, 1); assert.equal(filtered.summary.joined, 0);
  const october = await service.dashboard(actor, { from: '2026-10-01T00:00:00.000Z', to: '2026-11-01T00:00:00.000Z', accountManagerId: uuid(100) });
  assert.equal(october.total, 1); assert.equal(october.rows[0].joined, 1); assert.equal(october.rows[0].offers, 1); assert.equal(october.rows[0].submissions, 3);
  assert.equal(october.charts.closures[0].count, 1);
  assert.equal(october.charts.weekly.reduce((total, week) => total + week.count, 0), 1);
  assert.equal(october.charts.pipeline[0].offers, 0); // Historical offer already joined; current queue has no offer.
  assert.equal((await service.dashboard(actor, { offset: 10 })).charts, null);
  const november = await service.dashboard(actor, { from: '2026-11-01T00:00:00.000Z', to: '2026-12-01T00:00:00.000Z' });
  assert.equal(november.summary.joined, 0); assert.equal(november.summary.postedJobs, 0); assert.equal(november.summary.activeJobs, 1);
  assert.equal(november.charts.weekly.reduce((total, week) => total + week.count, 0), 0);
  const byEmail = await service.dashboard(actor, { search: 'MANAGER@EXAMPLE.TEST' });
  assert.equal(byEmail.total, 11);
  const restricted = await service.dashboard({ permissions: ['unit_admin:manage', 'user:manage'] }, { sort: 'name' });
  assert.equal(restricted.rows[0].submissions, null); assert.equal(restricted.rows[0].postedJobs, null); assert.deepEqual(restricted.options.clients, []);
  sql(`UPDATE ats.clients SET created_by = '${uuid(101)}', branch_id = '${uuid(2)}', primary_owner = '${uuid(100)}' WHERE id = '${uuid(20)}';
    INSERT INTO ats.clients(id, tenant_id, client_name, created_by, branch_id, primary_owner) VALUES ('${uuid(21)}', '${uuid(1)}', 'Created With No Jobs', '${uuid(100)}', '${uuid(2)}', '${uuid(100)}');`);
  const details = new AccountManagerDetailService(prisma, scope, service);
  const individual = await details.detail(actor, uuid(100), { from: '2026-10-01T00:00:00.000Z', to: '2026-11-01T00:00:00.000Z' });
  assert.equal(individual.manager.id, uuid(100)); assert.equal(individual.jobs.total, 2);
  assert.equal(individual.weekly.submissions.reduce((sum, week) => sum + week.count, 0), 3);
  assert.equal(individual.clients.added, 1); assert.equal(individual.clients.rows[0].name, 'Created With No Jobs');
  assert.equal(individual.clients.rows[0].postedJobs, 0); assert.equal(individual.clients.rows[0].joined, 0);
  const portfolio = await details.detail(actor, uuid(100), { clientMode: 'portfolio' });
  assert.equal(portfolio.clients.rows[0].id, uuid(20)); assert.equal(portfolio.clients.rows[0].addedByManager, false);
  assert.equal(portfolio.clients.rows[0].postedJobs, 2); assert.equal(portfolio.clients.rows[0].joined, 1);
  assert.equal(portfolio.jobs.rows.reduce((sum, job) => sum + job.submissions, 0), portfolio.manager.submissions);
  await assert.rejects(() => details.detail(actor, uuid(200), {}), /unavailable/);
  console.log('PostgreSQL integration passed: scope isolation, separate job aggregation, canonical pipeline, derived roles, zero-result managers, filters, pagination and redaction.');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
