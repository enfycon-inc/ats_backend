const { Client } = require('pg');
const client = new Client({ connectionString: 'postgresql://ats_user:AtsDevPass2024@13.55.100.200:5432/ats_db?schema=ats' });
client.connect().then(() => client.query("SELECT id, email, branch_id FROM ats.users WHERE email = 'am@deb.com'")).then(res => { console.log(res.rows); process.exit(0); });
