require('dotenv').config();
const { Client } = require('pg');

async function checkEmailAccounts() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL
  });
  await client.connect();

  console.log('=== CHECK EMAIL ACCOUNTS IN DATABASE ===');
  const res = await client.query(`
    SELECT ea.id, ea.provider, ea.email_address, ea.tenant_id, ea.user_id, ea.is_active,
           u.full_name as user_fullname, u.email as user_email, t.name as tenant_name
    FROM mass_mail.email_accounts ea
    LEFT JOIN users u ON ea.user_id::text = u.id::text
    LEFT JOIN tenants t ON ea.tenant_id = t.id
  `);
  console.log(JSON.stringify(res.rows, null, 2));

  await client.end();
}

checkEmailAccounts();
