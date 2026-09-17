// Read-only inspection of a single user's role assignments on the configured DB.
require('dotenv').config({ quiet: true });
const { Client } = require('pg');

async function main() {
  const email = process.argv[2];
  if (!email) throw new Error('Usage: node test/inspect-user-roles.cjs <email>');
  const url = new URL(process.env.DATABASE_URL);
  console.log(JSON.stringify({ databaseHost: url.hostname, email }));
  const client = new Client({ connectionString: url.toString(), connectionTimeoutMillis: 10000 });
  try {
    await client.connect();
    await client.query('BEGIN READ ONLY');
    const result = await client.query(`
      SELECT u.id, u.email, u.tenant_id, u.branch_id, u.role_id, u.assigned_role_ids,
             u.updated_at, b.name AS branch_name,
             (SELECT jsonb_agg(jsonb_build_object('id', cr.id, 'name', cr.name,
                         'isPrimary', cr.id = u.role_id, 'branchId', cr.branch_id,
                         'canDelegate', cr.permissions::jsonb ? 'job:delegate',
                         'canAcceptDelegation', cr.permissions::jsonb ? 'job:accept_delegation'))
              FROM ats.custom_roles cr
              WHERE cr.tenant_id = u.tenant_id
                AND (cr.id = u.role_id OR cr.id = ANY(u.assigned_role_ids))) AS assigned_roles
      FROM ats.users u LEFT JOIN ats.branches b ON b.id = u.branch_id
      WHERE LOWER(u.email) = LOWER($1)`, [email]);
    console.log(JSON.stringify(result.rows, null, 2));
    await client.query('ROLLBACK');
  } finally {
    await client.end();
  }
}
main().catch(error => { console.error(error.code || error.message); process.exitCode = 1; });
