// Synthetic PostgreSQL only; no application connection string is read.
require('ts-node/register/transpile-only');
const fs = require('node:fs'),
  path = require('node:path'),
  assert = require('node:assert/strict'),
  { spawnSync } = require('node:child_process');
const { Prisma } = require('@prisma/client');
const {
  RecruiterSubmissionsService,
} = require('../src/recruiter-submissions/recruiter-submissions.service');
const container = process.argv[2];
if (container !== 'codex-submission-filters-test')
  throw Error('Isolated test container required.');
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
  v === null || v === undefined
    ? 'NULL'
    : v instanceof Date
      ? `'${v.toISOString()}'`
      : Array.isArray(v)
        ? v.length
          ? `ARRAY[${v.map(literal).join(',')}]`
          : "'{}'"
        : typeof v === 'boolean' || typeof v === 'number'
          ? String(v)
          : `'${String(v).replace(/'/g, "''")}'`;
function query(q, values = []) {
  for (let i = values.length; i >= 1; i--)
    q = q.replace(new RegExp(`\\$${i}(?!\\d)`, 'g'), () =>
      literal(values[i - 1]),
    );
  const out = sql(`SELECT row_to_json(r) FROM (${q}) r;`);
  return out ? out.split('\n').map(JSON.parse) : [];
}
const schema = fs.readFileSync(
  path.join(__dirname, '../prisma/schema.prisma'),
  'utf8',
);
const names = [
  'User',
  'Job',
  'Candidate',
  'Client',
  'Pod',
  'BusinessUnit',
  'Branch',
  'CustomRole',
  'SystemRole',
  'RecruiterSubmission',
  'SubmissionEvent',
  'Tenant',
  'Resume',
];
sql('DROP SCHEMA IF EXISTS ats CASCADE; CREATE SCHEMA ats;');
for (const name of names) {
  const model = Prisma.dmmf.datamodel.models.find((m) => m.name === name),
    body = schema.match(new RegExp(`model ${name} \\{([\\s\\S]*?)\\n\\}`))[1];
  const fields = model.fields
    .filter((f) => f.kind === 'scalar' || f.kind === 'enum')
    .map((f) => {
      const line =
        body.split('\n').find((l) => new RegExp(`^\\s*${f.name}\\s`).test(l)) ||
        '';
      let type =
        f.type === 'String'
          ? line.includes('@db.Uuid')
            ? 'uuid'
            : 'text'
          : f.type === 'Int'
            ? 'integer'
            : f.type === 'BigInt'
              ? 'bigint'
              : f.type === 'Boolean'
                ? 'boolean'
                : f.type === 'DateTime'
                  ? 'timestamptz'
                  : f.type === 'Json'
                    ? 'jsonb'
                    : ['Float', 'Decimal'].includes(f.type)
                      ? 'numeric'
                      : 'text';
      return `"${f.dbName || f.name}" ${type}${f.isList ? '[]' : ''}`;
    });
  sql(`CREATE TABLE ats."${model.dbName}" (${fields.join(',')});`);
}
function insert(table, row) {
  sql(
    `INSERT INTO ats.${table} (${Object.keys(row)
      .map((k) => `"${k}"`)
      .join(',')}) VALUES (${Object.values(row).map(literal).join(',')});`,
  );
}
for (const [n, unit, branch] of [
  [100, 3, 2],
  [101, 3, 2],
  [102, 3, 2],
  [103, 4, 2],
  [104, 5, 6],
])
  insert('users', {
    id: id(n),
    tenant_id: id(1),
    branch_id: id(branch),
    business_unit_id: id(unit),
    full_name: `User ${n}`,
    email: `user${n}@example.test`,
    is_active: true,
    is_approved: true,
    assigned_role_ids: [],
  });
insert('branches', { id: id(2), tenant_id: id(1), name: 'Branch A' });
insert('branches', { id: id(6), tenant_id: id(1), name: 'Other Branch' });
for (const n of [3, 4, 5])
  insert('business_units', {
    id: id(n),
    tenant_id: id(1),
    branch_id: id(n === 5 ? 6 : 2),
    name: `Unit ${n}`,
    allow_pods: true,
  });
