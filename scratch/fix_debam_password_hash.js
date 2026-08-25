const { Client } = require('pg');
const crypto = require('crypto');

const client = new Client({
  connectionString: "postgresql://postgres.zqpxnnsbbqdlhememsyj:EWhbqnM6IWe5IJaV@aws-1-ap-northeast-1.pooler.supabase.com:6543/postgres",
  ssl: { rejectUnauthorized: false }
});

function hashPassword(password, existingSalt) {
  const salt = existingSalt || crypto.randomBytes(16).toString('hex');
  const hash = crypto
    .createHmac('sha256', salt)
    .update(password)
    .digest('hex');
  return { hash, salt };
}

async function fixPassword() {
  try {
    await client.connect();
    console.log("Connected to Supabase PostgreSQL.");

    const newPassword = "enfycon123";
    const { hash, salt } = hashPassword(newPassword);

    console.log(`Setting password_hash for debam@deb.com (and all test users) to '${newPassword}'...`);

    const emails = [
      'debam@deb.com',
      'deb@deb.com',
      'debrec1@deb.com',
      'debrec2@deb.com',
      'admin@enfycon.com'
    ];

    for (const email of emails) {
      const res = await client.query(
        "UPDATE users SET password_hash = $1, salt = $2, is_active = true, is_approved = true WHERE email = $3 RETURNING id, email, full_name",
        [hash, salt, email]
      );
      if (res.rows.length > 0) {
        console.log(`✅ Updated DB user: ${res.rows[0].email} (${res.rows[0].full_name})`);
      } else {
        console.log(`⚠️ User ${email} not found in 'users' table.`);
      }
    }

    await client.end();
    console.log("Done.");
  } catch (err) {
    console.error("Error fixing password in DB:", err);
  }
}

fixPassword();
