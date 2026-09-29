require('dotenv').config();
const { Client } = require('pg');
const client = new Client({ connectionString: process.env.DATABASE_URL });
client.connect().then(async () => {
  try {
    const res = await client.query(`SELECT LPAD(5::text, 32, '0')::uuid as uuid`);
    console.log('UUID:', res.rows[0].uuid);
  } catch (e) {
    console.error(e);
  } finally {
    process.exit(0);
  }
});