insert('clients', { id: id(20), tenant_id: id(1), client_name: 'Client A' });
for (const [n, unit, branch, manager, status, keep] of [
  [30, 3, 2, 101, 'Active', false],
  [31, 3, 2, 101, 'Closed', false],
  [32, 3, 2, 101, 'Closed', true],
  [33, 4, 2, 103, 'Active', false],
  [34, 5, 6, 104, 'Active', false],
])
  insert('jobs', {
    id: id(n),
    tenant_id: id(1),
    branch_id: id(branch),
    business_unit_id: id(unit),
    account_manager_id: id(manager),
    created_by_user_id: id(100),
    client_id: id(20),
    job_title: `Job ${n}`,
    job_code: `JOB-${n}`,
    status,
    keep_existing_submissions_open: keep,
    created_at: '2026-10-01',
    job_type: 'Full Time',
    urgency: 'Hot',
  });
insert('candidates', {
  id: id(40),
  tenant_id: id(1),
  full_name: 'Synthetic Candidate',
  skills: [],
});
for (const [n, job, recruiter, final, l1, l2] of [
  [50, 30, 102, 'PENDING_APPROVAL', 'PENDING', null],
  [51, 30, 102, 'SUBMITTED', 'PENDING', null],
  [52, 30, 102, 'SUBMITTED', 'CLEARED', 'AWAITING_FEEDBACK'],
  [53, 30, 102, 'JOIN', 'CLEARED', 'CLEARED'],
  [54, 30, 102, 'JOIN', 'CLEARED', 'CLEARED'],
  [55, 31, 102, 'SUBMITTED', 'PENDING', null],
  [56, 32, 102, 'SUBMITTED', 'PENDING', null],
  [57, 33, 103, 'PENDING_APPROVAL', 'PENDING', null],
  [58, 34, 104, 'SUBMITTED', 'PENDING', null],
])
  insert('recruiter_submissions', {
    id: id(n),
    tenant_id: id(1),
    job_id: id(job),
    candidate_id: id(40),
    recruiter_id: id(recruiter),
    final_status: final,
    l1_status: l1,
    l2_status: l2,
    l3_status: 'PENDING',
    created_at: '2026-10-10',
    updated_at: '2026-10-10',
  });
for (const n of [1, 2])
  insert('submission_events', {
    id: id(60 + n),
    tenant_id: id(1),
    submission_id: id(53),
    sequence: n,
    kind: 'UPDATE',
    created_at: '2026-10-20',
    details: JSON.stringify({
      changes: { finalStatus: { before: 'OFFER', after: 'JOIN' } },
    }),
  });
