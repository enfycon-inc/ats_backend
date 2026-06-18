const { Client } = require('pg');
const client = new Client({ connectionString: 'postgresql://postgres.zqpxnnsbbqdlhememsyj:EWhbqnM6IWe5IJaV@aws-1-ap-northeast-1.pooler.supabase.com:6543/postgres' });
client.connect().then(() => client.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'clients'"))
.then(res => console.log(res.rows.map(r => r.column_name)))
.finally(() => client.end());
