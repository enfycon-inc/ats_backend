require('dotenv').config();
const { Client } = require('pg');

async function migrateCandidatesAttribution() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL
  });
  await client.connect();

  console.log('=== MIGRATING CANDIDATES ATTRIBUTION & CODES ===');

  await client.query(`
    ALTER TABLE candidates ADD COLUMN IF NOT EXISTS candidate_code VARCHAR(100);
    ALTER TABLE candidates ADD COLUMN IF NOT EXISTS uploaded_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL;
    ALTER TABLE candidates ADD COLUMN IF NOT EXISTS uploaded_by_name VARCHAR(255);
  `);

  await client.query(`
    UPDATE candidates SET candidate_code = 'CAN-' || LPAD(id::text, 6, '0') WHERE candidate_code IS NULL;
  `);

  const sample = await client.query(`
    SELECT id, candidate_code, full_name, email, source, uploaded_by_name, created_at
    FROM candidates
    ORDER BY id DESC
    LIMIT 5
  `);
  console.log('Updated Candidate Sample:', JSON.stringify(sample.rows, null, 2));

  await client.end();
}

migrateCandidatesAttribution();
