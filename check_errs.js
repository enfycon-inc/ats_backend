const { Client } = require('pg');
require('dotenv').config();

const client = new Client({ connectionString: process.env.DATABASE_URL });

async function fixRequired() {
  await client.connect();
  const r = await client.query(`
    SELECT table_name, column_name, data_type 
    FROM information_schema.columns 
    WHERE table_schema = 'ats' 
    AND table_name IN ('bulk_uploads', 'job_assignment_logs') 
    AND column_name IN ('created_by', 'assigned_by')
  `);
  console.table(r.rows);
  await client.end();
}
fixRequired();
