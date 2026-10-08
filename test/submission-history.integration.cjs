// Explicitly restricted to the disposable local history_test database.
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { PrismaClient } = require('@prisma/client');
const { RecruiterSubmissionsService } = require('../dist/recruiter-submissions/recruiter-submissions.service');

const url = process.env.SUBMISSION_HISTORY_TEST_DATABASE_URL;
if (!url || new URL(url).hostname !== '127.0.0.1' || new URL(url).pathname !== '/history_test') {
  throw new Error('Use only the disposable local history_test database');
}
const prisma = new PrismaClient({ datasources: { db: { url } } });
const tenant = randomUUID(), job = randomUUID(), candidate = randomUUID();
const actor = { dbId: randomUUID(), fullName: 'Test actor', permissions: ['submission:schedule_interview', 'submission:audit_l1', 'submission:edit', 'submission:final_status'] };
const notifications = { create: async () => {} };
const service = new RecruiterSubmissionsService(prisma, notifications);
// Access policy is covered by unit tests; this harness isolates persistence.
service.findOne = async (id, tenantId) => {
  const row = await prisma.recruiterSubmission.findFirst({ where: { id, tenantId } });
  if (!row) throw new Error('Submission outside tenant scope');
  return row;
};
async function main() {
  await prisma.$executeRawUnsafe('INSERT INTO ats.tenants(id,name) VALUES ($1::uuid,$2)', tenant, 'History integration test');
  await prisma.$executeRawUnsafe('INSERT INTO ats.jobs(id,tenant_id,job_code,job_title) VALUES ($1::uuid,$2::uuid,$3,$4)', job, tenant, randomUUID(), 'Test job');
  await prisma.$executeRawUnsafe('INSERT INTO ats.candidates(id,tenant_id,full_name) VALUES ($1::uuid,$2::uuid,$3)', candidate, tenant, 'Test candidate');
  const sub = await prisma.recruiterSubmission.create({ data: { tenantId: tenant, jobId: job, candidateId: candidate, recruiterId: actor.dbId, finalStatus: 'SUBMITTED' } });
  const schedule = { requestId: randomUUID(), expectedUpdatedAt: sub.updatedAt.toISOString(), l1Status: 'SCHEDULED', l1Date: '2026-10-09T04:30:00Z', l1Remarks: 'Original scheduling remark' };
  await service.update(sub.id, schedule, tenant, actor);
  let current = await service.findOne(sub.id, tenant);
  await service.update(sub.id, { requestId: randomUUID(), expectedUpdatedAt: current.updatedAt.toISOString(), l1Status: 'CLEARED', l1Remarks: 'Result feedback' }, tenant, actor);
  let events = await prisma.submissionEvent.findMany({ where: { submissionId: sub.id }, orderBy: { sequence: 'asc' } });
  assert.equal(events.length, 3);
  assert.deepEqual(events.map(e => e.sequence), [0, 1, 2]);
  assert.equal(events[1].details.changes.l1Remarks.after, 'Original scheduling remark');
  assert.equal(events[2].details.changes.l1Remarks.before, 'Original scheduling remark');
  assert.equal(events[2].details.changes.l1Remarks.after, 'Result feedback');
  // A replay cannot duplicate the event, even after a later update.
  await service.update(sub.id, schedule, tenant, actor);
  assert.equal(await prisma.submissionEvent.count({ where: { submissionId: sub.id } }), 3);
  await assert.rejects(service.update(sub.id, { ...schedule, l1Remarks: 'Different request' }, tenant, actor), /request ID/);
  current = await service.findOne(sub.id, tenant);
  const concurrent = await Promise.allSettled(['A', 'B'].map(text => service.update(sub.id, {
    requestId: randomUUID(), expectedUpdatedAt: current.updatedAt.toISOString(), recruiterComment: text,
  }, tenant, actor)));
  assert.equal(concurrent.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(await prisma.submissionEvent.count({ where: { submissionId: sub.id } }), 4);
  current = await service.findOne(sub.id, tenant);
  await prisma.$executeRawUnsafe("CREATE FUNCTION ats.fail_history_test() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'forced history failure'; END $$");
  await prisma.$executeRawUnsafe('CREATE TRIGGER fail_history_test BEFORE INSERT ON ats.submission_events FOR EACH ROW EXECUTE FUNCTION ats.fail_history_test()');
  await assert.rejects(service.update(sub.id, { requestId: randomUUID(), recruiterComment: 'Must roll back' }, tenant, actor));
  assert.equal((await service.findOne(sub.id, tenant)).recruiterComment, current.recruiterComment);
  assert.equal(await prisma.submissionEvent.count({ where: { submissionId: sub.id } }), 4);
  await prisma.$executeRawUnsafe('DROP TRIGGER fail_history_test ON ats.submission_events');
  await prisma.$executeRawUnsafe('DROP FUNCTION ats.fail_history_test()');
  await service.update(sub.id, { requestId: randomUUID(), finalStatus: 'JOIN', bypassReason: 'Client hired after L1', remarks: 'Joining confirmed' }, tenant, actor);
  current = await service.findOne(sub.id, tenant);
  assert.equal(current.finalStatus, 'JOIN');
  assert.equal(current.l2Status, null);
  assert.equal(current.l3Status, null);
  events = await prisma.submissionEvent.findMany({ where: { submissionId: sub.id }, orderBy: { sequence: 'asc' } });
  assert.equal(events.at(-1).details.bypassReason, 'Client hired after L1');
  const history = await service.history(sub.id, tenant, actor, undefined, 1);
  assert.equal(history.total, 5);
  assert.equal(history.data[0].kind, 'BASELINE');
  await assert.rejects(service.history(sub.id, randomUUID(), actor), /tenant scope/);
  console.log('PASS: preserved remarks, ordered history, replay, concurrent saves, rollback, tenant scope, and direct joining');
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => prisma.$disconnect());
