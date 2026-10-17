import { RecruiterSubmissionsService } from './recruiter-submissions.service';

describe('interview calendar visibility', () => {
  let query: jest.Mock;
  let membership: jest.Mock;
  let service: RecruiterSubmissionsService;

  beforeEach(() => {
    query = jest.fn().mockResolvedValue([]);
    membership = jest.fn().mockResolvedValue({ branchId: 'branch-a', businessUnitId: 'unit-a' });
    service = new RecruiterSubmissionsService({ $queryRawUnsafe: query, user: { findFirst: membership } } as any, {} as any);
  });

  it('limits recruiter calendar events to submissions they submitted or review', async () => {
    await service.findCalendarEvents('tenant-a', { dbId: 'recruiter-a', permissions: ['submission:view'] } as any, 'branch-a', '2026-10-01', '2026-11-01');
    expect(query.mock.calls[0][0]).toContain('(s.recruiter_id = $4::uuid OR r.job_reviewer_id = $4::uuid)');
    expect(query.mock.calls[0].slice(1)).toEqual(['tenant-a', new Date('2026-10-01'), new Date('2026-11-01'), 'recruiter-a']);
  });

  it('limits Account Manager calendar events to jobs assigned to that manager by default', async () => {
    await service.findCalendarEvents('tenant-a', { dbId: 'manager-a', systemRole: 'ACCOUNT_MANAGER', roles: ['ACCOUNT_MANAGER'], permissions: ['submission:view', 'submission:schedule_interview'] } as any, 'branch-a', '2026-10-01', '2026-11-01');
    expect(query.mock.calls[0][0]).toContain('j.account_manager_id = $4::uuid');
    expect(query.mock.calls[0].slice(1)).toEqual(['tenant-a', new Date('2026-10-01'), new Date('2026-11-01'), 'manager-a']);
  });

  it('scopes unit oversight to the authenticated user’s assigned branch and unit', async () => {
    await service.findCalendarEvents('tenant-a', { dbId: 'head-a', permissions: ['submission:view', 'unit_admin:manage'] } as any, 'branch-a', '2026-10-01', '2026-11-01');
    expect(query.mock.calls[0][0]).toContain('j.branch_id = $4::uuid AND j.business_unit_id = $5::uuid');
    expect(query.mock.calls[0].slice(1)).toEqual(['tenant-a', new Date('2026-10-01'), new Date('2026-11-01'), 'branch-a', 'unit-a']);
  });

  it('does not allow an explicit branch header to expand beyond assigned branch', async () => {
    await expect(service.findCalendarEvents('tenant-a', { dbId: 'admin-a', permissions: ['submission:view', 'branch_admin:manage'] } as any, 'branch-b', '2026-10-01', '2026-11-01')).rejects.toThrow('current branch assignment');
    expect(query).not.toHaveBeenCalled();
  });

  it('requires submission visibility and validates a bounded date range', async () => {
    await expect(service.findCalendarEvents('tenant-a', { dbId: 'user-a', permissions: [] } as any, 'branch-a', '2026-10-01', '2026-11-01')).rejects.toThrow('submission:view');
    await expect(service.findCalendarEvents('tenant-a', { dbId: 'user-a', permissions: ['submission:view'] } as any, 'branch-a', '2026-01-01', '2026-10-01')).rejects.toThrow('no longer than 93 days');
    expect(query).not.toHaveBeenCalled();
  });
});
