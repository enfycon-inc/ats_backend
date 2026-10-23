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
    prisma.$transaction = jest.fn(async (work: any) => work(prisma));
    prisma.$queryRaw = jest.fn().mockResolvedValue([]);
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
  it.each([
    [{ workMode: 'In Office' }, 'In Office'],
    [{ workMode: 'Remote' }, 'Remote'],
    [{ workMode: 'Hybrid' }, 'Hybrid'],
    [{ remoteJob: 'No' }, 'In Office'],
    [{ remoteJob: 'Yes' }, 'Remote'],
    [{ workMode: 'In Office', remoteJob: 'Yes' }, 'In Office'],
  ])('persists work mode from %j as %s', async (fields, expected) => {
    const { service, prisma, dto } = setup();
    await service.createJob({ ...dto, ...fields }, id, 'creator@example.com');
    expect(prisma.job.create.mock.calls[0][0].data.workMode).toBe(expected);
  });
  it('rejects an empty assignment when the unit disallows assign later', async () => {
    const { service, prisma, dto } = setup();
    prisma.businessUnit.findFirst.mockResolvedValue({ id: unit, allowUnassigned: false });
    await expect(service.createJob(dto, id)).rejects.toThrow('Select a pod or at least one recruiter');
    expect(prisma.job.create).not.toHaveBeenCalled();
  });
  it('rejects a pod from another unit before creating a job', async () => {
    const { service, prisma, dto } = setup();
    prisma.businessUnit.findFirst.mockResolvedValue({ id: unit, allowPods: true, podDistributionStrategy: "MANUAL", allowUnassigned: false });
    prisma.pod = { findMany: jest.fn().mockResolvedValue([]) };
    await expect(service.createJob({ ...dto, podId: manager }, id, 'System', id,
      { dbId: id, tenantId: id, branchId: id, businessUnitId: unit, permissions: ['job:create', 'job:assign_pod'] })).rejects.toThrow('outside the job unit');
    expect(prisma.job.create).not.toHaveBeenCalled();
  });
  it('persists an explicit unit pod without searching the tenant for another pod', async () => {
    const { service, prisma, dto } = setup();
    prisma.businessUnit.findFirst.mockResolvedValue({ id: unit, allowPods: true, podDistributionStrategy: "MANUAL", allowUnassigned: false });
    prisma.pod = { findMany: jest.fn().mockResolvedValue([{ id: manager, _count: { users: 1 } }]), findFirst: jest.fn() };
    prisma.jobPod.upsert = jest.fn();
    prisma.jobAssignmentLog = { create: jest.fn() };
    await service.createJob({ ...dto, podId: manager }, id, 'System', id,
      { dbId: id, tenantId: id, branchId: id, businessUnitId: unit, permissions: ['job:create', 'job:assign_pod'] });
    expect(prisma.jobPod.upsert).toHaveBeenCalledWith(expect.objectContaining({ create: { jobId: id, podId: manager } }));
    expect(prisma.pod.findFirst).not.toHaveBeenCalled();
  });
  it('rejects the retired unit pool sentinel', async () => {
    const { service, prisma, dto } = setup();
    await expect(service.createJob({ ...dto, podId: 'all' }, id)).rejects.toThrow('instead of a unit pool');
    expect(prisma.job.create).not.toHaveBeenCalled();
  });
  it('persists all selected manual pods once', async () => {
    const { service, prisma, dto } = setup();
    const second = '44444444-4444-4444-8444-444444444444';
    prisma.businessUnit.findFirst.mockResolvedValue({ id: unit, allowPods: true, podDistributionStrategy: 'MANUAL', allowUnassigned: false });
    prisma.pod = { findMany: jest.fn().mockResolvedValue([manager, second].map(id => ({ id, _count: { users: 1 } }))) };
    prisma.jobPod.upsert = jest.fn();
    prisma.jobAssignmentLog = { create: jest.fn() };
    await service.createJob({ ...dto, podId: manager, podIds: [manager, second, manager] }, id, 'System', id,
      { dbId: id, tenantId: id, branchId: id, businessUnitId: unit, permissions: ['job:create', 'job:assign_pod'] });
    expect(prisma.jobPod.upsert).toHaveBeenCalledTimes(2);
    expect(prisma.jobPod.upsert.mock.calls.map(([args]: any[]) => args.create.podId)).toEqual([manager, second]);
    expect(prisma.jobAssignmentLog.create).toHaveBeenCalledTimes(2);
  });
  it('rejects mixing manual pods with direct recruiters before saving', async () => {
    const { service, prisma, dto } = setup();
    await expect(service.createJob({ ...dto, podIds: [manager], recruiterIds: [manager] }, id))
      .rejects.toThrow('either pods or direct recruiters');
    expect(prisma.job.create).not.toHaveBeenCalled();
  });
  it('rejects a foreign pod in a multiple-pod selection', async () => {
    const { service, prisma, dto } = setup();
    prisma.businessUnit.findFirst.mockResolvedValue({ id: unit, allowPods: true, podDistributionStrategy: 'MANUAL' });
    prisma.pod = { findMany: jest.fn().mockResolvedValue([{ id: manager, _count: { users: 1 } }]) };
    await expect(service.createJob({ ...dto, podIds: [manager, unit] }, id, 'System', id,
      { dbId: id, tenantId: id, branchId: id, businessUnitId: unit, permissions: ['job:create', 'job:assign_pod'] })).rejects.toThrow('outside the job unit');
    expect(prisma.job.create).not.toHaveBeenCalled();
  });
  it.each(['MANUAL', 'AUTO'])('persists initial direct recruiters without override permission under %s policy', async strategy => {
    const { service, prisma, dto } = setup();
    prisma.businessUnit.findFirst.mockResolvedValue({ id: unit, allowPods: true, allowNone: true, allowUnassigned: false, podDistributionStrategy: strategy });
    const second = '44444444-4444-4444-8444-444444444444';
    prisma.auditLog = { create: jest.fn() };
    prisma.jobRecruiter = { createMany: jest.fn().mockResolvedValue({ count: 2 }) };
    prisma.$queryRawUnsafe.mockImplementation(async (sql: string) => sql.includes('CROSS JOIN LATERAL')
      ? [manager, second].map(id => ({ id, fullName: 'Recruiter', canRecruit: true, canReview: false }))
      : [{ id, permissions: ['job:publish_direct'], job_reviewer_id: null, pod_head_id: null }]);
    await service.createJob({ ...dto, recruiterId: manager, recruiterIds: [manager, second, manager] }, id, id, id,
      { dbId: id, tenantId: id, branchId: id, businessUnitId: unit, permissions: ['job:create', 'job:assign_recruiter'] });
    expect(prisma.jobRecruiter.createMany).toHaveBeenCalledWith({ data: [
      { jobId: id, recruiterId: manager }, { jobId: id, recruiterId: second },
    ], skipDuplicates: true });
    expect(prisma.auditLog.create).toHaveBeenCalledWith({ data: {
      tenantId: id, actorId: id, action: 'JOB_RECRUITER_ASSIGNMENT', targetType: 'job', targetId: id,
      details: { recruiterIds: [manager, second] },
    } });
  });
  it.each([false, undefined])('rejects direct recruiters when unit policy is not enabled (%s)', async allowNone => {
    const { service, prisma, dto } = setup();
    prisma.businessUnit.findFirst.mockResolvedValue({ id: unit, allowNone });
    await expect(service.createJob({ ...dto, recruiterId: manager, recruiterIds: [manager] }, id, id, id,
      { dbId: id, tenantId: id, branchId: id, businessUnitId: unit, permissions: ['job:create', 'job:assign_recruiter', 'job:override_assignment'] }))
      .rejects.toThrow('Direct recruiter assignment is disabled');
    expect(prisma.job.create).not.toHaveBeenCalled();
  });
  it('rejects initial recruiter assignment without explicit permission', async () => {
    const { service, prisma, dto } = setup();
    prisma.businessUnit.findFirst.mockResolvedValue({ id: unit, allowNone: true });
    await expect(service.createJob({ ...dto, recruiterIds: [manager] }, id, id, id,
      { dbId: id, tenantId: id, branchId: id, businessUnitId: unit, permissions: ['job:create'] }))
      .rejects.toThrow('Recruiter assignment permission');
    expect(prisma.job.create).not.toHaveBeenCalled();
  });
  it('rejects initial recruiter assignment to a different unit', async () => {
    const { service, prisma, dto } = setup();
    prisma.businessUnit.findFirst.mockResolvedValue({ id: unit, allowNone: true });
    await expect(service.createJob({ ...dto, recruiterIds: [manager] }, id, id, id,
      { dbId: id, tenantId: id, branchId: id, businessUnitId: manager, permissions: ['job:create', 'job:assign_recruiter'] }))
      .rejects.toThrow('assigned unit');
    expect(prisma.job.create).not.toHaveBeenCalled();
  });
  it('does not swallow reviewer query failures or create a job', async () => {
    const { service, prisma, dto } = setup();
    prisma.$queryRawUnsafe.mockRejectedValue(new Error('database unavailable'));
    await expect(service.createJob(dto, id, 'creator@example.com')).rejects.toThrow('database unavailable');
    expect(prisma.job.create).not.toHaveBeenCalled();
  });
});
