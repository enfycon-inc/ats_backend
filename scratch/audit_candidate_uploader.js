require('dotenv').config();
const { Client } = require('pg');

async function auditCandidateUploader() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL
  });
  await client.connect();

  console.log('=== 1. CHECK CANDIDATE COLUMNS FOR CREATOR/RECRUITER AUDIT ===');
  const schemaRes = await client.query(`
    SELECT column_name, data_type, is_nullable
    FROM information_schema.columns
    WHERE table_name = 'candidates'
    AND column_name LIKE '%user%' OR column_name LIKE '%by%' OR column_name LIKE '%recruiter%' OR column_name LIKE '%created%'
  `);
  console.table(schemaRes.rows);

  console.log('\n=== 2. CHECK CANDIDATE CREATED_AT & ID SAMPLE ===');
  const sampleRes = await client.query(`
    SELECT id, full_name, email, source, created_at
    FROM candidates
    ORDER BY id DESC
    LIMIT 10
  `);
  console.table(sampleRes.rows);

  console.log('\n=== 3. AUDIT SUBMISSION CREATION FLOW (HOW CANDIDATE IS LINKED) ===');
  const subRes = await client.query(`
    SELECT s.id as submission_id, s.candidate_id, c.full_name as candidate_name, s.recruiter_id, u.full_name as recruiter_name, s.created_at
    FROM recruiter_submissions s
    JOIN candidates c ON s.candidate_id = c.id
    LEFT JOIN users u ON s.recruiter_id = u.id::varchar
    ORDER BY s.id DESC
    LIMIT 10
  `);
  console.table(subRes.rows);

  await client.end();
}

auditCandidateUploader();
