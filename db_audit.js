const { Client } = require('pg');
require('dotenv').config();

const client = new Client({ connectionString: process.env.DATABASE_URL });

async function audit() {
  await client.connect();
  const res = await client.query(`
    SELECT table_name, column_name, data_type
    FROM information_schema.columns 
    WHERE table_schema = 'ats' 
    AND (
      (column_name LIKE '%_name' AND column_name NOT IN ('name', 'first_name', 'last_name', 'file_name', 'company_name', 'client_name', 'end_client_name')) OR
      (column_name LIKE '%_by' AND data_type != 'uuid') OR
      (column_name LIKE '%_to' AND data_type != 'uuid') OR
      (column_name LIKE '%_id' AND data_type != 'uuid') OR
      (column_name LIKE '%_role' AND data_type != 'uuid')
    )
    ORDER BY table_name, column_name;
  `);
  console.table(res.rows);
  await client.end();
}

audit();
