import { RecruiterSubmissionsService } from './recruiter-submissions.service';

describe('eligible interview candidates', () => {
  let query: jest.Mock;
  let membership: jest.Mock;
  let service: RecruiterSubmissionsService;

  beforeEach(() => {
    query = jest.fn(async (sql: string) => sql.startsWith('SELECT COUNT')
      ? [{ total: 1 }]
      : [{ id: 'submission-a', candidate_name: 'Candidate A', job_code: 'JOB-1', job_title: 'Engineer', eligible_round: 'l1', final_status: 'SUBMITTED' }]);
    membership = jest.fn().mockResolvedValue({ branchId: 'branch-a', businessUnitId: 'unit-a' });
    service = new RecruiterSubmissionsService({ $queryRawUnsafe: query, user: { findFirst: membership } } as any, {} as any);
  });

  it('allows scheduling-only recruiters while limiting results to owned or reviewed submissions', async () => {
    const result = await service.findEligibleForInterview('tenant-a', {
      dbId: 'recruiter-a', permissions: ['submission:schedule_interview'],
    } as any, { view: 'all' });

    expect(result.data).toEqual([expect.objectContaining({ id: 'submission-a', eligibleRound: 'l1' })]);
    expect(query.mock.calls[0][0]).toContain('s.tenant_id = $1::uuid');
    expect(query.mock.calls[0][0]).toContain('(s.recruiter_id = $2::uuid OR r.job_reviewer_id = $2::uuid)');
    expect(query.mock.calls[0].slice(1)).toEqual(['tenant-a', 'recruiter-a']);
    expect(query.mock.calls[1].slice(1)).toEqual(['tenant-a', 'recruiter-a', 25, 0]);
  });

  it('limits scheduling-only account managers to their assigned jobs', async () => {
    await service.findEligibleForInterview('tenant-a', {
      dbId: 'manager-a', systemRole: 'ACCOUNT_MANAGER', roles: ['ACCOUNT_MANAGER'],
      permissions: ['submission:schedule_interview'],
    } as any, { view: 'my' });

    expect(query.mock.calls[0][0]).toContain('j.account_manager_id = $2::uuid');
    expect(query.mock.calls[0].slice(1)).toEqual(['tenant-a', 'manager-a']);
    await expect(service.findEligibleForInterview('tenant-a', {
      dbId: 'manager-a', systemRole: 'ACCOUNT_MANAGER', roles: ['ACCOUNT_MANAGER'],
      permissions: ['submission:schedule_interview'],
    } as any, { view: 'all' })).rejects.toThrow('All-submission access');
    expect(query).toHaveBeenCalledTimes(2);
  });

  it('limits scheduling-only unit admins to their assigned branch and unit', async () => {
    await service.findEligibleForInterview('tenant-a', {
      dbId: 'unit-admin-a', permissions: ['submission:schedule_interview', 'unit_admin:manage'],
    } as any, { view: 'all', branchId: 'branch-a' });

    expect(membership).toHaveBeenCalledWith({
      where: { id: 'unit-admin-a', tenantId: 'tenant-a', isActive: true, isApproved: true },
      select: { branchId: true, businessUnitId: true },
    });
    expect(query.mock.calls[0][0]).toContain('j.branch_id = $2::uuid');
    expect(query.mock.calls[0][0]).toContain('j.business_unit_id = $3::uuid');
    expect(query.mock.calls[0].slice(1)).toEqual(['tenant-a', 'branch-a', 'unit-a']);
  });

  it('rejects users without interview scheduling permission before querying', async () => {
    await expect(service.findEligibleForInterview('tenant-a', {
      dbId: 'recruiter-a', permissions: ['submission:view'],
    } as any, { view: 'all' })).rejects.toThrow('submission:schedule_interview');
    expect(query).not.toHaveBeenCalled();
  });
});
