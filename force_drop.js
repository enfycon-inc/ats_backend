const { Client } = require('pg');
require('dotenv').config();

const client = new Client({ connectionString: process.env.DATABASE_URL });

async function drop() {
  await client.connect();
  const cols = [
    'business_unit', 'assigned_to', 'work_start_time', 'work_end_time', 'working_days', 'timing_snapshot_at', 'client_name', 'end_client_name'
  ];
  
  for (const col of cols) {
    try {
      await client.query(`ALTER TABLE ats.jobs DROP COLUMN IF EXISTS ${col}`);
      console.log(`Dropped ${col}`);
    } catch (e) {
      console.log(`Failed to drop ${col}: ${e.message}`);
    }
  }
  
  await client.end();
}

drop();
