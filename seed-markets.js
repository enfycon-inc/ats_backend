const { Client } = require("pg");
const client = new Client({ connectionString: "postgresql://ats_user:AtsDevPass2024@13.55.100.200:5432/ats_db?schema=ats" });

async function seedMarkets() {
  await client.connect();
  
  // 1. Get existing markets to see what we have
  const existing = await client.query(`SELECT id, code, name FROM ats.market_segments;`);
  
  // 2. We want to ensure exactly 3 standard markets exist with specific codes.
  const standardMarkets = [
    { code: 'USIT', name: 'US IT Staffing', currency: 'USD', tz: 'America/New_York' },
    { code: 'IND', name: 'India IT Staffing', currency: 'INR', tz: 'Asia/Kolkata' },
    { code: 'UAE', name: 'UAE Staffing', currency: 'AED', tz: 'Asia/Dubai' }
  ];

  for (const m of standardMarkets) {
    const exists = existing.rows.find(r => r.code === m.code);
    if (exists) {
      await client.query(
        `UPDATE ats.market_segments SET name = $1, default_currency = $2, default_timezone = $3 WHERE code = $4`,
        [m.name, m.currency, m.tz, m.code]
      );
    } else {
      await client.query(
        `INSERT INTO ats.market_segments (id, code, name, default_currency, default_timezone, is_active, created_at, updated_at) 
         VALUES (gen_random_uuid(), $1, $2, $3, $4, true, NOW(), NOW())`,
        [m.code, m.name, m.currency, m.tz]
      );
    }
  }

  // 3. Delete any duplicates or non-standard markets to prevent ambiguity, 
  // BUT we must re-assign business units first to avoid foreign key errors.
  const toDelete = existing.rows.filter(r => !['USIT', 'IND', 'UAE'].includes(r.code));
  
  for (const del of toDelete) {
    // Find a fallback
    const fallbackCode = del.code === 'INDIA' || del.code === 'DOM' ? 'IND' : 'USIT';
    const fallback = await client.query(`SELECT id FROM ats.market_segments WHERE code = $1 LIMIT 1`, [fallbackCode]);
    
    if (fallback.rows.length > 0) {
      await client.query(`UPDATE ats.business_units SET market_segment_id = $1, market = $2 WHERE market_segment_id = $3`, [fallback.rows[0].id, fallbackCode, del.id]);
    }
    await client.query(`DELETE FROM ats.market_segments WHERE id = $1`, [del.id]);
  }

  const finalRes = await client.query(`SELECT id, code, name, is_active FROM ats.market_segments;`);
  console.log("Final Markets in DB:");
  console.table(finalRes.rows);
  
  await client.end();
}

seedMarkets().catch(console.error);
