const { Client } = require('pg');
const client = new Client('postgresql://ats_user:AtsDevPass2024@13.55.100.200:5432/ats_db?schema=ats');

async function run() {
  await client.connect();
  
  // Run the query step by step to find which join is failing
  
  // Step 1: bare minimum
  try {
    const r = await client.query(`
      SELECT j.id, j.job_title, j.branch_id, j.account_manager_id, j.recruitment_manager_id
      FROM ats.jobs j
      WHERE j.tenant_id = '737f666b-916a-4e9c-91bd-b2bd37e475d1' AND j.deleted_at IS NULL
      LIMIT 3
    `);
    console.log('Step 1 (bare): OK -', r.rows.length, 'rows');
    r.rows.forEach(row => console.log('  branch_id:', JSON.stringify(row.branch_id), '| am_id:', JSON.stringify(row.account_manager_id)));
  } catch(e) { console.error('Step 1 FAILED:', e.message); }

  // Step 2: add users joins
  try {
    const r = await client.query(`
      SELECT j.id, rm.full_name AS rm_name, app.full_name AS app_name
      FROM ats.jobs j
      LEFT JOIN ats.users rm ON rm.id = j.recruitment_manager_id
      LEFT JOIN ats.users app ON app.id = j.assigned_approver_id
      WHERE j.tenant_id = '737f666b-916a-4e9c-91bd-b2bd37e475d1' AND j.deleted_at IS NULL
      LIMIT 3
    `);
    console.log('Step 2 (users join): OK -', r.rows.length, 'rows');
  } catch(e) { console.error('Step 2 FAILED:', e.message); }

  // Step 3: add recruiter_info subquery
  try {
    const r = await client.query(`
      SELECT j.id, COALESCE(ri.recruiter_ids, '') AS recruiter_ids
      FROM ats.jobs j
      LEFT JOIN (
        SELECT jr.job_id, STRING_AGG(u.id::text, ',') AS recruiter_ids, STRING_AGG(u.full_name, ', ') AS recruiter_names
        FROM ats.job_recruiters jr JOIN ats.users u ON u.id = jr.recruiter_id GROUP BY jr.job_id
      ) ri ON ri.job_id = j.id
      WHERE j.tenant_id = '737f666b-916a-4e9c-91bd-b2bd37e475d1' AND j.deleted_at IS NULL
      LIMIT 3
    `);
    console.log('Step 3 (recruiter_info): OK -', r.rows.length, 'rows');
  } catch(e) { console.error('Step 3 FAILED:', e.message); }

  // Step 4: add pod_info subquery
  try {
    const r = await client.query(`
      SELECT j.id, COALESCE(pi.pod_id, '') AS pod_id
      FROM ats.jobs j
      LEFT JOIN (
        SELECT jp.job_id, STRING_AGG(p.id::text, ',') AS pod_id, STRING_AGG(p.name, ', ') AS pod_name
        FROM ats.job_pods jp JOIN ats.pods p ON p.id = jp.pod_id GROUP BY jp.job_id
      ) pi ON pi.job_id = j.id
      WHERE j.tenant_id = '737f666b-916a-4e9c-91bd-b2bd37e475d1' AND j.deleted_at IS NULL
      LIMIT 3
    `);
    console.log('Step 4 (pod_info): OK -', r.rows.length, 'rows');
  } catch(e) { console.error('Step 4 FAILED:', e.message); }

  // Step 5: add uc join (creator via account_manager_id)
  try {
    const r = await client.query(`
      SELECT j.id, uc.full_name AS creator_name
      FROM ats.jobs j
      LEFT JOIN ats.users uc ON (uc.id = j.account_manager_id)
      WHERE j.tenant_id = '737f666b-916a-4e9c-91bd-b2bd37e475d1' AND j.deleted_at IS NULL
      LIMIT 3
    `);
    console.log('Step 5 (creator join): OK -', r.rows.length, 'rows');
  } catch(e) { console.error('Step 5 FAILED:', e.message); }

  // Step 6: add branch/client/bu joins
  try {
    const r = await client.query(`
      SELECT j.id, b.name AS branch_name, cl.client_name, bu.name AS bu_name
      FROM ats.jobs j
      LEFT JOIN ats.branches b ON b.id = j.branch_id
      LEFT JOIN ats.clients cl ON cl.id = j.client_id
      LEFT JOIN ats.clients ecl ON ecl.id = j.end_client_id
      LEFT JOIN ats.business_units bu ON bu.id = j.business_unit_id
      WHERE j.tenant_id = '737f666b-916a-4e9c-91bd-b2bd37e475d1' AND j.deleted_at IS NULL
      LIMIT 3
    `);
    console.log('Step 6 (branch/client/bu): OK -', r.rows.length, 'rows');
  } catch(e) { console.error('Step 6 FAILED:', e.message); }

  await client.end();
}
run().catch(e => console.error('Fatal:', e.message));
