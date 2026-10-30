// Disposable PostgreSQL only; never use the application's configured database.
require('ts-node/register/transpile-only');
const { spawnSync } = require('node:child_process'),
  assert = require('node:assert/strict');
const {
  RecruiterPerformanceService,
} = require('../src/business-units/recruiter-performance.service');
const container = process.argv[2];
if (container !== 'codex-recruiter-dashboard-test')
  throw Error('An isolated recruiter test container is required.');
const id = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
function sql(q) {
  const r = spawnSync(
    'docker',
    [
      'exec',
      '-i',
      container,
      'psql',
      '-U',
      'postgres',
      '-X',
      '-qAt',
      '-v',
      'ON_ERROR_STOP=1',
    ],
    { input: q, encoding: 'utf8' },
  );
  if (r.status !== 0) throw Error(r.stderr || r.error?.message);
  return r.stdout.trim();
}
const literal = (v) =>
  v === null
    ? 'NULL'
    : typeof v === 'boolean' || typeof v === 'number'
      ? String(v)
      : `'${(v instanceof Date ? v.toISOString() : String(v)).replace(/'/g, "''")}'`;
sql(`CREATE SCHEMA ats;
CREATE TABLE ats.system_roles(id uuid PRIMARY KEY,system_key text);
CREATE TABLE ats.custom_roles(id uuid PRIMARY KEY,tenant_id uuid,system_role_id uuid,base_role_id uuid,permissions jsonb DEFAULT '[]');
CREATE TABLE ats.users(id uuid PRIMARY KEY,tenant_id uuid,branch_id uuid,business_unit_id uuid,full_name text,email text,profile_picture text,pod_id uuid,role_id uuid,assigned_role_ids uuid[],is_active boolean DEFAULT true,is_approved boolean DEFAULT true);
CREATE TABLE ats.pods(id uuid PRIMARY KEY,tenant_id uuid,branch_id uuid,business_unit_id uuid,name text);
CREATE TABLE ats.clients(id uuid PRIMARY KEY,tenant_id uuid,client_name text);
CREATE TABLE ats.jobs(id uuid PRIMARY KEY,tenant_id uuid,branch_id uuid,business_unit_id uuid,job_title text,job_code text,status text DEFAULT 'Active',approval_status text DEFAULT 'APPROVED',client_id uuid,account_manager_id uuid,deleted_at timestamptz,keep_existing_submissions_open boolean DEFAULT false);
CREATE TABLE ats.job_recruiters(job_id uuid,recruiter_id uuid,PRIMARY KEY(job_id,recruiter_id));
CREATE TABLE ats.job_pods(job_id uuid,pod_id uuid,PRIMARY KEY(job_id,pod_id));
CREATE TABLE ats.candidates(id uuid PRIMARY KEY,tenant_id uuid,full_name text,deleted_at timestamptz);
CREATE TABLE ats.recruiter_submissions(id uuid PRIMARY KEY,tenant_id uuid,job_id uuid,candidate_id uuid,recruiter_id varchar(255),created_at timestamptz DEFAULT '2026-10-10',final_status text,l1_status text DEFAULT 'PENDING',l2_status text,l3_status text,l1_date timestamptz,l2_date timestamptz,l3_date timestamptz);
CREATE TABLE ats.submission_events(tenant_id uuid,submission_id uuid,kind text,created_at timestamptz,details jsonb);
INSERT INTO ats.system_roles VALUES('${id(10)}','RECRUITER');
INSERT INTO ats.custom_roles VALUES('${id(11)}','${id(1)}','${id(10)}',NULL,'["job:submit_pod_jobs"]'),('${id(12)}','${id(1)}',NULL,'${id(11)}','["job:submit_pod_jobs"]');
INSERT INTO ats.pods VALUES('${id(20)}','${id(1)}','${id(2)}','${id(3)}','Talent Pod');
${Array.from({ length: 12 }, (_, i) => `INSERT INTO ats.users(id,tenant_id,branch_id,business_unit_id,full_name,email,pod_id,role_id,assigned_role_ids) VALUES('${id(100 + i)}','${id(1)}','${id(2)}','${id(3)}','Recruiter ${i}','r${i}@example.test','${id(20)}','${id(12)}','{}');`).join('\n')}
INSERT INTO ats.users(id,tenant_id,branch_id,business_unit_id,full_name,email,role_id,assigned_role_ids) VALUES('${id(200)}','${id(9)}','${id(2)}','${id(3)}','Foreign','foreign@example.test','${id(11)}','{}');
INSERT INTO ats.clients VALUES('${id(30)}','${id(1)}','Synthetic Client');
${[300, 301, 302, 303].map((n) => `INSERT INTO ats.jobs(id,tenant_id,branch_id,business_unit_id,job_title,job_code,client_id) VALUES('${id(n)}','${id(1)}','${id(2)}','${id(n === 303 ? 8 : 3)}','Job ${n}','JOB-${n}','${id(30)}');`).join('\n')}
INSERT INTO ats.job_recruiters VALUES('${id(300)}','${id(100)}'),('${id(303)}','${id(100)}');
INSERT INTO ats.job_pods VALUES('${id(300)}','${id(20)}'),('${id(301)}','${id(20)}');
INSERT INTO ats.candidates VALUES('${id(40)}','${id(1)}','Synthetic Candidate',NULL),('${id(41)}','${id(9)}','Foreign Candidate',NULL),('${id(42)}','${id(1)}','Deleted Candidate',CURRENT_TIMESTAMP);
${[
  [400, 300, 40, id(100), 'JOIN'],
  [401, 300, 40, id(100), 'PENDING_APPROVAL'],
  [402, 302, 40, id(100), 'OFFER'],
  [403, 301, 40, id(101), 'JOIN'],
  [404, 301, 40, 'WEBSITE_APPLICANT', 'PENDING_APPROVAL'],
  [405, 301, 40, 'not-a-uuid', 'SUBMITTED'],
  [406, 303, 40, id(100), 'JOIN'],
  [407, 300, 41, id(100), 'JOIN'],
  [408, 300, 42, id(100), 'JOIN'],
  [409, 300, 40, id(100), 'SUBMITTED'],
  [410, 300, 40, id(100), 'SUBMITTED'],
]
  .map(
    ([n, j, c, r, f]) =>
      `INSERT INTO ats.recruiter_submissions(id,tenant_id,job_id,candidate_id,recruiter_id,final_status) VALUES('${id(n)}','${id(1)}','${id(j)}','${id(c)}','${r}','${f}');`,
  )
  .join('\n')}
UPDATE ats.recruiter_submissions SET l1_status='AWAITING_FEEDBACK' WHERE id='${id(409)}';
UPDATE ats.recruiter_submissions SET l1_status='CLEARED',l2_status='SCHEDULED',l2_date=CURRENT_TIMESTAMP+interval '1 day' WHERE id='${id(410)}';
${['OFFER', 'JOIN', 'JOIN'].map((s, i) => `INSERT INTO ats.submission_events VALUES('${id(1)}','${id(400)}','UPDATE','2026-10-${12 + i}','{"changes":{"finalStatus":{"before":"SELECTED","after":"${s}"}}}');`).join('\n')}
INSERT INTO ats.submission_events VALUES('${id(1)}','${id(403)}','BASELINE','2026-10-15','{"changes":{"finalStatus":{"after":"JOIN"}}}');`);
let pods = true;
const db = {
  tenant: {
    findUnique: async () => ({
      podSystemEnabled: pods,
      clientsVisibleAcrossUnits: true,
    }),
  },
  businessUnit: { findFirst: async () => ({ allowPods: true }) },
  client: {
    findMany: async () => [{ id: id(30), clientName: 'Synthetic Client' }],
  },
  $queryRaw: async (q) => {
    let text = q.text;
    for (let n = q.values.length; n >= 1; n--)
      text = text.replace(
        new RegExp(`\\$${n}(?!\\d)`, 'g'),
        literal(q.values[n - 1]),
      );
    const out = sql(`SELECT row_to_json(result) FROM (${text}) result;`);
    return out ? out.split('\n').map(JSON.parse) : [];
  },
};
const delivery = {
  scope: async () => ({
    where: { tenantId: id(1), branchId: id(2), businessUnitId: id(3) },
    unit: { id: id(3), name: 'Staffing', branch: { name: 'Branch' } },
  }),
};
const actor = {
  dbId: id(500),
  tenantId: id(1),
  permissions: [
    'unit_admin:manage',
    'user:manage',
    'job:view',
    'submission:view',
    'submission:internal_screening',
    'client:view',
    'candidate:view',
    'pod:view',
  ],
};
const october = {
  from: '2026-10-01T00:00:00.000Z',
  to: '2026-11-01T00:00:00.000Z',
};
async function main() {
  const service = new RecruiterPerformanceService(db, delivery);
  const all = await service.dashboard(actor, {});
  assert.equal(all.total, 12);
  assert.equal(all.rows.length, 10);
  assert.equal(all.summary.activeJobs, 2);
  assert.equal(all.summary.submissions, 6);
  assert.equal(all.summary.joined, 2);
  assert.equal(all.unattributedSubmissions, 2);
  const first = all.rows.find((r) => r.id === id(100));
  assert.equal(first.directActive, 1);
  assert.equal(first.sharedJobs, 1);
  assert.equal(first.review, 1);
  assert.equal(first.l1, 1);
  const rest = await service.dashboard(actor, {
    offset: 10,
    limit: 100,
    snapshot: all.snapshot,
  });
  assert.equal(rest.rows.length, 2);
  assert.equal(rest.charts, null);
  const period = await service.dashboard(actor, october);
  assert.equal(period.summary.joined, 1);
  assert.equal(period.summary.offers, 1);
  assert.equal(
    period.charts.closuresWeekly.reduce((n, w) => n + w.count, 0),
    1,
  );
  const one = await service.detail(actor, id(100), { ...october, tab: 'jobs' });
  assert.equal(one.table.total, 2);
  assert.equal(one.recruiter.submissions, 5);
  assert.equal(one.attention.feedback, 1);
  assert.equal(
    one.table.rows.filter((r) => r.assignment === 'shared').length,
    1,
  );
  const subs = await service.detail(actor, id(100), {
    ...october,
    tab: 'submissions',
  });
  assert.equal(subs.table.total, 5);
  assert.equal(subs.table.rows.find((r) => r.id === id(409)).status, 'L1');
  const historical = await service.detail(actor, id(100), {
    ...october,
    tab: 'clients',
  });
  assert.equal(historical.table.rows[0].submissions, 5);
  assert.equal(historical.table.rows[0].offers, 1);
  const queue = await service.detail(actor, id(100), {
    tab: 'submissions',
    attention: 'feedback',
    from: '2026-11-01T00:00:00.000Z',
    to: '2026-12-01T00:00:00.000Z',
  });
  assert.equal(queue.table.total, 1);
  await assert.rejects(() => service.detail(actor, id(200), {}), /unavailable/);
  const noNames = await service.detail(
    {
      ...actor,
      permissions: actor.permissions.filter((p) => p !== 'candidate:view'),
    },
    id(100),
    { tab: 'submissions' },
  );
  assert(noNames.table.rows.every((r) => r.title === 'Candidate'));
  const noReview = await service.detail(
    {
      ...actor,
      permissions: actor.permissions.filter(
        (p) => p !== 'submission:internal_screening',
      ),
    },
    id(100),
    { tab: 'submissions' },
  );
  assert.equal(noReview.recruiter.review, null);
  assert(noReview.table.rows.every((r) => r.status !== 'PENDING_APPROVAL'));
  const noMetrics = await service.dashboard(
    { ...actor, permissions: ['unit_admin:manage', 'user:manage'] },
    { sort: 'name' },
  );
  assert.equal(noMetrics.rows[0].submissions, null);
  assert.equal(noMetrics.summary.activeJobs, null);
  assert.equal(noMetrics.charts, null);
  pods = false;
  const disabled = await service.dashboard(actor, {});
  assert.equal(disabled.summary.activeJobs, 1);
  assert.equal(disabled.rows[0].sharedJobs, null);
  assert.deepEqual(disabled.options.pods, []);
  pods = true;
  sql(`DELETE FROM ats.job_recruiters WHERE job_id='${id(300)}';`);
  const reassigned = await service.detail(actor, id(100), {
    tab: 'submissions',
  });
  assert.equal(reassigned.recruiter.submissions, 5);
  assert.equal(reassigned.table.total, 5);
  sql(
    `UPDATE ats.recruiter_submissions SET final_status='JOIN' WHERE id='${id(402)}';`,
  );
  await assert.rejects(
    () => service.dashboard(actor, { offset: 10, snapshot: all.snapshot }),
    /changed/,
  );
  const plan = sql(
    `EXPLAIN SELECT s.id FROM ats.recruiter_submissions s JOIN ats.jobs j ON j.id=s.job_id WHERE s.tenant_id='${id(1)}' AND j.business_unit_id='${id(3)}';`,
  );
  assert(plan.includes('Scan'));
  console.log(
    'Recruiter PostgreSQL checks passed: direct/pod overlap, unique workload, safe sentinel attribution, scope, deleted candidates, genuine milestones, historical contributions, period trends, tabs, queues, permissions, snapshot and expansion.',
  );
}
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
