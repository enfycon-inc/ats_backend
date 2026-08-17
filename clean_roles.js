const { Client } = require('pg');

async function cleanStaleRoles() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  const res = await client.query(`
    UPDATE users 
    SET roles = array_replace(roles, 'BDM', 'ACCOUNT_MANAGER')
    WHERE 'BDM' = ANY(roles)
    RETURNING email, roles
  `);
  console.log('Cleaned stale user roles in DB:', res.rows);

  await client.end();
}

cleanStaleRoles().catch(console.error);
