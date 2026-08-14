require('dotenv').config();
const { Client } = require('pg');

async function fixEmailAccounts() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL
  });
  await client.connect();

  console.log('=== UPDATING UNLINKED EMAIL ACCOUNTS ===');
  
  // Link unassigned email accounts for Deb Technology tenant to debam@deb.com
  const updateRes = await client.query(`
    UPDATE mass_mail.email_accounts
    SET user_id = 'd2ec2da8-816c-410a-8c0c-4737b5ae21cf'
    WHERE tenant_id = 'fad0ccbf-db00-4560-bbfc-216eea7b107b' AND user_id IS NULL
  `);
  console.log(`Updated ${updateRes.rowCount} email account records with debam user_id.`);

  const res = await client.query(`
    SELECT ea.id, ea.provider, ea.email_address, ea.tenant_id, ea.user_id, ea.is_active,
           u.full_name as user_fullname, u.email as user_email
    FROM mass_mail.email_accounts ea
    LEFT JOIN users u ON ea.user_id::text = u.id::text
    WHERE ea.tenant_id = 'fad0ccbf-db00-4560-bbfc-216eea7b107b'
  `);
  console.log('Verified Email Accounts for Deb Technology:', JSON.stringify(res.rows, null, 2));

  await client.end();
}

fixEmailAccounts();
