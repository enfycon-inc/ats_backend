const { Client } = require('pg');

async function assignJobsToBbsrBranch() {
  const dbUrl = process.env.DATABASE_URL || "postgresql://postgres.zqpxnnsbbqdlhememsyj:EWhbqnM6IWe5IJaV@aws-1-ap-northeast-1.pooler.supabase.com:6543/postgres";
  const client = new Client({ connectionString: dbUrl });

  try {
    await client.connect();

    const bbsBranchId = '4ca219ac-cb28-4a77-90dc-352158b2b772'; // bbsr-domestic branch ID

    // 1. Assign all jobs under Deb Technology with null branch_id to bbsr-domestic
    const updateBranchRes = await client.query(`
      UPDATE jobs
      SET branch_id = $1
      WHERE tenant_id = 'fad0ccbf-db00-4560-bbfc-216eea7b107b'
        AND branch_id IS NULL
    `, [bbsBranchId]);

    console.log(`Updated ${updateBranchRes.rowCount} jobs to branch 'bbsr-domestic' (BBS).\n`);

    // 2. Re-sequence job codes for Deb Technology under BBS branch code
    const jobsRes = await client.query(`
      SELECT j.id, j.tenant_id, t.name as tenant_name, j.job_code, j.job_title, j.created_at, j.branch_id, b.code as branch_code, b.name as branch_name, j.visa_type
      FROM jobs j
      LEFT JOIN tenants t ON j.tenant_id = t.id
      LEFT JOIN branches b ON j.branch_id = b.id
      WHERE j.tenant_id = 'fad0ccbf-db00-4560-bbfc-216eea7b107b'
      ORDER BY j.created_at ASC
    `);

    const counters = {};
    let updatedCount = 0;

    for (const job of jobsRes.rows) {
      let branchCode = 'BBS';
      if (job.branch_code && job.branch_code.trim().length > 0) {
        branchCode = job.branch_code.trim().toUpperCase();
      }

      let shiftCode = 'D';
      const shiftStr = (job.visa_type || '').toUpperCase();
      if (shiftStr.includes('NIGHT') || shiftStr.includes('US')) {
        shiftCode = 'N';
      }

      const date = new Date(job.created_at);
      const yy = date.getFullYear().toString().slice(-2);
      const mm = String(date.getMonth() + 1).padStart(2, '0');
      const dd = String(date.getDate()).padStart(2, '0');
      const dateStamp = `${yy}${mm}${dd}`;

      const prefix = `${branchCode}-${dateStamp}-${shiftCode}`;
      const key = `${job.tenant_id}:${prefix}`;
      
      counters[key] = (counters[key] || 0) + 1;
      const seqStr = String(counters[key]).padStart(4, '0');
      const newJobCode = `${prefix}${seqStr}`;

      if (job.job_code !== newJobCode) {
        await client.query('UPDATE jobs SET job_code = $1 WHERE id = $2', [newJobCode, job.id]);
        console.log(`Updated Job "${job.job_title}" (${job.id}): ${job.job_code} -> ${newJobCode}`);
        updatedCount++;
      }
    }

    console.log(`\n✅ Successfully re-coded ${updatedCount} jobs with BBS branch code!`);

  } catch (err) {
    console.error('Error:', err);
  } finally {
    await client.end();
  }
}

assignJobsToBbsrBranch();
