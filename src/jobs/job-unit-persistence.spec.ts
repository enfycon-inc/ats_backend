import { JobsService } from './jobs.service';

describe('job operating unit persistence and reviewer routing', () => {
  const id = '11111111-1111-4111-8111-111111111111';
  const unit = '22222222-2222-4222-8222-222222222222';
  const manager = '33333333-3333-4333-8333-333333333333';
  function setup(direct = true) {
    const prisma: any = {
      tenant: { findUnique: jest.fn().mockResolvedValue({ name: 'Tenant', podSystemEnabled: false }) },
      branch: { findFirst: jest.fn().mockImplementation(async (args: any) => args.select?.managers ? { managers: [{ id: manager }] } : { id, code: 'BBS' }), findUnique: jest.fn().mockResolvedValue({ allowNone: true }) },
      businessUnit: { findFirst: jest.fn().mockResolvedValue({ id: unit }) },
      job: { findUnique: jest.fn().mockResolvedValue(null), create: jest.fn().mockResolvedValue({ id }), update: jest.fn() },
      jobPod: { deleteMany: jest.fn() },
      $queryRawUnsafe: jest.fn().mockResolvedValue([{ id, permissions: direct ? ['job:publish_direct'] : [], job_reviewer_id: null, pod_head_id: null }]),
    };
    const service: any = new JobsService(prisma, { create: jest.fn(), createMany: jest.fn() } as any);
    service.ensureClientExists = jest.fn();
    service.resolveUserUuid = jest.fn(async (value: string) => value || null);
    service.getDeliveryHeadIds = jest.fn().mockResolvedValue([]);
    service.findOneJob = jest.fn().mockResolvedValue({ id, businessUnitId: unit });
    return { service, prisma, dto: { title: 'Engineer', branchId: id, businessUnitId: unit, jobCode: 'BBS-IND-TEST', podId: 'none', market: 'IND' } };
  }
  it.each([true, false])('saves unit and returns saved job with direct publishing %s', async direct => {
    const { service, prisma, dto } = setup(direct);
    await expect(service.createJob(dto, id, 'creator@example.com')).resolves.toMatchObject({ businessUnitId: unit });
    expect(prisma.job.create.mock.calls[0][0].data).toMatchObject({ businessUnitId: unit, assignedApproverId: manager, approvalStatus: direct ? 'APPROVED' : 'PENDING_APPROVAL' });
    expect(prisma.$queryRawUnsafe.mock.calls[0][0]).not.toContain('b.manager_id');
  });
  it('rejects a foreign unit before saving', async () => {
    const { service, prisma, dto } = setup();
    prisma.businessUnit.findFirst.mockResolvedValue(null);
    await expect(service.createJob(dto, id)).rejects.toMatchObject({ status: 400 });
    expect(prisma.job.create).not.toHaveBeenCalled();
  });
  it('persists every validated recruiter once when Account Manager creates a job', async () => {
    const { service, prisma, dto } = setup();
    const second = '44444444-4444-4444-8444-444444444444';
    prisma.jobRecruiter = { createMany: jest.fn().mockResolvedValue({ count: 2 }) };
    prisma.$queryRawUnsafe.mockImplementation(async (sql: string) => sql.includes('CROSS JOIN LATERAL')
      ? [manager, second].map(id => ({ id, fullName: 'Recruiter', canRecruit: true, canReview: false }))
      : [{ id, permissions: ['job:publish_direct'], job_reviewer_id: null, pod_head_id: null }]);
    await service.createJob({ ...dto, recruiterId: manager, recruiterIds: [manager, second, manager] }, id, id, id,
      { dbId: id, tenantId: id, branchId: id, businessUnitId: unit, permissions: ['job:create', 'job:assign_recruiter'] });
    expect(prisma.jobRecruiter.createMany).toHaveBeenCalledWith({ data: [
      { jobId: id, recruiterId: manager }, { jobId: id, recruiterId: second },
    ], skipDuplicates: true });
  });
  it('does not swallow reviewer query failures or create a job', async () => {
    const { service, prisma, dto } = setup();
    prisma.$queryRawUnsafe.mockRejectedValue(new Error('database unavailable'));
    await expect(service.createJob(dto, id, 'creator@example.com')).rejects.toThrow('database unavailable');
    expect(prisma.job.create).not.toHaveBeenCalled();
  });
});
