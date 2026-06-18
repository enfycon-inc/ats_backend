const { Client } = require('pg');
const client = new Client({ connectionString: 'postgresql://postgres.zqpxnnsbbqdlhememsyj:EWhbqnM6IWe5IJaV@aws-1-ap-northeast-1.pooler.supabase.com:6543/postgres' });

async function run() {
  await client.connect();
  try {
    await client.query("ALTER TABLE clients ADD COLUMN IF NOT EXISTS about_company TEXT");
    await client.query("ALTER TABLE clients ADD COLUMN IF NOT EXISTS stop_notifications BOOLEAN DEFAULT false");
    console.log('Successfully added new columns to clients table.');
  } catch (err) {
    console.error('Error adding columns:', err);
  } finally {
    await client.end();
  }
}
run();
