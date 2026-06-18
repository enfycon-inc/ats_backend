const { Client } = require('pg');

async function run() {
  const client = new Client({
    connectionString: "postgresql://postgres.zqpxnnsbbqdlhememsyj:EWhbqnM6IWe5IJaV@aws-1-ap-northeast-1.pooler.supabase.com:6543/postgres",
    ssl: { rejectUnauthorized: false }
  });

  await client.connect();
  
  const tenantsRes = await client.query(`SELECT DISTINCT tenant_id FROM users`);
  const tenants = tenantsRes.rows.map(r => r.tenant_id);
  
  const clientsRes = await client.query(`SELECT * FROM clients WHERE tenant_id = 'd3b07384-d113-49c3-a555-9ee75c13ca33'`);
  const demoClients = clientsRes.rows;
  
  console.log(`Found ${tenants.length} tenants and ${demoClients.length} demo clients.`);
  
  for (const tid of tenants) {
    if (tid === 'd3b07384-d113-49c3-a555-9ee75c13ca33') continue;
    
    for (const c of demoClients) {
      try {
        await client.query(
          `INSERT INTO clients (
            tenant_id, client_code, client_name, contact_number, website, industry,
            state, city, status, category, primary_owner, business_unit, ownership,
            display_on_job_posting, created_by, modified_by
          ) VALUES (
            $1, $2, $3, $4, $5, $6,
            $7, $8, $9, $10, $11, $12, $13,
            $14, $15, $16
          )`,
          [
            tid,
            c.client_code + '-' + tid.substring(0, 4), // prevent unique constraint error on client_code
            c.client_name,
            c.contact_number,
            c.website,
            c.industry,
            c.state,
            c.city,
            c.status,
            c.category,
            c.primary_owner,
            c.business_unit,
            c.ownership,
            c.display_on_job_posting,
            c.created_by,
            c.modified_by
          ]
        );
      } catch (e) {
        // ignore unique violations
      }
    }
    console.log(`Copied for tenant: ${tid}`);
  }
  
  await client.end();
}

run();
