const { Client } = require("pg");
const client = new Client({ connectionString: "postgresql://ats_user:AtsDevPass2024@13.55.100.200:5432/ats_db?schema=ats" });

async function deduplicateMarkets() {
  await client.connect();
  
  const codes = ['USIT', 'IND', 'UAE'];
  
  for (const code of codes) {
    const res = await client.query(`SELECT id FROM ats.market_segments WHERE code = $1 ORDER BY created_at ASC`, [code]);
    if (res.rows.length > 1) {
      const keepId = res.rows[0].id;
      for (let i = 1; i < res.rows.length; i++) {
        const deleteId = res.rows[i].id;
        // Reassign business units
        await client.query(`UPDATE ats.business_units SET market_segment_id = $1 WHERE market_segment_id = $2`, [keepId, deleteId]);
        // Delete duplicate
        await client.query(`DELETE FROM ats.market_segments WHERE id = $1`, [deleteId]);
      }
    }
  }

  const finalRes = await client.query(`SELECT id, code, name, is_active FROM ats.market_segments;`);
  console.log("Deduplicated Markets in DB:");
  console.table(finalRes.rows);
  
  await client.end();
}

deduplicateMarkets().catch(console.error);
