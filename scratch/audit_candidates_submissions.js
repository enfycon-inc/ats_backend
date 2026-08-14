const { Client } = require('pg');

async function auditCandidatesAndSubmissions() {
  const dbUrl = process.env.DATABASE_URL || "postgresql://postgres.zqpxnnsbbqdlhememsyj:EWhbqnM6IWe5IJaV@aws-1-ap-northeast-1.pooler.supabase.com:6543/postgres";
  const client = new Client({ connectionString: dbUrl });

  try {
    await client.connect();

    // 1. Audit Candidates (CVs) per Tenant
    const candidatesRes = await client.query(`
      SELECT c.tenant_id, t.name as tenant_name, COUNT(*) as total_candidates
      FROM candidates c
      LEFT JOIN tenants t ON c.tenant_id = t.id
      GROUP BY c.tenant_id, t.name
    `);
    console.log('--- CANDIDATES / CVs AUDIT PER TENANT ---');
    console.table(candidatesRes.rows);

    // 2. Audit Submissions per Tenant
    const submissionsRes = await client.query(`
      SELECT s.tenant_id, t.name as tenant_name, COUNT(*) as total_submissions
      FROM recruiter_submissions s
      LEFT JOIN tenants t ON s.tenant_id = t.id
      GROUP BY s.tenant_id, t.name
    `);
    console.log('\n--- SUBMISSIONS TRACKER AUDIT PER TENANT ---');
    console.table(submissionsRes.rows);

    // 3. Detailed Submissions Link Verification
    const detailsRes = await client.query(`
      SELECT s.id as submission_id, s.tenant_id, t.name as tenant_name, c.full_name as candidate_name, c.email as candidate_email, j.job_code, j.job_title, s.final_status, s.l1_status
      FROM recruiter_submissions s
      JOIN candidates c ON s.candidate_id = c.id
      JOIN jobs j ON s.job_id = j.id
      LEFT JOIN tenants t ON s.tenant_id = t.id
      ORDER BY s.created_at DESC
      LIMIT 20
    `);
    console.log('\n--- VERIFIED SUBMISSIONS LINKED TO NEW JOB CODES ---');
    console.table(detailsRes.rows);

  } catch (err) {
    console.error('Audit Error:', err);
  } finally {
    await client.end();
  }
}

auditCandidatesAndSubmissions();
