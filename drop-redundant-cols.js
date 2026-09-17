const { Client } = require('pg');

const client = new Client({
  connectionString: 'postgresql://ats_user:AtsDevPass2024@13.55.100.200:5432/ats_db',
});

async function main() {
  await client.connect();

  console.log('Dropping branch_roles and assigned_branch_ids columns...');
  
  try {
    await client.query(`
      ALTER TABLE ats.users 
      DROP COLUMN IF EXISTS branch_roles,
      DROP COLUMN IF EXISTS assigned_branch_ids;
    `);
    console.log('✅ Columns dropped successfully.');
  } catch (e) {
    console.error('Error dropping columns:', e);
  }
  
  await client.end();
}

main().catch(console.error);
