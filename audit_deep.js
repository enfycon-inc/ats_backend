const { Client } = require('pg');
require('dotenv').config();
const client = new Client({ connectionString: process.env.DATABASE_URL });

client.connect().then(async () => {
  console.log('='.repeat(80));
  console.log('DEEP AUDIT: account_manager_id and assigned_to columns');
  console.log('='.repeat(80));

  // ── 1. What is stored in account_manager_id? ────────────────────────────────
  console.log('\n[1] ats.jobs — account_manager_id actual values:');
  const amIds = await client.query(`
    SELECT job_code, account_manager_id, created_by FROM ats.jobs WHERE deleted_at IS NULL ORDER BY created_at
  `);
  amIds.rows.forEach(r => console.log(`  job=${r.job_code} | account_manager_id="${r.account_manager_id}" | created_by="${r.created_by}"`));

  // ── 2. Check if account_manager_id matches any user full_name or email ───────
  console.log('\n[2] Try to resolve account_manager_id to users:');
  const resolve = await client.query(`
    SELECT 
      j.job_code, 
      j.account_manager_id,
      u.id AS user_id,
      u.email,
      u.full_name
    FROM ats.jobs j
    LEFT JOIN ats.users u ON 
      LOWER(u.full_name) = LOWER(j.account_manager_id)
      OR LOWER(u.email) = LOWER(j.account_manager_id)
      OR u.id::text = j.account_manager_id
    WHERE j.deleted_at IS NULL
    ORDER BY j.created_at
  `);
  resolve.rows.forEach(r => {
    const match = r.user_id ? `✅ resolved → ${r.email}` : '❌ UNRESOLVABLE';
    console.log(`  job=${r.job_code} | am_id="${r.account_manager_id}" | ${match}`);
  });

  // ── 3. What column type is account_manager_id? ──────────────────────────────
  console.log('\n[3] Column type of account_manager_id:');
  const colType = await client.query(`
    SELECT column_name, data_type, character_maximum_length 
    FROM information_schema.columns 
    WHERE table_schema = 'ats' AND table_name = 'jobs' AND column_name = 'account_manager_id'
  `);
  console.log(' ', JSON.stringify(colType.rows[0]));

  // ── 4. assigned_to full breakdown + try to resolve ───────────────────────────
  console.log('\n[4] ats.jobs — assigned_to full details + resolution attempt:');
  const assignedTo = await client.query(`
    SELECT 
      j.job_code, 
      j.assigned_to,
      j.primary_recruiter_id,
      pr.full_name as primary_recruiter_name,
      pr.email as primary_recruiter_email
    FROM ats.jobs j
    LEFT JOIN ats.users pr ON pr.id = j.primary_recruiter_id
    WHERE j.deleted_at IS NULL
    ORDER BY j.created_at
  `);
  assignedTo.rows.forEach(r => {
    console.log(`  job=${r.job_code}`);
    console.log(`    assigned_to="${r.assigned_to}"`);
    console.log(`    primary_recruiter_id=${r.primary_recruiter_id || 'NULL'} (${r.primary_recruiter_name || 'N/A'} / ${r.primary_recruiter_email || 'N/A'})`);
  });

  // ── 5. Check what column type jobs has (text vs uuid) ────────────────────────
  console.log('\n[5] Column types for all jobs reference columns:');
  const allJobCols = await client.query(`
    SELECT column_name, data_type 
    FROM information_schema.columns 
    WHERE table_schema = 'ats' AND table_name = 'jobs'
    AND column_name IN ('created_by','assigned_to','account_manager_id','primary_recruiter_id','recruitment_manager_id','assigned_approver_id')
    ORDER BY ordinal_position
  `);
  allJobCols.rows.forEach(r => console.log(`  ${r.column_name}: ${r.data_type}`));

  // ── 6. Check recruiter_submissions for any name/email columns ────────────────
  console.log('\n[6] ats.recruiter_submissions — check l1/l2/l3 interviewer columns:');
  const intCheck = await client.query(`
    SELECT 
      l1_interviewer, l2_interviewer, l3_interviewer,
      CASE WHEN l1_interviewer ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN 'UUID' WHEN l1_interviewer LIKE '%@%' THEN 'EMAIL' WHEN l1_interviewer IS NULL THEN 'NULL' ELSE 'NAME' END AS l1_type,
      CASE WHEN l2_interviewer ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN 'UUID' WHEN l2_interviewer LIKE '%@%' THEN 'EMAIL' WHEN l2_interviewer IS NULL THEN 'NULL' ELSE 'NAME' END AS l2_type,
      CASE WHEN l3_interviewer ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN 'UUID' WHEN l3_interviewer LIKE '%@%' THEN 'EMAIL' WHEN l3_interviewer IS NULL THEN 'NULL' ELSE 'NAME' END AS l3_type
    FROM ats.recruiter_submissions
    WHERE l1_interviewer IS NOT NULL OR l2_interviewer IS NOT NULL OR l3_interviewer IS NOT NULL
    LIMIT 20
  `);
  const intSummary = { l1: {}, l2: {}, l3: {} };
  intCheck.rows.forEach(r => {
    intSummary.l1[r.l1_type] = (intSummary.l1[r.l1_type] || 0) + 1;
    intSummary.l2[r.l2_type] = (intSummary.l2[r.l2_type] || 0) + 1;
    intSummary.l3[r.l3_type] = (intSummary.l3[r.l3_type] || 0) + 1;
  });
  console.log('  l1_interviewer:', JSON.stringify(intSummary.l1));
  console.log('  l2_interviewer:', JSON.stringify(intSummary.l2));
  console.log('  l3_interviewer:', JSON.stringify(intSummary.l3));

  console.log('\n' + '='.repeat(80));
  console.log('DEEP AUDIT COMPLETE');
  console.log('='.repeat(80));

  await client.end();
}).catch(e => console.error('FATAL:', e.message, '\n', e.stack));