insert('submission_events', {
  id: id(63),
  tenant_id: id(1),
  submission_id: id(54),
  sequence: 1,
  kind: 'BASELINE',
  created_at: '2026-10-20',
  details: JSON.stringify({ changes: { finalStatus: { after: 'JOIN' } } }),
});
const db = {
  $queryRawUnsafe: async (q, ...v) => query(q, v),
  user: {
    findFirst: async ({ where }) => {
      const r = query(
        'SELECT branch_id AS "branchId",business_unit_id AS "businessUnitId" FROM ats.users WHERE id=$1::uuid AND tenant_id=$2::uuid',
        [where.id, where.tenantId],
      );
      return r[0] || null;
    },
  },
  tenant: {
    findUnique: async () => ({
      clientsVisibleAcrossUnits: true,
      podSystemEnabled: false,
    }),
  },
  client: {
    findMany: async ({ where }) =>
      query('SELECT id FROM ats.clients WHERE tenant_id=$1::uuid', [id(1)]),
    findFirst: async () => ({ id: id(20) }),
  },
};
const service = new RecruiterSubmissionsService(db, { create: async () => {} });
const base = {
  dbId: id(100),
  tenantId: id(1),
  branchId: id(2),
  businessUnitId: id(3),
  permissions: [
    'unit_admin:manage',
    'submission:view',
    'submission:internal_screening',
    'user:manage',
    'client:view',
  ],
};
async function main() {
  const all = await service.findAll(id(1), base, {});
  assert.deepEqual(all.counts, {
    all: 7,
    review: 1,
    interviews: 3,
    offers: 0,
    closures: 2,
    closed: 1,
  });
  const l1 = await service.findAll(id(1), base, {
    bucket: 'interviews',
    stage: 'l1',
    stageStatus: 'PENDING',
  });
  assert.equal(l1.total, 2);
  assert.equal(l1.counts.review, 0);
  const joined = await service.findAll(id(1), base, {
    bucket: 'closures',
    dateBasis: 'joined',
    startDate: '2026-10-01',
    endDate: '2026-10-31',
  });
  assert.equal(joined.total, 1);
  assert.equal(joined.data[0].id, id(53));
  assert.equal(joined.undatedClosures, 1);
  assert(joined.data[0].joinedAt);
  const closed = await service.findAll(id(1), base, { bucket: 'closed' });
  assert.equal(closed.total, 1);
  assert.equal(closed.data[0].id, id(55));
  const feedback = await service.findAll(id(1), base, {
    bucket: 'interviews',
    queue: 'feedback',
  });
  assert.equal(feedback.total, 1);
  assert.equal(feedback.data[0].id, id(52));
  const manager = {
    ...base,
    dbId: id(101),
    permissions: ['submission:view', 'job:submit_owned_jobs', 'client:view'],
  };
  assert.equal(
    (await service.findAll(id(1), manager, { view: 'my' })).total,
    7,
  );
  const recruiter = {
    ...base,
    dbId: id(102),
    permissions: ['submission:view', 'submission:create'],
  };
  assert.equal(
    (await service.findAll(id(1), recruiter, { view: 'my' })).total,
    7,
  );
  await assert.rejects(
    () => service.findAll(id(1), recruiter, { recruiterId: id(103) }),
    /People filtering/,
  );
  await assert.rejects(
    () => service.findAll(id(1), base, { accountManagerId: id(103) }),
    /unavailable/,
  );
  const options = await service.findAll(id(1), base, {
    filterOptions: 'accountManagerId',
  });
  assert.deepEqual(
    options.data.map((r) => r.id),
    [id(101)],
  );
  const branch = {
    ...base,
    permissions: ['branch_admin:manage', 'submission:view', 'client:view'],
  };
  assert.equal((await service.findAll(id(1), branch, {})).total, 8);
  const units = await service.findAll(id(1), branch, {
    filterOptions: 'businessUnitId',
  });
  assert.deepEqual(
    units.data.map((r) => r.id),
    [id(3), id(4)],
  );
  const narrowed = await service.findAll(id(1), branch, {
    businessUnitId: id(4),
  });
  assert.equal(narrowed.total, 1);
  const creators = await service.findAll(id(1), base, {
    filterOptions: 'createdById',
  });
  assert.deepEqual(
    creators.data.map((r) => r.id),
    [id(100)],
  );
  assert.equal(
    (await service.findAll(id(1), base, { filterOptions: 'podId' })).data
      .length,
    0,
  );
  for(const n of [105,106])insert('users',{id:id(n),tenant_id:id(1),branch_id:id(2),business_unit_id:id(3),full_name:`User ${n}`,email:`user${n}@example.test`,is_active:true,is_approved:true,assigned_role_ids:[]});
  insert('clients',{id:id(21),tenant_id:id(1),client_name:'Client B'});
  insert('jobs',{id:id(35),tenant_id:id(1),branch_id:id(2),business_unit_id:id(3),account_manager_id:id(105),created_by_user_id:id(100),client_id:id(21),job_title:'Legacy High Job',job_code:'JOB-35',status:'Active',keep_existing_submissions_open:false,created_at:'2026-10-01',job_type:'Full Time',urgency:'HIGH'});
  for(const n of [59,64])insert('recruiter_submissions',{id:id(n),tenant_id:id(1),job_id:id(35),candidate_id:id(40),recruiter_id:id(106),final_status:n===64?'JOIN':'SUBMITTED',l1_status:'CLEARED',l2_status:n===64?'CLEARED':'SCHEDULED',l3_status:n===64?'CLEARED':'PENDING',l2_date:new Date(Date.now()+86400000),created_at:'2026-10-10',updated_at:'2026-10-10'});
  sql(`UPDATE ats.jobs SET urgency='Cold' WHERE id='${id(31)}';UPDATE ats.jobs SET urgency='Warm' WHERE id='${id(32)}';`);
  const owners={mode:'ids',ids:[id(101),id(105)]},recruiters={mode:'ids',ids:[id(102),id(106)]};
  assert.equal((await service.findAll(id(1),base,{accountManagers:owners,recruiters})).total,9);
  assert.equal((await service.findAll(id(1),base,{accountManagers:{mode:'matching',search:'user105@example.test'}})).total,2);
  assert.equal((await service.findAll(id(1),base,{accountManagers:{mode:'matching',search:'User',excludedIds:[id(101)]}})).total,2);
  assert.equal((await service.findAll(id(1),base,{accountManagers:{mode:'ids',ids:[id(105)]},recruiters:{mode:'ids',ids:[id(102)]}})).total,0);
  await assert.rejects(()=>service.findAll(id(1),base,{accountManagers:{mode:'ids',ids:[id(101),id(103)]}}),/unavailable/);
  const oldFindMany=db.client.findMany;
  db.client.findMany=async({where})=>{const parts=where.AND??[],ids=parts.find(p=>p.id?.in)?.id.in,contains=parts.find(p=>p.clientName?.contains!==undefined)?.clientName.contains;let q='SELECT id FROM ats.clients WHERE tenant_id=$1::uuid',v=[id(1)];if(ids){v.push(ids);q+=` AND id=ANY($${v.length}::uuid[])`;}if(contains!==undefined){v.push(contains);q+=` AND POSITION(LOWER($${v.length}) IN LOWER(client_name))>0`;}return query(q,v);};
  assert.equal((await service.findAll(id(1),base,{accountManagers:owners,clients:{mode:'ids',ids:[id(21)]}})).total,2);
  assert.equal((await service.findAll(id(1),base,{clients:{mode:'matching',search:'Client B'}})).total,2);
  assert.equal((await service.findAll(id(1),base,{clients:{mode:'matching',search:'',excludedIds:[id(21)]}})).total,7);
  assert.equal((await service.findAll(id(1),base,{round:'l1',roundStatus:'PENDING'})).total,2);
  assert.equal((await service.findAll(id(1),base,{round:'l2',roundStatus:'PENDING'})).total,0);
  assert.equal((await service.findAll(id(1),base,{round:'l2',roundStatus:'SCHEDULED'})).total,1);
  assert.equal((await service.findAll(id(1),base,{round:'l1',roundStatus:'CLEARED',bucket:'all'})).total,5);
  sql(`UPDATE ats.recruiter_submissions SET final_status='SUBMITTED',l1_status='PENDING',l2_status='PENDING',l3_status='PENDING' WHERE id='${id(64)}';`);
  assert.equal((await service.findAll(id(1),base,{round:'l1',roundStatus:'CLEARED',bucket:'all'})).total,4);
  assert.equal((await service.findAll(id(1),base,{urgency:'Hot'})).total,7);
  assert.equal((await service.findAll(id(1),base,{urgency:'Warm'})).total,1);
  assert.equal((await service.findAll(id(1),base,{urgency:'Cold'})).total,1);
  console.log(
    'Submission SQL integration with multi-select, matching/exclusions, reached rounds, progressed/corrected cleared results and legacy urgency passed: scope, owner/creator distinction, scoped options, stage/status, queues, closure dates, duplicate/baseline events, missing dates, and disjoint closures/closed counts.',
  );
}
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
