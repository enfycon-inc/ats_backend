
const { Client } = require('pg');

async function checkBranches() {
  const dbUrl = process.env.DATABASE_URL || "postgresql://postgres.zqpxnnsbbqdlhememsyj:EWhbqnM6IWe5IJaV@aws-1-ap-northeast-1.pooler.supabase.com:6543/postgres";
  const client = new Client({ connectionString: dbUrl });

  try {
    await client.connect();

    // 1. Branches under Deb Technology
    const branchesRes = await client.query(`
      SELECT b.id, b.tenant_id, t.name as tenant_name, b.name, b.code, b.market
      FROM branches b
      LEFT JOIN tenants t ON b.tenant_id = t.id
      ORDER BY b.created_at ASC
    `);

    console.log('--- ALL BRANCHES IN DATABASE ---');
    console.table(branchesRes.rows);

    // 2. debam@deb.com user details
    const userRes = await client.query(`
      SELECT u.id, u.email, u.full_name, u.tenant_id, u.branch_id, b.name as branch_name, b.code as branch_code, b.market as branch_market
      FROM users u
      LEFT JOIN branches b ON u.branch_id = b.id
      WHERE LOWER(u.email) = 'debam@deb.com'
    `);

    console.log('\n--- DEBAM USER BRANCH ASSIGNMENT ---');
    console.table(userRes.rows);

  } catch (err) {
    console.error('Error:', err);
  } finally {
    await client.end();
  }
}

checkBranches();
