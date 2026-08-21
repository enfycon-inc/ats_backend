const { Client } = require('pg');
require('dotenv').config();

async function seed() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  const options = [
    'NA',
    'Internal Screening NA - Submitted to Client',
    'Internal Screening Pending',
    'Internal Screening Scheduled',
    'Candidate Noshow',
    'Internal Screening Rescheduled',
    'Internal Screening Completed - Pending Feedback',
    'Selected in Internal Screening - Position went on Hold',
    'Selected in Internal Screening - Submitted to Client',
    'Selected in Internal Screening - Yet to Submit to Client',
    'Rejected in Internal Screening',
    'Candidate Not Responding',
    'Selected in Internal Screening - Position Closed by Client',
    'Rejected - Duplicate'
  ];

  const tenantsRes = await client.query('SELECT id FROM tenants');
  for (const t of tenantsRes.rows) {
    for (const opt of options) {
      const exists = await client.query(
        'SELECT id FROM tenant_stage_remarks WHERE tenant_id = $1 AND stage = $2 AND remark_text = $3',
        [t.id, 'review', opt]
      );
      if (exists.rows.length === 0) {
        await client.query(
          'INSERT INTO tenant_stage_remarks (tenant_id, stage, remark_text, created_by) VALUES ($1, $2, $3, $4)',
          [t.id, 'review', opt, 'system']
        );
      }
    }
  }

  console.log('Successfully seeded 14 internal screening evaluation options across all tenants.');
  await client.end();
}

seed().catch(console.error);
