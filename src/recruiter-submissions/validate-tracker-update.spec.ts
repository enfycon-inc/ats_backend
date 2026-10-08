import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { submissionCapabilities } from './submission-capabilities';
import { validateTrackerUpdate } from './validate-tracker-update';

const existing = { finalStatus: 'SUBMITTED', l1Status: 'PENDING', l2Status: null, l3Status: null, l1Date: null };
describe('submission tracker permissions and transitions', () => {
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
  it('requires a bypass reason when departing from the normal outcome sequence', () => {
    const caps = submissionCapabilities(['submission:final_status']);
    expect(() => validateTrackerUpdate(existing, { finalStatus: 'OFFER' }, caps)).toThrow(BadRequestException);
    expect(() => validateTrackerUpdate(existing, { finalStatus: 'JOIN' }, caps)).toThrow(BadRequestException);
    expect(() => validateTrackerUpdate({ ...existing, l3Status: 'CLEARED' }, { finalStatus: 'OFFER' }, caps)).not.toThrow();
    expect(() => validateTrackerUpdate({ ...existing, finalStatus: 'OFFER', l3Status: 'CLEARED' }, { finalStatus: 'JOIN' }, caps)).not.toThrow();
  });
  it('lets round auditors reject without requiring final-outcome authority', () => {
    expect(() => validateTrackerUpdate(existing, { l1Status: 'REJECTED', finalStatus: 'REJECTED' }, submissionCapabilities(['submission:audit_l1']))).not.toThrow();
  });
  it('allows only approval or rejection during internal review', () => {
    const caps = submissionCapabilities(['submission:internal_screening']);
    expect(() => validateTrackerUpdate({ ...existing, finalStatus: 'PENDING_APPROVAL' }, { finalStatus: 'SUBMITTED' }, caps)).not.toThrow();
    expect(() => validateTrackerUpdate({ ...existing, finalStatus: 'PENDING_APPROVAL' }, { finalStatus: 'JOIN' }, caps)).toThrow(BadRequestException);
  });
  it('allows early joining only with authority, internal approval, and a reason', () => {
    const dto = { finalStatus: 'JOIN', bypassReason: 'Client hired after L1' };
    expect(() => validateTrackerUpdate(existing, dto, submissionCapabilities(['submission:final_status']))).not.toThrow();
    expect(() => validateTrackerUpdate(existing, dto, submissionCapabilities([]))).toThrow(ForbiddenException);
    expect(() => validateTrackerUpdate({ ...existing, finalStatus: 'PENDING_APPROVAL' }, dto, submissionCapabilities(['*']))).toThrow(BadRequestException);
    expect(() => validateTrackerUpdate({ ...existing, finalStatus: 'REJECTED' }, dto, submissionCapabilities(['*']))).toThrow(BadRequestException);
  });

});
