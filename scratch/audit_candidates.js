require('dotenv').config();
const { Client } = require('pg');

async function auditCandidates() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL
  });
  await client.connect();

  console.log('=== 1. CANDIDATE TABLE SCHEMA & ID TYPE ===');
  const schemaRes = await client.query(`
    SELECT column_name, data_type, is_nullable, column_default
    FROM information_schema.columns
    WHERE table_name = 'candidates'
    ORDER BY ordinal_position
  `);
  console.table(schemaRes.rows.map(r => ({ column: r.column_name, type: r.data_type, nullable: r.is_nullable })));

  console.log('\n=== 2. CANDIDATES COUNT BY SOURCE ===');
  const sourceRes = await client.query(`
    SELECT source, COUNT(*) as count
    FROM candidates
    GROUP BY source
    ORDER BY count DESC
  `);
  console.table(sourceRes.rows);

  console.log('\n=== 3. CANDIDATES RELATION WITH RECRUITER SUBMISSIONS ===');
  const relRes = await client.query(`
    SELECT s.id as submission_id, s.final_status, s.job_id, j.job_code, j.job_title,
           c.id as candidate_id, c.full_name as candidate_name, c.email as candidate_email, c.source as candidate_source
    FROM recruiter_submissions s
    JOIN candidates c ON s.candidate_id = c.id
    JOIN jobs j ON s.job_id = j.id
    LIMIT 10
  `);
  console.table(relRes.rows);

  await client.end();
}

auditCandidates();
