const { Client } = require('pg');
require('dotenv').config();

async function seed() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  const defaultRemarks = [
    // review
    { stage: 'review', text: 'NA' },
    { stage: 'review', text: 'Internal Screening NA - Submitted to Client' },
    { stage: 'review', text: 'Internal Screening Pending' },
    { stage: 'review', text: 'Internal Screening Scheduled' },
    { stage: 'review', text: 'Candidate Noshow' },
    { stage: 'review', text: 'Internal Screening Rescheduled' },
    { stage: 'review', text: 'Internal Screening Completed - Pending Feedback' },
    { stage: 'review', text: 'Selected in Internal Screening - Position went on Hold' },
    { stage: 'review', text: 'Selected in Internal Screening - Submitted to Client' },
    { stage: 'review', text: 'Selected in Internal Screening - Yet to Submit to Client' },
    { stage: 'review', text: 'Rejected in Internal Screening' },
    { stage: 'review', text: 'Candidate Not Responding' },
    { stage: 'review', text: 'Selected in Internal Screening - Position Closed by Client' },
    { stage: 'review', text: 'Rejected - Duplicate' },
    // l1
    { stage: 'l1', text: '✓ Mandatory skills & tech stack 100% verified against JD' },
    { stage: 'l1', text: '✓ Immediate joiner — notice period ≤ 30 days confirmed' },
    { stage: 'l1', text: '✓ Valid work authorization & visa verified' },
    { stage: 'l1', text: '✓ Candidate CTC expectation within approved budget bracket' },
    { stage: 'l1', text: '✓ Excellent communication & profile presentation' },
    { stage: 'l1', text: '✕ Rejected: Notice period exceeds 60 days (Client requires immediate)' },
    { stage: 'l1', text: '✕ Rejected: Significant skill gap in core mandatory technologies' },
    { stage: 'l1', text: '✕ Rejected: Expected CTC exceeds maximum budget ceiling' },
    { stage: 'l1', text: '✕ Rejected: Location constraint / Candidate unwilling to relocate' },
    // l2
    { stage: 'l2', text: '✓ Passed technical screening call with strong hands-on coding' },
    { stage: 'l2', text: '✓ Excellent project depth & system architecture knowledge' },
    { stage: 'l2', text: '✓ Solved technical live coding & algorithmic challenge' },
    { stage: 'l2', text: '✓ Strong technical communication & problem solving' },
    { stage: 'l2', text: '✕ Rejected: Failed live coding / technical screening assessment' },
    { stage: 'l2', text: '✕ Rejected: Lacked depth in framework fundamentals & design patterns' },
    { stage: 'l2', text: '✕ Rejected: Hands-on experience does not match claimed CV experience' },
    // l3
    { stage: 'l3', text: '✓ Commercials & rate margin verified (>20% Gross Margin)' },
    { stage: 'l3', text: '✓ Candidate rate confirmation email on record' },
    { stage: 'l3', text: '✓ Client submission package formatted and validated' },
    { stage: 'l3', text: '✓ Candidate available & briefed on client interview process' },
    { stage: 'l3', text: '✕ Rejected: Commercial margin below minimum threshold (<15%)' },
    { stage: 'l3', text: '✕ Rejected: Candidate declined rate confirmation / demanded higher CTC' },
    // final
    { stage: 'final', text: '✓ Client shortlisted for Round 1 Interview' },
    { stage: 'final', text: '✓ Client interview round completed successfully' },
    { stage: 'final', text: '✓ Client released official offer letter' },
    { stage: 'final', text: '✓ Candidate accepted offer & joined client successfully' },
    { stage: 'final', text: '✕ Client rejected: Profile not aligned with hiring manager expectations' },
    { stage: 'final', text: '✕ Candidate declined offer / accepted counter-offer' },
    { stage: 'final', text: '✕ Position closed / Put on hold by client' },
  ];

  const tenantsRes = await client.query('SELECT id FROM tenants');
  for (const t of tenantsRes.rows) {
    for (const opt of defaultRemarks) {
      const exists = await client.query(
        'SELECT id FROM tenant_stage_remarks WHERE tenant_id = $1 AND stage = $2 AND remark_text = $3',
        [t.id, opt.stage, opt.text]
      );
      if (exists.rows.length === 0) {
        await client.query(
          'INSERT INTO tenant_stage_remarks (tenant_id, stage, remark_text, created_by) VALUES ($1, $2, $3, $4)',
          [t.id, opt.stage, opt.text, 'system']
        );
      }
    }
  }

  console.log('Successfully seeded stage remarks options across all tenants.');
  await client.end();
}

seed().catch(console.error);
