const { Client } = require('pg');
const crypto = require('crypto');

async function testPassword() {
  const dbUrl = process.env.DATABASE_URL || "postgresql://postgres.zqpxnnsbbqdlhememsyj:EWhbqnM6IWe5IJaV@aws-1-ap-northeast-1.pooler.supabase.com:6543/postgres";
  const client = new Client({ connectionString: dbUrl });

  try {
    await client.connect();

    const res = await client.query("SELECT password_hash FROM users WHERE LOWER(email) = 'debam@deb.com'");
    if (res.rows.length === 0) {
      console.log('User debam@deb.com not found!');
      return;
    }

    const storedHash = res.rows[0].password_hash;
    console.log('Stored Password Hash:', storedHash);

    // Compute SHA-256 for 'enfycon123'
    const computedHash = crypto.createHash('sha256').update('enfycon123').digest('hex');
    console.log('Computed SHA-256 Hash:', computedHash);

    if (storedHash === computedHash || storedHash === 'enfycon123') {
      console.log('✅ Password matches SHA-256 hash or plaintext!');
    } else {
      console.log('❌ Password mismatch! Updating user password_hash to match enfycon123...');
      await client.query("UPDATE users SET password_hash = $1 WHERE LOWER(email) = 'debam@deb.com'", [computedHash]);
      console.log('✅ Updated password_hash for debam@deb.com to match enfycon123!');
    }

  } catch (err) {
    console.error('Password Test Error:', err);
  } finally {
    await client.end();
  }
}

testPassword();
