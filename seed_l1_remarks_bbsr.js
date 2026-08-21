const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

const l1Remarks = [
  "NA",
  "Resume Shortlisted - L1 Client Interview Pending",
  "L1 Client Interview Scheduled",
  "Candidate Noshow - Reschedule requested",
  "Candidate Noshow",
  "L1 Client Interview Reschedule Pending",
  "L1 Client Interview Rescheduled",
  "L1 Client Interview Done - Selected",
  "L1 Client Interview Done - Rejected",
  "L1 Client Interview Done - Pending Feedback",
  "L1 Client Interview Scheduled – Position Closed",
  "L1 Client Interview Done – Position Closed",
  "Position is kept on Hold by the Client",
  "Position Closed by Client",
  "Duplicate Submission",
  "Resume Not Shortlisted",
  "Candidate Not Responding",
  "L1 Client Interview Scheduled – Candidate Accepted Another Offer",
  "L1 Client Interview Reschedule Pending – Candidate Accepted Another Offer",
  "Client not Responding"
];

async function seedBranchL1Remarks() {
  try {
    // Find all branches matching 'bbsr-domestic' (case-insensitive)
    const branchRes = await pool.query(
      "SELECT id, tenant_id, name, code FROM branches WHERE LOWER(name) = LOWER('bbsr-domestic')"
    );

    if (branchRes.rows.length === 0) {
      console.error("No branch found with name 'bbsr-domestic'");
      return;
    }

    console.log(`Found ${branchRes.rows.length} matching branch(es):`, branchRes.rows);

    for (const branch of branchRes.rows) {
      console.log(`\nAdding L1 remarks for branch '${branch.name}' (${branch.id}), Tenant: ${branch.tenant_id}...`);
      
      for (const remarkText of l1Remarks) {
        // Check if remark already exists for this tenant, branch, and stage
        const existing = await pool.query(
          "SELECT id FROM tenant_stage_remarks WHERE tenant_id = $1 AND stage = 'l1' AND remark_text = $2 AND (branch_id = $3 OR (branch_id IS NULL AND $3 IS NULL))",
          [branch.tenant_id, remarkText, branch.id]
        );

        if (existing.rows.length === 0) {
          await pool.query(
            "INSERT INTO tenant_stage_remarks (tenant_id, stage, remark_text, branch_id, created_by) VALUES ($1, 'l1', $2, $3, 'admin')",
            [branch.tenant_id, remarkText, branch.id]
          );
          console.log(`  + Inserted: "${remarkText}"`);
        } else {
          console.log(`  = Already exists: "${remarkText}"`);
        }
      }
    }

    // Verify all L1 remarks for bbsr-domestic
    const verify = await pool.query(
      "SELECT id, stage, remark_text, branch_id FROM tenant_stage_remarks WHERE stage = 'l1' AND branch_id = $1 ORDER BY id ASC",
      [branchRes.rows[0].id]
    );

    console.log(`\nVerification: ${verify.rows.length} L1 remarks in database for bbsr-domestic:`);
    verify.rows.forEach((r, idx) => {
      console.log(`  ${idx + 1}. [ID: ${r.id}] ${r.remark_text}`);
    });

  } catch (err) {
    console.error('Error adding L1 remarks:', err);
  } finally {
    await pool.end();
  }
}

seedBranchL1Remarks();
