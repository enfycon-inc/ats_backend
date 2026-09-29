const { Client } = require('pg');
require('dotenv').config();

const client = new Client({ connectionString: process.env.DATABASE_URL });

async function fixRequired() {
  await client.connect();
  try {
    // job_assignment_logs
    await client.query(`ALTER TABLE ats.job_assignment_logs ALTER COLUMN assigned_by DROP DEFAULT;`);
    await client.query(`DELETE FROM ats.job_assignment_logs WHERE assigned_by !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'`);
    await client.query(`ALTER TABLE ats.job_assignment_logs ALTER COLUMN assigned_by TYPE UUID USING assigned_by::uuid`);

    console.log('✅ job_assignment_logs fixed');
  } catch (e) { console.log(e.message); }
  await client.end();
}
fixRequired();
