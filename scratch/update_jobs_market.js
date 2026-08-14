const { Client } = require('pg');

async function updateJobMarkets() {
  const dbUrl = process.env.DATABASE_URL || "postgresql://postgres.zqpxnnsbbqdlhememsyj:EWhbqnM6IWe5IJaV@aws-1-ap-northeast-1.pooler.supabase.com:6543/postgres";
  const client = new Client({ connectionString: dbUrl });

  try {
    await client.connect();

    const res = await client.query(`
      UPDATE jobs
      SET market = CASE
        WHEN visa_type ILIKE '%us%' OR visa_type ILIKE '%c2c%' OR visa_type ILIKE '%w2%' THEN 'US'
        ELSE 'IN'
      END
      WHERE market IS NULL OR market = '' OR market = 'US' AND (business_unit ILIKE '%deb%' OR business_unit ILIKE '%bbs%')
    `);

    console.log(`Updated ${res.rowCount} job market tags to match domestic/US segments.`);

  } catch (err) {
    console.error('Update Error:', err);
  } finally {
    await client.end();
  }
}

updateJobMarkets();
