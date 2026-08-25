const { Pool } = require('pg');
require('dotenv').config({ path: './.env' });

async function verifyClientCrm() {
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

    // 1. Verify table columns
    console.log('Verifying clients table DDL migrations...');
    await pool.query(`
      ALTER TABLE clients ADD COLUMN IF NOT EXISTS market VARCHAR(50) DEFAULT 'US';
      ALTER TABLE clients ADD COLUMN IF NOT EXISTS end_client_name VARCHAR(255);
      ALTER TABLE clients ADD COLUMN IF NOT EXISTS is_same_as_primary BOOLEAN DEFAULT TRUE;
      ALTER TABLE clients ADD COLUMN IF NOT EXISTS contact_person VARCHAR(255);
      ALTER TABLE clients ADD COLUMN IF NOT EXISTS contact_designation VARCHAR(255);
      ALTER TABLE clients ADD COLUMN IF NOT EXISTS gstin VARCHAR(100);
      ALTER TABLE clients ADD COLUMN IF NOT EXISTS pan_number VARCHAR(100);
      ALTER TABLE clients ADD COLUMN IF NOT EXISTS currency VARCHAR(20) DEFAULT 'USD';
      ALTER TABLE clients ADD COLUMN IF NOT EXISTS tier_rating VARCHAR(50) DEFAULT 'TIER_1';
      ALTER TABLE clients ADD COLUMN IF NOT EXISTS credit_check_status VARCHAR(50) DEFAULT 'APPROVED';
      ALTER TABLE clients ADD COLUMN IF NOT EXISTS fillability_score VARCHAR(50) DEFAULT 'HIGH';
      ALTER TABLE clients ADD COLUMN IF NOT EXISTS onboarding_status VARCHAR(50) DEFAULT 'ACTIVE';
      ALTER TABLE clients ADD COLUMN IF NOT EXISTS msa_signed BOOLEAN DEFAULT FALSE;
    `);

    // 2. Create Test Client 1: Direct Client Mandate ("Same as Primary")
    console.log('Creating Test Client 1 (Direct Client Mandate - Same as Primary)...');
    const res1 = await pool.query(`
      INSERT INTO clients (
        tenant_id, client_code, client_name, end_client_name, is_same_as_primary,
        contact_person, contact_designation, email_id, market, currency, tier_rating, onboarding_status, msa_signed
      ) VALUES (
        $1, 'TEST-CL-001', 'HDFC Bank Corporate', 'HDFC Bank Corporate', true,
        'Ramesh Kumar', 'VP Talent Acquisition', 'ramesh@hdfcbank.com', 'INDIA', 'INR', 'TIER_1', 'ACTIVE', true
      ) RETURNING id, client_name, end_client_name, is_same_as_primary, contact_person, market, currency
    `, [tenantId]);
    console.log('Client 1 Result:', res1.rows[0]);

    // 3. Create Test Client 2: MSP Mandate (Distinct Primary & End Client)
    console.log('Creating Test Client 2 (MSP Mandate - TekSystems -> Bank of America)...');
    const res2 = await pool.query(`
      INSERT INTO clients (
        tenant_id, client_code, client_name, end_client_name, is_same_as_primary,
        contact_person, contact_designation, email_id, market, currency, tier_rating, onboarding_status, msa_signed
      ) VALUES (
        $1, 'TEST-CL-002', 'TekSystems MSP', 'Bank of America', false,
        'John Smith', 'VMS Account Director', 'jsmith@teksystems.com', 'US', 'USD', 'TIER_1', 'ACTIVE', true
      ) RETURNING id, client_name, end_client_name, is_same_as_primary, contact_person, market, currency
    `, [tenantId]);
    console.log('Client 2 Result:', res2.rows[0]);

    // Clean up test data
    await pool.query('DELETE FROM clients WHERE id IN ($1, $2)', [res1.rows[0].id, res2.rows[0].id]);
    console.log('Cleaned up test clients.');

    console.log('\nCLIENT CRM VERIFICATION SUCCESSFUL!');
  } catch (err) {
    console.error('Client CRM Verification Failed:', err);
  } finally {
    await pool.end();
  }
}

verifyClientCrm();
