const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

const l2Remarks = [
  "NA",
  "L2 Client Interview Pending",
  "L2 Client Interview Scheduled",
  "Candidate Noshow - Reschedule requested",
  "L2 Client Interview Reschedule Pending",
  "L2 Client Interview Rescheduled",
  "L2 Client Interview Done - Selected",
  "L2 Client Interview Done - Rejected",
  "L2 Client Interview Done - Pending Feedback",
  "L2 NA Moved to Offer",
  "Candidate Not Responding",
  "L2 Client Interview Scheduled – Position Closed",
  "L2 Client Interview Done – Position Closed",
  "L2 Client Interview Scheduled – Candidate Accepted Another Offer",
  "L2 Client Interview Reschedule Pending – Candidate Accepted Another Offer",
  "Position is kept on Hold by the Client",
  "Position Closed by Client"
];

async function seedBranchL2Remarks() {
  try {
    const branchRes = await pool.query(
      "SELECT id, tenant_id, name, code FROM branches WHERE LOWER(name) = LOWER('bbsr-domestic')"
    );

    if (branchRes.rows.length === 0) {
      console.error("No branch found with name 'bbsr-domestic'");
      return;
    }

    console.log(`Found ${branchRes.rows.length} matching branch(es):`, branchRes.rows);

    for (const branch of branchRes.rows) {
      console.log(`\nAdding L2 remarks for branch '${branch.name}' (${branch.id}), Tenant: ${branch.tenant_id}...`);
      
      for (const remarkText of l2Remarks) {
        const existing = await pool.query(
          "SELECT id FROM tenant_stage_remarks WHERE tenant_id = $1 AND stage = 'l2' AND remark_text = $2 AND (branch_id = $3 OR (branch_id IS NULL AND $3 IS NULL))",
          [branch.tenant_id, remarkText, branch.id]
        );

        if (existing.rows.length === 0) {
          await pool.query(
            "INSERT INTO tenant_stage_remarks (tenant_id, stage, remark_text, branch_id, created_by) VALUES ($1, 'l2', $2, $3, 'admin')",
            [branch.tenant_id, remarkText, branch.id]
          );
          console.log(`  + Inserted: "${remarkText}"`);
        } else {
          console.log(`  = Already exists: "${remarkText}"`);
        }
      }
    }

    // Verify all L2 remarks for bbsr-domestic
    const verify = await pool.query(
      "SELECT id, stage, remark_text, branch_id FROM tenant_stage_remarks WHERE stage = 'l2' AND branch_id = $1 ORDER BY id ASC",
      [branchRes.rows[0].id]
    );

    console.log(`\nVerification: ${verify.rows.length} L2 remarks in database for bbsr-domestic:`);
    verify.rows.forEach((r, idx) => {
      console.log(`  ${idx + 1}. [ID: ${r.id}] ${r.remark_text}`);
    });

  } catch (err) {
    console.error('Error adding L2 remarks:', err);
  } finally {
    await pool.end();
  }
}

seedBranchL2Remarks();
