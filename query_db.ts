import { Client } from 'pg';

async function run() {
  const client = new Client({
    connectionString: 'postgresql://postgres.zqpxnnsbbqdlhememsyj:EWhbqnM6IWe5IJaV@aws-1-ap-northeast-1.pooler.supabase.com:6543/postgres'
  });
  await client.connect();
  const res = await client.query(`
    SELECT column_name 
    FROM information_schema.columns 
    WHERE table_name = 'pods'
  `);
  console.log(res.rows);
  await client.end();
}

run();
