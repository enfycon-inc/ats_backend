import { RecruiterSubmissionsService } from './recruiter-submissions.service';
import { resolveActiveRole } from '../auth/utils/active-role';
import { SUBMISSION_AUTO_APPROVAL_PERMISSION as AUTO, submissionCreationReview, submissionAutoApprovalDefaults } from './submission-auto-approval';

describe('submission automatic internal approval', () => {
  const actor: any = { dbId: 'actor', tenantId: 'tenant', email: 'staff@example.com', fullName: 'Staff',
    activeRoleId: 'manager-role', roleName: 'Account Manager', permissions: ['submission:create', 'job:submit_owned_jobs', AUTO] };
  const input = { jobId: 'job', candidateId: 'candidate', recruiterId: 'actor', finalStatus: 'PENDING_APPROVAL' };
  let db: any;
  let service: RecruiterSubmissionsService;
  beforeEach(() => {
    const job = { id: 'job', status: 'Active', approvalStatus: 'APPROVED', accountManagerId: 'actor', jobType: 'Full Time' };
    db = {
      user: { findFirst: jest.fn().mockResolvedValue({ branchId: 'branch', businessUnitId: 'unit', podId: null, jobReviewerId: 'reviewer' }) },
      job: { findFirst: jest.fn().mockResolvedValue(job), findUnique: jest.fn().mockResolvedValue(job), update: jest.fn() },
      jobRecruiter: { findUnique: jest.fn().mockResolvedValue({ jobId: 'job' }) },
      candidate: { findFirst: jest.fn().mockResolvedValue({ id: 'candidate', fullName: 'Candidate', preferredLocations: ['Kolkata'] }) },
      recruiterSubmission: { findFirst: jest.fn().mockResolvedValue(null), create: jest.fn(async ({ data }) => ({ ...data, id: 'submission', createdAt: new Date(), updatedAt: new Date() })) },
      submissionEvent: { create: jest.fn() },
      $queryRawUnsafe: jest.fn().mockResolvedValue([{ status: 'Active' }]), $executeRawUnsafe: jest.fn(),
    };
    db.$transaction = (run: any) => run(db);
    service = new RecruiterSubmissionsService(db, { createMany: jest.fn() } as any);
  });

  it('starts at L1 pending and records the active role, regardless of the client pending hint', async () => {
    const result = await service.create(input, 'tenant', actor);
    expect(result).toMatchObject({ finalStatus: 'SUBMITTED', l1Status: 'PENDING' });
    expect(db.submissionEvent.create.mock.calls[0][0].data.details.automaticInternalReview).toEqual({
      mode: 'AUTO_PERMISSION', permission: AUTO, activeRoleId: 'manager-role', activeRoleName: 'Account Manager',
    });
    expect(db.user.findFirst).toHaveBeenCalledTimes(2); // Scope checks outside and inside the transaction.
  });

  it('cannot force approval through client status or manual-review permission', async () => {
    const result = await service.create({ ...input, finalStatus: 'SUBMITTED' }, 'tenant', {
      ...actor, permissions: ['submission:create', 'job:submit_owned_jobs', 'submission:internal_screening'],
    });
    expect(result.finalStatus).toBe('PENDING_APPROVAL');
    expect(db.submissionEvent.create.mock.calls[0][0].data.details.automaticInternalReview).toBeUndefined();
  });

  it.each([
    { ...actor, permissions: [AUTO] },
    { ...actor, tenantId: 'other-tenant' },
    { ...actor, dbId: 'other-recruiter' },
  ])('does not grant submission or tenant access through auto-approval', async user => {
    await expect(service.create(input, 'tenant', user)).rejects.toThrow();
    expect(db.recruiterSubmission.create).not.toHaveBeenCalled();
  });

  it('does not bypass current job scope or closed-job checks', async () => {
    db.job.findFirst.mockResolvedValueOnce(null);
    await expect(service.create(input, 'tenant', actor)).rejects.toThrow('outside your current unit');
    db.job.findFirst.mockResolvedValue({ id: 'job', status: 'Closed', approvalStatus: 'APPROVED' });
    await expect(service.create(input, 'tenant', actor)).rejects.toThrow('active, approved');
    expect(db.recruiterSubmission.create).not.toHaveBeenCalled();
  });

  it('rejects duplicate submissions before adding approval history or incrementing totals', async () => {
    db.recruiterSubmission.findFirst.mockResolvedValue({ id: 'existing' });
    await expect(service.create(input, 'tenant', actor)).rejects.toThrow('already been submitted');
    expect(db.recruiterSubmission.create).not.toHaveBeenCalled();
    expect(db.submissionEvent.create).not.toHaveBeenCalled();
    expect(db.job.update).not.toHaveBeenCalled();
  });

  it('does not borrow auto-approval from an inactive assigned role', async () => {
    const managerId = '11111111-1111-4111-8111-111111111111';
    const recruiterId = '22222222-2222-4222-8222-222222222222';
    const roles: any = {
      [managerId]: { id: managerId, name: 'Account Manager', permissions: ['submission:create', AUTO] },
      [recruiterId]: { id: recruiterId, name: 'Recruiter', permissions: ['submission:create'] },
    };
    const prisma: any = {
      user: { findFirst: jest.fn().mockResolvedValue({ roleId: managerId, assignedRoleIds: [recruiterId], branchId: 'branch', businessUnitId: 'unit' }) },
      customRole: { findFirst: jest.fn(async ({ where }) => roles[where.id]) },
    };
    const recruiter = await resolveActiveRole(prisma, actor, recruiterId);
    const created = submissionCreationReview(recruiter);
    expect(created.finalStatus).toBe('PENDING_APPROVAL');
    const manager = await resolveActiveRole(prisma, actor, managerId);
    expect(submissionCreationReview(manager).finalStatus).toBe('SUBMITTED');
    expect(created.finalStatus).toBe('PENDING_APPROVAL');
  });

  it('defaults to the five approved archetypes, not recruiter or pod lead', () => {
    for (const key of ['ACCOUNT_MANAGER', 'DELIVERY_HEAD', 'BRANCH_ADMIN', 'UNIT_ADMIN', 'TENANT_ADMIN']) {
      expect(submissionAutoApprovalDefaults(key)).toEqual([AUTO]);
    }
    for (const key of ['RECRUITER', 'POD_LEAD', 'CUSTOM']) expect(submissionAutoApprovalDefaults(key)).toEqual([]);
  });
});
