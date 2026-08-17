const { Client } = require('pg');
const { JobsService } = require('../dist/src/jobs/jobs.service');

async function testMonthlyJobCode() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  const tenantRes = await client.query('SELECT id FROM tenants LIMIT 1');
  const tenantId = tenantRes.rows[0].id;
  
  const branchRes = await client.query('SELECT id, code, name FROM branches WHERE tenant_id = $1 LIMIT 1', [tenantId]);
  const branchId = branchRes.rows[0]?.id;

  const service = Object.create(JobsService.prototype);
  service.db = { query: (q, params) => client.query(q, params) };

  const codeDay = await service.getNextJobCode(tenantId, branchId, 'DAY');
  const codeNight = await service.getNextJobCode(tenantId, branchId, 'NIGHT');

  console.log('=== VERIFIED JOB CODE GENERATION ===');
  console.log('Day Shift Job Code  :', codeDay);
  console.log('Night Shift Job Code :', codeNight);

  await client.end();
}

testMonthlyJobCode().catch(console.error);
