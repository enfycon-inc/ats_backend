const { Client } = require('pg');

async function testMigration() {
  const dbUrl = process.env.DATABASE_URL || "postgresql://postgres.zqpxnnsbbqdlhememsyj:EWhbqnM6IWe5IJaV@aws-1-ap-northeast-1.pooler.supabase.com:6543/postgres";
  const client = new Client({ connectionString: dbUrl });

  try {
    await client.connect();

    const jobsRes = await client.query(`
      SELECT j.id, j.tenant_id, t.name as tenant_name, j.job_code, j.job_title, j.created_at, j.branch_id, b.code as branch_code, b.name as branch_name, j.visa_type
      FROM jobs j
      LEFT JOIN tenants t ON j.tenant_id = t.id
      LEFT JOIN branches b ON j.branch_id = b.id
      ORDER BY j.created_at ASC
    `);

    console.log(`Found ${jobsRes.rows.length} total jobs in database.\n`);

    // Track sequence per tenant + branchCode + dateStamp + shiftCode
    const counters = {};

    const migrationPlan = [];

    for (const job of jobsRes.rows) {
      // 1. Determine Branch Code
      let branchCode = 'HQ';
      if (job.branch_code && job.branch_code.trim().length > 0) {
        branchCode = job.branch_code.trim().toUpperCase();
      } else if (job.branch_name && job.branch_name.trim().length > 0) {
        branchCode = job.branch_name.trim().replace(/[^a-zA-Z]/g, '').substring(0, 3).toUpperCase();
      } else if (job.tenant_name) {
        branchCode = job.tenant_name.trim().replace(/[^a-zA-Z]/g, '').substring(0, 3).toUpperCase();
      }

      // 2. Determine Shift Code ('D' for Day, 'N' for Night)
      let shiftCode = 'D';
      const shiftStr = (job.shift_timing || job.visa_type || '').toUpperCase();
      if (shiftStr.includes('NIGHT') || shiftStr.includes('US')) {
        shiftCode = 'N';
      }

      // 3. Format Date YYMMDD
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

      migrationPlan.push({
        jobId: job.id,
        tenant: job.tenant_name,
        oldJobCode: job.job_code,
        newJobCode,
        jobTitle: job.job_title,
        createdAt: job.created_at.toISOString().split('T')[0]
      });
    }

    console.log('--- PROPOSED JOB CODE MIGRATION PLAN ---');
    console.table(migrationPlan);

  } catch (err) {
    console.error('Migration Test Error:', err);
  } finally {
    await client.end();
  }
}

testMigration();
