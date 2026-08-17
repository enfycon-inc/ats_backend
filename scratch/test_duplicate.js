const { Client } = require('pg');
const { JobsService } = require('../dist/src/jobs/jobs.service');

async function testDuplicate() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  const jobRes = await client.query('SELECT id, job_code, job_title, tenant_id FROM jobs ORDER BY created_at DESC LIMIT 1');
  const originalJob = jobRes.rows[0];
  const tenantId = originalJob.tenant_id;
  console.log('=== ORIGINAL JOB ===', originalJob);

  const service = Object.create(JobsService.prototype);
  service.db = { query: (q, params) => client.query(q, params), getClient: () => client };
  service.logger = { log: console.log, error: console.error, warn: console.warn };

  const duplicated = await service.duplicateJob(originalJob.id, tenantId, { email: 'admin@enfycon.com' });
  console.log('=== DUPLICATED JOB RESULT ===');
  console.log('New Job Code :', duplicated.jobCode);
  console.log('New Job Title:', duplicated.jobTitle);
  console.log('Status       :', duplicated.jobStatus);

  await client.end();
}

testDuplicate().catch(console.error);
