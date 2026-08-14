require('dotenv').config();
const { Client } = require('pg');

async function seedDeliverySettings() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL
  });
  await client.connect();

  console.log('=== SEEDING DELIVERY SETTINGS IN DATABASE ===');

  await client.query(`
    CREATE TABLE IF NOT EXISTS mass_mail.delivery_settings (
      tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
      branch_id VARCHAR(255) NOT NULL DEFAULT 'default',
      rate_per_minute INT NOT NULL DEFAULT 30,
      rate_per_hour INT NOT NULL DEFAULT 500,
      randomize_delay BOOLEAN NOT NULL DEFAULT FALSE,
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      PRIMARY KEY (tenant_id, branch_id)
    );
  `);

  // Insert or update delivery settings for Deb Technology
  await client.query(`
    INSERT INTO mass_mail.delivery_settings (tenant_id, branch_id, rate_per_minute, rate_per_hour, randomize_delay, updated_at)
    VALUES ('fad0ccbf-db00-4560-bbfc-216eea7b107b', 'default', 1, 500, true, NOW())
    ON CONFLICT (tenant_id, branch_id) DO UPDATE
    SET rate_per_minute = EXCLUDED.rate_per_minute,
        rate_per_hour = EXCLUDED.rate_per_hour,
        randomize_delay = EXCLUDED.randomize_delay,
        updated_at = NOW()
  `);

  // Insert for specific branch 4ca219ac-cb28-4a77-90dc-352158b2b772 (bbsr-domestic)
  await client.query(`
    INSERT INTO mass_mail.delivery_settings (tenant_id, branch_id, rate_per_minute, rate_per_hour, randomize_delay, updated_at)
    VALUES ('fad0ccbf-db00-4560-bbfc-216eea7b107b', '4ca219ac-cb28-4a77-90dc-352158b2b772', 1, 500, true, NOW())
    ON CONFLICT (tenant_id, branch_id) DO UPDATE
    SET rate_per_minute = EXCLUDED.rate_per_minute,
        rate_per_hour = EXCLUDED.rate_per_hour,
        randomize_delay = EXCLUDED.randomize_delay,
        updated_at = NOW()
  `);

  const res = await client.query('SELECT * FROM mass_mail.delivery_settings');
  console.log('Delivery Settings Records:', JSON.stringify(res.rows, null, 2));

  await client.end();
}

seedDeliverySettings();
