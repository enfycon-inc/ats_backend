require('dotenv').config();
const { Client } = require('pg');

async function checkJob() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL
  });
  await client.connect();

  console.log('=== 1. CHECK JOB BBS-260814-D0001 ===');
  const jobRes = await client.query(`
    SELECT j.*,
           u_am.full_name as am_user_fullname, u_am.email as am_user_email,
           u_cb.full_name as cb_user_fullname, u_cb.email as cb_user_email
    FROM jobs j
    LEFT JOIN users u_am ON j.account_manager_id::text = u_am.id::text
    LEFT JOIN users u_cb ON j.created_by::text = u_cb.email OR j.created_by::text = u_cb.full_name OR j.created_by::text = u_cb.id::text
    WHERE j.job_code = 'BBS-260814-D0001'
  `);
  console.log('Job Records:', JSON.stringify(jobRes.rows, null, 2));

  console.log('\n=== 2. CHECK SUBMISSION FOR JOB BBS-260814-D0001 ===');
  const subRes = await client.query(`
    SELECT s.*
    FROM recruiter_submissions s
    WHERE s.job_code = 'BBS-260814-D0001'
  `);
  console.log('Submission Records:', JSON.stringify(subRes.rows, null, 2));

  await client.end();
}

checkJob();
