const { Client } = require('pg');
require('dotenv').config();
const client = new Client({ connectionString: process.env.DATABASE_URL });

client.connect().then(async () => {
  console.log('='.repeat(80));
  console.log('FULL DATABASE AUDIT: ID vs Name/Email Inconsistencies');
  console.log('='.repeat(80));

  // ── 1. JOBS TABLE ───────────────────────────────────────────────────────────
  console.log('\n[1] ats.jobs — created_by column');
  const jobsCreatedBy = await client.query(`
    SELECT 
      j.job_code,
      j.created_by,
      CASE 
        WHEN j.created_by ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN 'UUID'
        WHEN j.created_by LIKE '%@%' THEN 'EMAIL'
        ELSE 'NAME_OR_OTHER'
      END AS value_type,
      u.email AS resolved_email,
      u.full_name AS resolved_name
    FROM ats.jobs j
    LEFT JOIN ats.users u ON u.id::text = j.created_by OR LOWER(u.email) = LOWER(j.created_by) OR LOWER(u.full_name) = LOWER(j.created_by)
    ORDER BY value_type, j.created_at DESC
  `);
  const byType = {};
  jobsCreatedBy.rows.forEach(r => {
    byType[r.value_type] = (byType[r.value_type] || 0) + 1;
  });
  console.log('  Type breakdown:', JSON.stringify(byType));
  // Show the non-UUID ones
  const nonUuid = jobsCreatedBy.rows.filter(r => r.value_type !== 'UUID');
  if (nonUuid.length > 0) {
    console.log('  ❌ Non-UUID created_by values:');
    nonUuid.forEach(r => console.log(`    job=${r.job_code} | created_by="${r.created_by}" | type=${r.value_type} | resolved=${r.resolved_email || r.resolved_name || 'UNRESOLVABLE'}`));
  } else {
    console.log('  ✅ All created_by are UUIDs');
  }

  // ── 2. JOBS TABLE — assigned_to ────────────────────────────────────────────
  console.log('\n[2] ats.jobs — assigned_to column');
  const jobsAssignedTo = await client.query(`
    SELECT 
      j.job_code,
      j.assigned_to,
      CASE 
        WHEN j.assigned_to IS NULL OR TRIM(j.assigned_to) = '' THEN 'NULL/EMPTY'
        WHEN j.assigned_to ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN 'UUID'
        WHEN UPPER(j.assigned_to) IN ('ALL','UNASSIGNED','N/A','NONE') THEN 'MAGIC_STRING'
        WHEN j.assigned_to LIKE '%@%' THEN 'EMAIL'
        ELSE 'NAME_OR_OTHER'
      END AS value_type
    FROM ats.jobs j
    WHERE j.deleted_at IS NULL
    ORDER BY value_type
  `);
  const byType2 = {};
  jobsAssignedTo.rows.forEach(r => { byType2[r.value_type] = (byType2[r.value_type] || 0) + 1; });
  console.log('  Type breakdown:', JSON.stringify(byType2));
  const nonUuid2 = jobsAssignedTo.rows.filter(r => !['UUID','NULL/EMPTY','MAGIC_STRING'].includes(r.value_type));
  if (nonUuid2.length > 0) {
    console.log('  ❌ Non-UUID/Non-magic assigned_to values:');
    nonUuid2.slice(0, 20).forEach(r => console.log(`    job=${r.job_code} | assigned_to="${r.assigned_to}" | type=${r.value_type}`));
  } else {
    console.log('  ✅ All assigned_to are UUIDs, magic strings, or null');
  }

  // ── 3. RECRUITER SUBMISSIONS ────────────────────────────────────────────────
  console.log('\n[3] ats.recruiter_submissions — key columns');
  const subCols = await client.query(`
    SELECT column_name FROM information_schema.columns 
    WHERE table_schema = 'ats' AND table_name = 'recruiter_submissions'
    ORDER BY ordinal_position
  `);
  console.log('  Columns:', subCols.rows.map(r => r.column_name).join(', '));

  // Check recruiter_id, candidate_id, job_id
  const subs = await client.query(`
    SELECT 
      rs.id,
      rs.recruiter_id,
      rs.candidate_id,
      rs.job_id,
      CASE WHEN rs.recruiter_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN 'UUID' WHEN rs.recruiter_id LIKE '%@%' THEN 'EMAIL' ELSE 'NAME_OR_OTHER' END AS recruiter_id_type,
      CASE WHEN rs.candidate_id::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN 'UUID' WHEN rs.candidate_id::text LIKE '%@%' THEN 'EMAIL' ELSE 'NAME_OR_OTHER' END AS candidate_id_type,
      CASE WHEN rs.job_id::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN 'UUID' ELSE 'NAME_OR_OTHER' END AS job_id_type
    FROM ats.recruiter_submissions rs
    LIMIT 20
  `);
  if (subs.rows.length > 0) {
    const badSubs = subs.rows.filter(r => r.recruiter_id_type !== 'UUID' || r.candidate_id_type !== 'UUID' || r.job_id_type !== 'UUID');
    if (badSubs.length > 0) {
      console.log('  ❌ Non-UUID reference columns:');
      badSubs.forEach(r => console.log(`    id=${r.id} | recruiter_id=${r.recruiter_id_type} | candidate_id=${r.candidate_id_type} | job_id=${r.job_id_type}`));
    } else {
      console.log('  ✅ recruiter_submissions FK columns are all UUIDs');
    }
  }

  // ── 4. CANDIDATES TABLE ─────────────────────────────────────────────────────
  console.log('\n[4] ats.candidates — ownership columns');
  const candCols = await client.query(`
    SELECT column_name FROM information_schema.columns 
    WHERE table_schema = 'ats' AND table_name = 'candidates'
    AND column_name IN ('recruiter_id','created_by','assigned_to','owner_id','account_manager_id')
    ORDER BY ordinal_position
  `);
  console.log('  Relevant columns:', candCols.rows.map(r => r.column_name).join(', '));
  for (const col of candCols.rows) {
    const cname = col.column_name;
    const res = await client.query(`
      SELECT 
        "${cname}" AS val,
        CASE 
          WHEN "${cname}" IS NULL OR TRIM("${cname}"::text) = '' THEN 'NULL/EMPTY'
          WHEN "${cname}"::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN 'UUID'
          WHEN "${cname}"::text LIKE '%@%' THEN 'EMAIL'
          ELSE 'NAME_OR_OTHER'
        END AS vtype,
        count(*) as cnt
      FROM ats.candidates
      GROUP BY "${cname}", vtype
      ORDER BY vtype
    `);
    const breakdown = {};
    res.rows.forEach(r => { breakdown[r.vtype] = (breakdown[r.vtype] || 0) + parseInt(r.cnt); });
    const hasBad = Object.keys(breakdown).some(k => !['UUID','NULL/EMPTY'].includes(k));
    console.log(`  ${hasBad ? '❌' : '✅'} ${cname}: ${JSON.stringify(breakdown)}`);
    if (hasBad) {
      res.rows.filter(r => !['UUID','NULL/EMPTY'].includes(r.vtype)).forEach(r =>
        console.log(`      val="${r.val}" (${r.vtype}) × ${r.cnt}`)
      );
    }
  }

  // ── 5. JOBS — other reference columns ────────────────────────────────────────
  console.log('\n[5] ats.jobs — all reference/ID columns');
  const refCols = ['primary_recruiter_id', 'recruitment_manager_id', 'assigned_approver_id', 'account_manager_id', 'branch_id', 'business_unit_id'];
  for (const col of refCols) {
    try {
      const res = await client.query(`
        SELECT 
          CASE 
            WHEN "${col}" IS NULL THEN 'NULL'
            WHEN "${col}"::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN 'UUID'
            WHEN "${col}"::text LIKE '%@%' THEN 'EMAIL'
            ELSE 'NAME_OR_OTHER'
          END AS vtype,
          count(*) as cnt
        FROM ats.jobs
        WHERE deleted_at IS NULL
        GROUP BY vtype
      `);
      const breakdown = {};
      res.rows.forEach(r => { breakdown[r.vtype] = parseInt(r.cnt); });
      const hasBad = Object.keys(breakdown).some(k => !['UUID','NULL'].includes(k));
      console.log(`  ${hasBad ? '❌' : '✅'} ${col}: ${JSON.stringify(breakdown)}`);
    } catch(e) { console.log(`  ⚠️  ${col}: column may not exist`); }
  }

  // ── 6. RECRUITER SUBMISSIONS — all columns check ────────────────────────────
  console.log('\n[6] ats.recruiter_submissions — submission_manager, account_manager columns');
  const subRefCols = ['submission_manager_id','account_manager_id','recruitment_manager_id','pod_lead_id'];
  for (const col of subRefCols) {
    try {
      const res = await client.query(`
        SELECT 
          CASE 
            WHEN "${col}" IS NULL OR "${col}"::text = '' THEN 'NULL'
            WHEN "${col}"::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN 'UUID'
            WHEN "${col}"::text LIKE '%@%' THEN 'EMAIL'
            ELSE 'NAME_OR_OTHER'
          END AS vtype,
          count(*) as cnt
        FROM ats.recruiter_submissions
        GROUP BY vtype
      `);
      const breakdown = {};
      res.rows.forEach(r => { breakdown[r.vtype] = parseInt(r.cnt); });
      const hasBad = Object.keys(breakdown).some(k => !['UUID','NULL'].includes(k));
      console.log(`  ${hasBad ? '❌' : '✅'} ${col}: ${JSON.stringify(breakdown)}`);
    } catch(e) { console.log(`  ⚠️  ${col}: column does not exist`); }
  }

  // ── 7. ORPHAN CHECK — jobs with created_by UUID that has no user match ──────
  console.log('\n[7] Orphan check — jobs.created_by UUID not in users table');
  const orphans = await client.query(`
    SELECT j.job_code, j.created_by
    FROM ats.jobs j
    WHERE j.created_by ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    AND j.deleted_at IS NULL
    AND NOT EXISTS (SELECT 1 FROM ats.users u WHERE u.id::text = j.created_by)
  `);
  if (orphans.rows.length > 0) {
    console.log(`  ❌ ${orphans.rows.length} jobs with created_by UUID pointing to non-existent user:`);
    orphans.rows.forEach(r => console.log(`    job=${r.job_code} | created_by=${r.created_by}`));
  } else {
    console.log('  ✅ No orphan created_by references');
  }

  // ── 8. Users table — branch/unit IDs ─────────────────────────────────────────
  console.log('\n[8] ats.users — branch_id, business_unit_id FK check');
  const userBranchOrphans = await client.query(`
    SELECT u.email, u.branch_id
    FROM ats.users u
    WHERE u.branch_id IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM ats.branches b WHERE b.id = u.branch_id)
  `);
  if (userBranchOrphans.rows.length > 0) {
    console.log('  ❌ Users with branch_id not in branches:');
    userBranchOrphans.rows.forEach(r => console.log(`    email=${r.email} | branch_id=${r.branch_id}`));
  } else {
    console.log('  ✅ All user branch_id references are valid');
  }

  // ── 9. SUMMARY ──────────────────────────────────────────────────────────────
  console.log('\n' + '='.repeat(80));
  console.log('AUDIT COMPLETE');
  console.log('='.repeat(80));

  await client.end();
}).catch(e => console.error('FATAL:', e.message, e.stack));
