import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { submissionCapabilities } from './submission-capabilities';
import { validateTrackerUpdate } from './validate-tracker-update';

const existing = { finalStatus: 'SUBMITTED', l1Status: 'PENDING', l2Status: null, l3Status: null, l1Date: null };
describe('submission tracker permissions and transitions', () => {
  it('limits assessment snapshots and overrides to valid internal review decisions', () => {
    const pending = { ...existing, finalStatus: 'PENDING_APPROVAL' };
    const dto = { finalStatus: 'SUBMITTED', assessmentVersion: 'a'.repeat(64), reviewOverrides: { 'primary:python': 'Meets' } };
    const reviewer = submissionCapabilities(['submission:internal_screening']);
    expect(() => validateTrackerUpdate(pending, dto, reviewer)).not.toThrow();
    expect(() => validateTrackerUpdate(pending, dto, submissionCapabilities(['submission:final_status']))).toThrow(ForbiddenException);
    expect(() => validateTrackerUpdate(existing, dto, reviewer)).toThrow(BadRequestException);
    expect(() => validateTrackerUpdate(pending, { ...dto, assessmentVersion: 'forged' }, reviewer)).toThrow(BadRequestException);
    expect(() => validateTrackerUpdate(pending, { ...dto, reviewOverrides: { x: 'Approve' } }, reviewer)).toThrow(BadRequestException);
  });
  it('uses capabilities without granting permissions from role names', () => {
    expect(submissionCapabilities(['ACCOUNT_MANAGER']).review).toBe(false);
    expect(submissionCapabilities(['submission:internal_screening']).review).toBe(true);
    expect(submissionCapabilities(['*']).results.l3).toBe(true);
  });
  it('allows scheduling independently from result recording', () => {
    const caps = submissionCapabilities(['submission:schedule_interview']);
    expect(() => validateTrackerUpdate(existing, { l1Status: 'SCHEDULED', l1Date: '2026-10-09T05:30:00Z', l1Remarks: 'Meeting notes' }, caps)).not.toThrow();
    expect(() => validateTrackerUpdate(existing, { l1Status: 'CLEARED' }, caps)).toThrow(ForbiddenException);
  });
  it('requires approval and sequential round clearance', () => {
    const caps = submissionCapabilities(['submission:audit_rounds']);
    expect(() => validateTrackerUpdate({ ...existing, finalStatus: 'PENDING_APPROVAL' }, { l1Status: 'CLEARED' }, caps)).toThrow(BadRequestException);
    expect(() => validateTrackerUpdate(existing, { l2Status: 'CLEARED' }, caps)).toThrow(BadRequestException);
  });
  it('rejects missing dates and invalid meeting URLs', () => {
    const caps = submissionCapabilities(['submission:schedule_interview']);
    expect(() => validateTrackerUpdate(existing, { l1Status: 'SCHEDULED' }, caps)).toThrow(BadRequestException);
    expect(() => validateTrackerUpdate(existing, { meetingLink: 'javascript:alert(1)' }, caps)).toThrow(BadRequestException);
  });
  it('denies unauthorized fields explicitly instead of ignoring them', () => {
    expect(() => validateTrackerUpdate(existing, { submittedRate: '20' }, submissionCapabilities([]))).toThrow(ForbiddenException);
    expect(() => validateTrackerUpdate(existing, { recruiterComment: 'Note' }, submissionCapabilities([]))).toThrow(ForbiddenException);
    expect(() => validateTrackerUpdate(existing, { candidateId: 'another-candidate' }, submissionCapabilities(['*']))).toThrow(BadRequestException);
  });
  it('requires clearance and a reason for a direct offer outside the normal sequence', () => {
    const caps = submissionCapabilities(['submission:final_status']);
    expect(() => validateTrackerUpdate(existing, { finalStatus: 'OFFER' }, caps)).toThrow(BadRequestException);
    expect(() => validateTrackerUpdate(existing, { finalStatus: 'JOIN' }, caps)).toThrow(BadRequestException);
    const cleared = { ...existing, l1Status: 'CLEARED', l2Status: 'CLEARED', l3Status: 'CLEARED' };
    expect(() => validateTrackerUpdate(cleared, { finalStatus: 'SELECTED' }, caps)).not.toThrow();
    expect(() => validateTrackerUpdate(cleared, { finalStatus: 'OFFER' }, caps)).toThrow('Record a reason');
    expect(() => validateTrackerUpdate({ ...cleared, finalStatus: 'SELECTED' }, { finalStatus: 'OFFER' }, caps)).not.toThrow();
    expect(() => validateTrackerUpdate({ ...cleared, finalStatus: 'OFFER' }, { finalStatus: 'JOIN' }, caps)).not.toThrow();
  });
  it.each([1, 2])('permits final outcomes after %s cleared rounds without fabricating later clearance', count => {
    const record = { ...existing, l1Status: 'CLEARED', l2Status: count === 2 ? 'CLEARED' : 'PENDING', l3Status: 'PENDING' };
    const caps = submissionCapabilities(['submission:final_status']);
    expect(() => validateTrackerUpdate(record, { finalStatus: 'SELECTED' }, caps)).not.toThrow();
    expect(() => validateTrackerUpdate(record, { finalStatus: 'OFFER', bypassReason: 'Client has issued the offer' }, caps)).not.toThrow();
    expect(() => validateTrackerUpdate(record, { finalStatus: 'JOIN', bypassReason: 'Joining confirmed by client' }, caps)).not.toThrow();
    expect(record.l3Status).toBe('PENDING');
  });
  it('requires a reason when selecting with another interview still active', () => {
    const record = { ...existing, l1Status: 'CLEARED', l2Status: 'AWAITING_FEEDBACK' };
    const caps = submissionCapabilities(['submission:final_status']);
    expect(() => validateTrackerUpdate(record, { finalStatus: 'SELECTED' }, caps)).toThrow('unfinished interview');
    expect(() => validateTrackerUpdate(record, { finalStatus: 'SELECTED', bypassReason: 'Client selected after L1' }, caps)).not.toThrow();
    expect(() => validateTrackerUpdate({ ...record, l2Status: 'REJECTED' }, { finalStatus: 'SELECTED', bypassReason: 'Override' }, caps)).toThrow('correct any rejected');
  });
  it('lets round auditors reject without requiring final-outcome authority', () => {
    expect(() => validateTrackerUpdate({ ...existing, l1Status: 'SCHEDULED', l1Date: '2026-10-09T05:30:00Z' }, { l1Status: 'REJECTED', l1Remarks: 'Client declined', finalStatus: 'REJECTED' }, submissionCapabilities(['submission:audit_l1']))).not.toThrow();
  });
  it.each(['l1', 'l2', 'l3'])('requires a saved schedule before recording %s results', round => {
    const caps = submissionCapabilities(['submission:audit_rounds']);
    const pending = { ...existing, l1Status: round === 'l1' ? 'PENDING' : 'CLEARED', l2Status: round === 'l3' ? 'CLEARED' : 'PENDING' };
    for (const result of ['CLEARED']) {
      expect(() => validateTrackerUpdate(pending, { [`${round}Status`]: result }, caps)).toThrow('Schedule this interview');
      expect(() => validateTrackerUpdate(pending, { [`${round}Status`]: result, [`${round}Date`]: '2026-10-09T05:30:00Z' }, caps)).toThrow('Schedule this interview');
      const scheduled = { ...pending, [`${round}Status`]: 'SCHEDULED', [`${round}Date`]: '2026-10-09T05:30:00Z' };
      expect(() => validateTrackerUpdate(scheduled, { [`${round}Status`]: result }, caps)).not.toThrow();
      expect(() => validateTrackerUpdate({ ...scheduled, [`${round}Date`]: null }, { [`${round}Status`]: result }, caps)).toThrow('Schedule this interview');
    }
  });
  it.each(['l1', 'l2', 'l3'])('allows rejection at pending %s with remarks and round authority', round => {
    const caps = submissionCapabilities(['submission:audit_rounds']);
    const pending = { ...existing, l1Status: round === 'l1' ? 'PENDING' : 'CLEARED', l2Status: round === 'l3' ? 'CLEARED' : 'PENDING' };
    const dto = { [`${round}Status`]: 'REJECTED', [`${round}Remarks`]: 'Client declined at this stage' };
    expect(() => validateTrackerUpdate(pending, dto, caps)).not.toThrow();
    expect(() => validateTrackerUpdate(pending, { ...dto, [`${round}Remarks`]: ' ' }, caps)).toThrow('Add remarks');
    expect(() => validateTrackerUpdate(pending, dto, submissionCapabilities(['submission:schedule_interview']))).toThrow(ForbiddenException);
    expect(() => validateTrackerUpdate({ ...pending, [`${round}Status`]: 'CLEARED' }, dto, caps)).toThrow('reason to correct');
  });
  it('allows overall rejection before scheduling with final-status authority', () => {
    expect(() => validateTrackerUpdate(existing, { finalStatus: 'REJECTED', remarks: 'Client withdrew the requirement' }, submissionCapabilities(['submission:final_status']))).not.toThrow();
  });
  it('allows only approval or rejection during internal review', () => {
    const caps = submissionCapabilities(['submission:internal_screening']);
    expect(() => validateTrackerUpdate({ ...existing, finalStatus: 'PENDING_APPROVAL' }, { finalStatus: 'SUBMITTED' }, caps)).not.toThrow();
    expect(() => validateTrackerUpdate({ ...existing, finalStatus: 'PENDING_APPROVAL' }, { finalStatus: 'JOIN' }, caps)).toThrow(BadRequestException);
  });
  it('prevents an early joining bypass even with authority and a reason', () => {
    const dto = { finalStatus: 'JOIN', bypassReason: 'Client hired after L1' };
    expect(() => validateTrackerUpdate(existing, dto, submissionCapabilities(['submission:final_status']))).toThrow('Clear L1');
    expect(() => validateTrackerUpdate(existing, dto, submissionCapabilities([]))).toThrow(ForbiddenException);
    expect(() => validateTrackerUpdate({ ...existing, finalStatus: 'PENDING_APPROVAL' }, dto, submissionCapabilities(['*']))).toThrow(BadRequestException);
    expect(() => validateTrackerUpdate({ ...existing, finalStatus: 'REJECTED' }, dto, submissionCapabilities(['*']))).toThrow(BadRequestException);
  });

  it('records feedback after a saved schedule, and then clearance', () => {
    const caps = submissionCapabilities(['submission:audit_l1']);
    const scheduled = { ...existing, l1Status: 'SCHEDULED', l1Date: '2026-10-09T05:30:00Z' };
    expect(() => validateTrackerUpdate(scheduled, { l1Status: 'AWAITING_FEEDBACK' }, caps)).not.toThrow();
    expect(() => validateTrackerUpdate({ ...scheduled, l1Status: 'AWAITING_FEEDBACK' }, { l1Status: 'CLEARED' }, caps)).not.toThrow();
    expect(() => validateTrackerUpdate(existing, { l1Status: 'AWAITING_FEEDBACK' }, caps)).toThrow('Schedule this interview');
  });

  it('allows cancellation with remarks and subsequent rescheduling', () => {
    const caps = submissionCapabilities(['submission:schedule_interview']);
    const scheduled = { ...existing, l1Status: 'SCHEDULED', l1Date: '2026-10-09T05:30:00Z' };
    expect(() => validateTrackerUpdate(scheduled, { l1Status: 'CANCELLED', l1Remarks: 'Client cancelled' }, caps)).not.toThrow();
    expect(() => validateTrackerUpdate(scheduled, { l1Status: 'CANCELLED' }, caps)).toThrow('Add remarks');
    expect(() => validateTrackerUpdate({ ...scheduled, l1Status: 'CANCELLED' }, { l1Status: 'SCHEDULED', l1Date: '2026-10-10T05:30:00Z' }, caps)).not.toThrow();
  });

  it('enforces scheduling only for the current pending round and accepts allowlisted calendar colors', () => {
    const caps = submissionCapabilities(['submission:schedule_interview']);
    expect(() => validateTrackerUpdate(existing, { l1Status: 'SCHEDULED', l1Date: '2026-10-09T05:30:00Z', l1Color: 'violet' }, caps)).not.toThrow();
    expect(() => validateTrackerUpdate({ ...existing, l1Status: 'CLEARED', l2Status: 'PENDING' }, { l2Status: 'SCHEDULED', l2Date: '2026-10-09T05:30:00Z', l2Color: 'green' }, caps)).not.toThrow();
    expect(() => validateTrackerUpdate({ ...existing, l1Status: 'CLEARED', l2Status: 'CLEARED', l3Status: 'PENDING' }, { l3Status: 'SCHEDULED', l3Date: '2026-10-09T05:30:00Z', l3Color: 'amber' }, caps)).not.toThrow();
    expect(() => validateTrackerUpdate({ ...existing, l2Status: 'SCHEDULED', l2Date: '2026-10-09T05:30:00Z' }, { l1Status: 'SCHEDULED', l1Date: '2026-10-09T05:30:00Z' }, caps)).toThrow('no longer eligible');
    expect(() => validateTrackerUpdate({ ...existing, finalStatus: 'SELECTED', l1Status: 'CLEARED' }, { l2Status: 'SCHEDULED', l2Date: '2026-10-09T05:30:00Z' }, caps)).toThrow(BadRequestException);
    expect(() => validateTrackerUpdate(existing, { l1Status: 'SCHEDULED', l1Date: '2026-10-09T05:30:00Z', l1Color: '#ff00ff' }, caps)).toThrow('valid calendar color');
  });

  it('requires explicit confirmation and reason before invalidating later rounds', () => {
    const caps = submissionCapabilities(['submission:audit_l1']);
    const progressed = { ...existing, l1Status: 'CLEARED', l1Date: '2026-10-09T05:30:00Z', l2Status: 'SCHEDULED', l2Date: '2026-10-10T05:30:00Z' };
    const dto = { l1Status: 'AWAITING_FEEDBACK', correctionReason: 'Feedback entered incorrectly' };
    expect(() => validateTrackerUpdate(progressed, dto, caps)).toThrow('Confirm resetting');
    expect(() => validateTrackerUpdate(progressed, { ...dto, resetFollowingRounds: true }, caps)).not.toThrow();
    expect(() => validateTrackerUpdate(progressed, { ...dto, resetFollowingRounds: true, l2Status: 'CLEARED' }, caps)).toThrow('must remain pending');
    expect(() => validateTrackerUpdate(progressed, { ...dto, resetFollowingRounds: true }, submissionCapabilities(['submission:schedule_interview']))).toThrow(ForbiddenException);
  });

  it('allows early negative outcomes with a reason but not early selection', () => {
    const caps = submissionCapabilities(['submission:final_status']);
    for (const finalStatus of ['NOT_SELECTED', 'WITHDRAWN']) {
      expect(() => validateTrackerUpdate(existing, { finalStatus, remarks: 'Client/candidate decision' }, caps)).not.toThrow();
      expect(() => validateTrackerUpdate(existing, { finalStatus }, caps)).toThrow('Add remarks');
    }
    expect(() => validateTrackerUpdate(existing, { finalStatus: 'SELECTED' }, caps)).toThrow('Clear L1');
  });

  it('requires outcome and round authority to reopen and correct a rejected interview', () => {
    const rejected = { ...existing, finalStatus: 'NOT_SELECTED', l1Status: 'REJECTED', l1Date: '2026-10-09T05:30:00Z' };
    const dto = { finalStatus: 'SUBMITTED', l1Status: 'CLEARED', correctionReason: 'Wrong result recorded' };
    expect(() => validateTrackerUpdate(rejected, dto, submissionCapabilities(['submission:audit_l1', 'submission:final_status']))).not.toThrow();
    expect(() => validateTrackerUpdate(rejected, dto, submissionCapabilities(['submission:audit_l1']))).toThrow(BadRequestException);
    expect(() => validateTrackerUpdate(rejected, { finalStatus: 'SUBMITTED', correctionReason: 'Reopen' }, submissionCapabilities(['*']))).toThrow('Correct the rejected round');
  });

  it('does not allow round or outcome rollback to bypass internal review', () => {
    const rejected = { ...existing, finalStatus: 'REJECTED', rejectionFromStatus: 'PENDING_APPROVAL' };
    expect(() => validateTrackerUpdate(rejected, { finalStatus: 'SUBMITTED', correctionReason: 'Reopen' }, submissionCapabilities(['*']))).toThrow('internal-review rejection');
  });

  it('requires clearing L1 even when L2 was cleared in an inconsistent old record', () => {
    expect(() => validateTrackerUpdate({ ...existing, l2Status: 'CLEARED' }, { l3Status: 'SCHEDULED', l3Date: '2026-10-09T05:30:00Z' }, submissionCapabilities(['*']))).toThrow('previous interview');
  });
  it('does not accept a forged reset flag as permission to edit a locked later round', () => {
    expect(() => validateTrackerUpdate(existing, { l2Status: 'PENDING', l2Remarks: 'Bypass', resetFollowingRounds: true }, submissionCapabilities(['*']))).toThrow('previous interview');
  });
  it('rejects feedback for a future interview and appointment dates on a pending round', () => {
    const scheduled = { ...existing, l1Status: 'SCHEDULED', l1Date: new Date(Date.now() + 86400000).toISOString() };
    expect(() => validateTrackerUpdate(scheduled, { l1Status: 'AWAITING_FEEDBACK' }, submissionCapabilities(['*']))).toThrow('must have taken place');
    expect(() => validateTrackerUpdate(existing, { l1Date: '2026-10-09T05:30:00Z' }, submissionCapabilities(['*']))).toThrow('Schedule this round');
  });
  it('rejects malformed remarks before executing workflow rules', () => {
    expect(() => validateTrackerUpdate(existing, { finalStatus: 'NOT_SELECTED', remarks: 123 }, submissionCapabilities(['*']))).toThrow('Remarks must be text');
  });

});

describe('job creator internal review permission', () => {
  it('requires explicit permission and verified creator scope', () => {
    expect(submissionCapabilities(['submission:internal_screening_created_jobs'], false, 'Active', 'PENDING_APPROVAL', false, true).review).toBe(true);
    expect(submissionCapabilities([], false, 'Active', 'PENDING_APPROVAL', false, true).review).toBe(false);
    expect(submissionCapabilities(['submission:internal_screening_created_jobs']).review).toBe(false);
  });
  it('keeps manager access, blocks creator self review and paused jobs, and grants no other actions', () => {
    expect(submissionCapabilities([], true).review).toBe(true);
    expect(submissionCapabilities(['submission:internal_screening'], true, 'Active', 'PENDING_APPROVAL', false, true, true).review).toBe(false);
    expect(submissionCapabilities(['submission:internal_screening_created_jobs'], false, 'Closed', 'PENDING_APPROVAL', false, true).review).toBe(false);
    const caps = submissionCapabilities(['submission:internal_screening_created_jobs'], false, 'Active', 'PENDING_APPROVAL', false, true);
    expect(caps).toMatchObject({ schedule: false, outcome: false, notes: false, rate: false, results: { l1: false, l2: false, l3: false } });
  });
});
