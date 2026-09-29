const { Client } = require('pg');
require('dotenv').config();

const client = new Client({ connectionString: process.env.DATABASE_URL });
client.connect().then(async () => {
  const r = await client.query("SELECT column_name, data_type FROM information_schema.columns WHERE table_schema = 'ats' AND table_name = 'jobs' AND column_name IN ('account_manager_id', 'recruitment_manager_id', 'primary_recruiter_id', 'created_by', 'approved_by', 'assigned_approver_id')");
  console.table(r.rows);
  await client.end();
});
