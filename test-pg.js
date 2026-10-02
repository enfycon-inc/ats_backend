const { Client } = require('pg');
const client = new Client({ connectionString: 'postgresql://ats_user:AtsDevPass2024@13.55.100.200:5432/ats_db?schema=ats' });

async function main() {
  await client.connect();
  const res = await client.query('SELECT b.name as branch_name, bu.name as unit_name, ms.code as segment_code FROM ats.business_units bu JOIN ats.branches b ON bu.branch_id = b.id JOIN ats.market_segments ms ON bu.market_segment_id = ms.id');
  console.table(res.rows);
}
main().catch(console.error).finally(() => client.end());
