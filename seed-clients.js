const { Client } = require('pg');

const clients = [
  "Morph Enterprise", "PSCI", "E-IT", "Zen & Art", "A2c", "A2c consulting", 
  "Estrada Consulting, Inc (ECI)", "The Dignify Solutions, LLC", "DK Consulting, LLC", 
  "Adroit Innovative Solutions In", "Iris Software Inc", "TalentBurst, Inc", 
  "Stefanini Group", "The Ash Group", "Pegasus Knowledge Solutions, I...", 
  "ShineBask Technologies", "Digital Health Partners", "Pivot Point Consulting, LLC"
];

async function run() {
  const client = new Client({
    connectionString: "postgresql://postgres.zqpxnnsbbqdlhememsyj:EWhbqnM6IWe5IJaV@aws-1-ap-northeast-1.pooler.supabase.com:6543/postgres",
    ssl: { rejectUnauthorized: false }
  });

  await client.connect();
  const tenantId = 'd3b07384-d113-49c3-a555-9ee75c13ca33';
  const createdBy = 'deb@enfycon.com';

  console.log("Inserting demo clients...");

  for (let i = 0; i < clients.length; i++) {
    const name = clients[i];
    const code = 688 - i; // To mimic the screenshot IDs
    const website = `http://www.${name.replace(/[^a-zA-Z0-9]/g, '').toLowerCase()}.com`;
    
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
          tenantId,
          String(code),
          name,
          '',
          website,
          'Technology',
          '',
          '',
          'Active',
          '',
          'Debi Kar', // From screenshot
          'enfycon Inc', // From screenshot
          'Public',
          true,
          createdBy,
          createdBy
        ]
      );
    } catch(err) {
      // Ignore duplicates
    }
  }
  
  console.log("Done inserting clients.");
  await client.end();
}

run();
