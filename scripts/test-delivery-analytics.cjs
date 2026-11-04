const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { deliveryAnalytics, validateDeliveryPeriod } = require('../src/business-units/delivery-analytics');
const {deliveryCatalogPredicate}=require('../src/business-units/delivery-job-filters');
const container = 'ats-delivery-analytics-check';
const id = number => `00000000-0000-4000-8000-${String(number).padStart(12, '0')}`;
const literal = value => value == null ? 'NULL' : typeof value === 'boolean' || typeof value === 'number' ? String(value) : `'${String(value).replaceAll("'", "''")}'`;
const run = sql => execFileSync('docker', ['exec', '-i', container, 'psql', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1', '-A', '-t'], { input: sql, encoding: 'utf8' }).trim();
const scope = { tenantId: id(1), branchId: id(2), businessUnitId: id(3) };
const access = { jobs: true, submissions: true, members: true };
const db = { $queryRaw: async query => {
  const output = run(`PREPARE analytics_test AS ${query.text}; EXECUTE analytics_test(${query.values.map(literal).join(',')});`);
  return [{ result: JSON.parse(output.split('\n').at(-1)) }];
} };
async function main() {
  run(`CREATE SCHEMA ats;
    CREATE TABLE ats.branches(id uuid,tenant_id uuid,timezone text);
    CREATE TABLE ats.business_units(id uuid,tenant_id uuid,branch_id uuid,timezone text);
    CREATE TABLE ats.users(id uuid,tenant_id uuid,branch_id uuid,business_unit_id uuid,full_name text,email text,city text,is_approved boolean,role_id uuid,assigned_role_ids uuid[],profile_picture text);
    CREATE TABLE ats.custom_roles(id uuid,tenant_id uuid,permissions jsonb);
    CREATE TABLE ats.clients(id uuid,tenant_id uuid,client_name text);
    CREATE TABLE ats.jobs(id uuid,tenant_id uuid,branch_id uuid,business_unit_id uuid,created_by_user_id uuid,created_at timestamptz,job_title text,job_code text,client_id uuid,status text,urgency text,job_type text,deleted_at timestamptz);
    CREATE TABLE ats.candidates(id uuid,tenant_id uuid,full_name text,email text,deleted_at timestamptz);
    CREATE TABLE ats.recruiter_submissions(id uuid,tenant_id uuid,job_id uuid,candidate_id uuid,recruiter_id text,created_at timestamptz,final_status text,l1_status text,l2_status text,l3_status text,submission_origin text);
    CREATE TABLE ats.submission_events(id uuid,tenant_id uuid,submission_id uuid,actor_id text,kind text,sequence int,created_at timestamptz,details jsonb);
    INSERT INTO ats.branches VALUES('${id(2)}','${id(1)}','Asia/Kolkata');
    INSERT INTO ats.business_units VALUES('${id(3)}','${id(1)}','${id(2)}','Asia/Kolkata');
    INSERT INTO ats.custom_roles VALUES('${id(4)}','${id(1)}','["submission:create"]'),('${id(5)}','${id(1)}','["job:create"]');
    INSERT INTO ats.users(id,tenant_id,branch_id,business_unit_id,full_name,email,city,is_approved,role_id,assigned_role_ids) VALUES
      ('${id(10)}','${id(1)}','${id(2)}','${id(3)}','Recruiter A','a@example.com','BBSR',true,'${id(4)}','{}'),
      ('${id(11)}','${id(1)}','${id(2)}','${id(3)}','Manager B','b@example.com','VIZAG',true,'${id(5)}','{}'),
      ('${id(12)}','${id(1)}','${id(2)}','${id(3)}','Zero activity','zero@example.com','BBSR',true,'${id(4)}','{}'),
      ('${id(13)}','${id(99)}','${id(2)}','${id(3)}','Foreign','foreign@example.com','PUNE',true,'${id(4)}','{}');
    INSERT INTO ats.jobs VALUES
      ('${id(20)}','${id(1)}','${id(2)}','${id(3)}','${id(11)}',NOW()-INTERVAL '2 months','Old job','OLD','${id(30)}','Closed','WARM','Contract',NULL),
      ('${id(21)}','${id(1)}','${id(2)}','${id(3)}','${id(11)}',NOW(),'Current job','NEW','${id(30)}','Active','HOT','Full-time',NULL);
    INSERT INTO ats.candidates VALUES('${id(40)}','${id(1)}','Candidate','candidate@example.com',NULL);
    INSERT INTO ats.recruiter_submissions VALUES
      ('${id(50)}','${id(1)}','${id(20)}','${id(40)}','${id(11)}',NOW()-INTERVAL '2 months','JOIN','CLEARED','CLEARED','CLEARED','RECRUITER'),
      ('${id(51)}','${id(1)}','${id(21)}','${id(40)}','${id(10)}',NOW(),'SUBMITTED','CLEARED','REJECTED','PENDING','RECRUITER'),
      ('${id(52)}','${id(1)}','${id(21)}','${id(40)}',NULL,NOW(),'PENDING_APPROVAL','PENDING','PENDING','PENDING','WEBSITE');
    INSERT INTO ats.submission_events VALUES
      ('${id(60)}','${id(1)}','${id(50)}','${id(10)}','CREATED',0,NOW()-INTERVAL '2 months','{}'),
      ('${id(61)}','${id(1)}','${id(50)}','${id(10)}','UPDATE',1,NOW(),'{"changes":{"finalStatus":{"before":"SELECTED","after":"OFFER"}}}'),
      ('${id(62)}','${id(1)}','${id(50)}','${id(10)}','UPDATE',2,NOW(),'{"changes":{"finalStatus":{"before":"SELECTED","after":"OFFER"}}}'),
      ('${id(63)}','${id(1)}','${id(50)}','${id(10)}','UPDATE',3,NOW(),'{"changes":{"finalStatus":{"before":"OFFER","after":"JOIN"}}}');`);
  const offers = await deliveryAnalytics(db, scope, access, { period: 'today' }, 'offers', 1);
  assert.equal(offers.offersReceived, 1);
  assert.deepEqual(offers.submissionIds, [id(50)]);
  assert.equal(offers.totalSubmissions, 2);
  assert.equal(offers.jobCounts.total, 1);
  assert.equal(offers.jobCounts.statuses.ACTIVE, 1);
  assert.equal(offers.rounds.l1.CLEARED, 1);
  assert.equal(offers.rounds.l2.REJECTED, 1);
  assert.equal(offers.rounds.l3.PENDING, undefined);
  assert.equal(offers.websiteApplications, 1);
  assert.ok(!offers.availableCities.includes('PUNE'));
  assert.ok(offers.cities.find(city => city.city === 'BBSR').employees.some(employee => employee.email === 'zero@example.com' && employee.submissions === 0));
  assert.equal(offers.cities.find(city => city.city === 'BBSR').offers, 1);
  assert.equal(offers.cities.find(city => city.city === 'VIZAG').offers, 0);
  const city = await deliveryAnalytics(db, scope, access, { period: 'today', cities: 'VIZAG' }, 'offers', 1);
  assert.equal(city.offersReceived, 0);
  assert.equal(city.submissionTotal, 0);
  assert.equal(city.cities.length, 1);
  const cleared = await deliveryAnalytics(db, scope, access, { period: 'today', status: 'CLEARED' }, 'l1', 1);
  assert.deepEqual(cleared.submissionIds, [id(51)]);
  const restricted = await deliveryAnalytics(db, scope, { jobs: false, submissions: false, members: false }, {}, 'all', 1);
  assert.equal(restricted.cities, null);
  assert.equal(restricted.jobCounts, null);
  assert.equal(restricted.offersReceived, null);
  const all = await deliveryAnalytics(db, scope, access, { period: 'all' }, 'all', 1);
  assert.equal(all.jobCounts.total, 2);
  assert.equal(all.totalSubmissions, 3);
  const week = await deliveryAnalytics(db, scope, access, { period: 'week' }, 'all', 1);
  assert.equal(new Intl.DateTimeFormat('en-US', { weekday: 'long', timeZone: 'Asia/Kolkata' }).format(new Date(week.from)), 'Monday');
  for (const period of ['month', 'previousMonth', 'year', 'previousYear']) {
    const result = await deliveryAnalytics(db, scope, access, { period }, 'all', 1);
    assert.ok(Date.parse(result.to) > Date.parse(result.from));
  }
  run(`INSERT INTO ats.recruiter_submissions VALUES
    ('${id(70)}','${id(1)}','${id(21)}','${id(40)}','${id(10)}',date_trunc('day',NOW() AT TIME ZONE 'Asia/Kolkata') AT TIME ZONE 'Asia/Kolkata','SUBMITTED','PENDING','PENDING','PENDING','RECRUITER'),
    ('${id(71)}','${id(1)}','${id(21)}','${id(40)}','${id(10)}',(date_trunc('day',NOW() AT TIME ZONE 'Asia/Kolkata') AT TIME ZONE 'Asia/Kolkata')-INTERVAL '1 second','SUBMITTED','PENDING','PENDING','PENDING','RECRUITER'),
    ('${id(72)}','${id(1)}','${id(21)}','${id(40)}','${id(10)}',(date_trunc('day',NOW() AT TIME ZONE 'Asia/Kolkata')+INTERVAL '1 day') AT TIME ZONE 'Asia/Kolkata','SUBMITTED','PENDING','PENDING','PENDING','RECRUITER');`);
  const midnight = await deliveryAnalytics(db, scope, access, { period: 'today' }, 'all', 1);
  assert.ok(midnight.submissionIds.includes(id(70)));
  assert.ok(!midnight.submissionIds.includes(id(71)));
  assert.ok(!midnight.submissionIds.includes(id(72)));
  for (let index = 100; index < 111; index++) run(`INSERT INTO ats.users(id,tenant_id,branch_id,business_unit_id,full_name,email,city,is_approved,role_id,assigned_role_ids) VALUES('${id(index)}','${id(1)}','${id(2)}','${id(3)}','Staff ${index}','staff${index}@example.com','BBSR',true,'${id(4)}','{}');`);
  const secondPage = await deliveryAnalytics(db, scope, access, { employeeCity: 'BBSR', employeePage: '2' }, 'all', 1);
  assert.equal(secondPage.cities.find(city => city.city === 'BBSR').employees.length, 3);
  assert.equal(secondPage.cities.find(city => city.city === 'BBSR').page, 2);
  assert.equal(secondPage.cities.find(city => city.city === 'VIZAG').page, 1);
  const recruiters = await deliveryAnalytics(db, scope, access, { employeeView: 'recruiters' }, 'all', 1);
  assert.ok(recruiters.cities.every(city => city.employees.every(employee => employee.canRecruit)));
  const jobList = await deliveryAnalytics(db,scope,access,{jobPage:'1'},'all',1);
  assert.equal(jobList.jobResults.total,jobList.jobCounts.total);
  const cityJobs = await deliveryAnalytics(db,scope,access,{jobPage:'1',cities:'VIZAG'},'all',1);
  assert.equal(cityJobs.jobResults.total,cityJobs.jobCounts.total);
  assert.ok(cityJobs.jobResults.items.every(job=>job.postedBy.email==='b@example.com'));
  const activeJobs = await deliveryAnalytics(db,scope,access,{jobPage:'1',jobStatus:'ACTIVE'},'all',1);
  assert.equal(activeJobs.jobResults.total,activeJobs.jobCounts.statuses.ACTIVE||0);
  assert.ok(activeJobs.jobResults.items.every(job=>job.status==='ACTIVE'));
  const hotJobs = await deliveryAnalytics(db,scope,access,{jobPage:'1',jobPriority:'HOT'},'all',1);
  assert.equal(hotJobs.jobResults.total,hotJobs.jobCounts.priorities.HOT||0);
  const typeJobs = await deliveryAnalytics(db,scope,access,{jobPage:'1',jobType:'Full-Time'},'all',1);
  assert.equal(typeJobs.jobResults.total,typeJobs.jobCounts.types['Full-Time']||0);
  await assert.rejects(()=>deliveryAnalytics(db,scope,access,{jobPage:'0'},'all',1));
  for(const input of [{period:'all'},{period:'today'},{period:'month',cities:'VIZAG'},{period:'previousMonth'}]) {
    const params=[];
    const predicate=deliveryCatalogPredicate({...scope,permissions:['unit_admin:manage','user:manage']},input,value=>{params.push(value);return '$'+params.length;});
    const output=run(`PREPARE catalog_test AS SELECT COUNT(*)::int FROM ats.jobs j WHERE j.tenant_id='${scope.tenantId}'::uuid AND j.deleted_at IS NULL ${predicate}; EXECUTE catalog_test(${params.map(value=>Array.isArray(value)?`ARRAY[${value.map(literal).join(',')}]::text[]`:literal(value)).join(',')});`);
    const summary=await deliveryAnalytics(db,scope,access,input,'all',1);
    assert.equal(Number(output.split('\n').at(-1)),summary.jobCounts.total);
  }
  assert.throws(() => validateDeliveryPeriod({ period: 'custom', from: '2026-02-30', to: '2026-03-01' }));
  assert.throws(() => validateDeliveryPeriod({ cities: "BBSR' OR TRUE" }));
  console.log('Delivery analytics PostgreSQL checks passed: date presets and midnight boundaries, city isolation, original submitter, offer deduplication, older submissions, round reachability, zero activity, staff pagination, employee views, permissions.');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
