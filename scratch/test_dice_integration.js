const { Pool } = require('pg');
require('dotenv').config({ path: './.env' });

async function verifyDiceIntegration() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error('DATABASE_URL missing');
    process.exit(1);
  }

  const pool = new Pool({
    connectionString,
    ssl: connectionString.includes('supabase') ? { rejectUnauthorized: false } : undefined,
  });

  try {
    console.log('Connecting to database...');
    const tenantId = 'd3b07384-d113-49c3-a555-9ee75c13ca33';

    // 1. Check table existence
    console.log('Verifying tenant_dice_integrations table DDL...');
    await pool.query(`
      CREATE TABLE IF NOT EXISTS tenant_dice_integrations (
        tenant_id UUID PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
        client_id VARCHAR(255),
        client_secret TEXT,
        account_id VARCHAR(255),
        access_token TEXT,
        token_expires_at TIMESTAMP WITH TIME ZONE,
        is_active BOOLEAN DEFAULT TRUE,
        daily_view_limit INT DEFAULT 500,
        views_used_today INT DEFAULT 0,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );
    `);

    // 2. Insert test Dice settings
    console.log('Saving test Dice API settings for tenant...');
    await pool.query(`
      INSERT INTO tenant_dice_integrations (tenant_id, client_id, client_secret, account_id, is_active, daily_view_limit)
      VALUES ($1, 'test_dice_client_id', 'test_dice_secret', 'ACC-TEST-99', true, 500)
      ON CONFLICT (tenant_id) DO UPDATE SET
        client_id = EXCLUDED.client_id,
        client_secret = EXCLUDED.client_secret,
        updated_at = NOW()
    `, [tenantId]);

    // 3. Verify settings retrieval
    const settingsRes = await pool.query('SELECT * FROM tenant_dice_integrations WHERE tenant_id = $1', [tenantId]);
    console.log('Retrieved Dice Settings:', {
      client_id: settingsRes.rows[0].client_id,
      account_id: settingsRes.rows[0].account_id,
      daily_view_limit: settingsRes.rows[0].daily_view_limit,
    });

    // 4. Test candidate import simulation
    console.log('Simulating Dice candidate import into database...');
    const candidateRes = await pool.query(`
      INSERT INTO candidates (tenant_id, full_name, email, phone, raw_current_location, raw_current_designation, work_authorization, source)
      VALUES ($1, 'Vikram Sharma (Dice)', 'vikram.sharma.test@dice-talent.com', '+14695550182', 'Dallas, TX', 'Senior Full Stack Developer', 'US Citizen', 'Dice')
      RETURNING id, full_name, source
    `, [tenantId]);

    console.log('Imported Candidate Result:', candidateRes.rows[0]);

    // Clean up test candidate
    await pool.query('DELETE FROM candidates WHERE id = $1', [candidateRes.rows[0].id]);
    console.log('Cleaned up test imported candidate.');

    console.log('\nDICE INTEGRATION VERIFICATION SUCCESSFUL!');
  } catch (err) {
    console.error('Dice Integration Verification Failed:', err);
  } finally {
    await pool.end();
  }
}

verifyDiceIntegration();
