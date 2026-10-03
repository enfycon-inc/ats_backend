const { Client } = require('pg');
const client = new Client('postgresql://ats_user:AtsDevPass2024@13.55.100.200:5432/ats_db?schema=ats');
client.connect();
client.query(`SELECT column_name, data_type FROM information_schema.columns WHERE table_schema = 'ats' AND table_name = 'jobs' ORDER BY ordinal_position`).then(res => { console.table(res.rows); client.end(); });