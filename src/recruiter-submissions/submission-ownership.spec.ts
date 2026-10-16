import { submissionCapabilities } from './submission-capabilities';
import { validateTrackerUpdate } from './validate-tracker-update';
import { ForbiddenException } from '@nestjs/common';
import { RecruiterSubmissionsService } from './recruiter-submissions.service';

describe('submission responsibility bundles', () => {
  const submitted = { finalStatus: 'SUBMITTED', l1Status: 'SCHEDULED', l1Date: '2026-10-14T05:00:00Z', l2Status: 'PENDING', l3Status: 'PENDING' };
  const recruiter = submissionCapabilities(['submission:create', 'submission:view', 'candidate:create', 'candidate:view']);
  const manager = submissionCapabilities(['submission:view', 'submission:schedule_interview', 'submission:audit_rounds', 'submission:final_status', 'submission:edit']);
  it.each([
    { l1Status: 'AWAITING_FEEDBACK' },
    { l1Status: 'CLEARED' },
    { l1Status: 'REJECTED', l1Remarks: 'Client declined' },
    { l1Status: 'SCHEDULED', l1Date: '2026-10-16T05:00:00Z' },
    { finalStatus: 'NOT_SELECTED', remarks: 'Client decision' },
    { recruiterComment: 'Change after submission' },
  ])('denies a direct recruiter API update %j and permits the manager', update => {
    expect(() => validateTrackerUpdate(submitted, update, recruiter)).toThrow(ForbiddenException);
    expect(() => validateTrackerUpdate(submitted, update, manager)).not.toThrow();
  });
  it('does not grant maintenance capabilities from role names', () => {
    expect(submissionCapabilities(['ACCOUNT_MANAGER']).schedule).toBe(false);
    expect(Object.values(recruiter.results)).toEqual([false, false, false]);
    expect(recruiter.outcome).toBe(false);
  });

  it('denies cross-account-manager status updates unless edit_all is explicitly granted', async () => {
    const prisma: any = {
      recruiterSubmission: { findFirst: jest.fn().mockResolvedValue({
        id: 'submission', tenantId: 'tenant', updatedAt: new Date(), finalStatus: 'SUBMITTED',
        l1Status: 'PENDING', l2Status: 'PENDING', l3Status: 'PENDING',
        job: { id: 'job', accountManagerId: 'another-am' },
      }) },
      submissionEvent: { findFirst: jest.fn() },
    };
    const service = new RecruiterSubmissionsService(prisma, {} as any);
    jest.spyOn(service, 'findOne').mockResolvedValue({ recruiterJobReviewerId: null } as any);
    const actor = { dbId: 'am-a', tenantId: 'tenant', systemRole: 'ACCOUNT_MANAGER', roles: ['ACCOUNT_MANAGER'], permissions: ['submission:view', 'submission:view_all', 'submission:audit_l1'] } as any;
    await expect(service.update('submission', { l1Status: 'CLEARED' } as any, 'tenant', actor)).rejects.toThrow(ForbiddenException);
  });
});
