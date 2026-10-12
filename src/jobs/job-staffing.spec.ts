import { listJobStaff, listJobPods, validateJobRecruiters } from './job-staffing';
import { JobsController } from './jobs.controller';
import { JobsService } from './jobs.service';

describe('job recruiter staffing permissions and scope', () => {
  const tenant = '11111111-1111-4111-8111-111111111111';
  const branch = '22222222-2222-4222-8222-222222222222';
  const unit = '33333333-3333-4333-8333-333333333333';
  const recruiter = '44444444-4444-4444-8444-444444444444';
  const other = '55555555-5555-4555-8555-555555555555';
  const actor: any = { id: other, dbId: other, tenantId: tenant, branchId: branch, businessUnitId: unit,
    permissions: ['job:create', 'job:assign_recruiter'], roles: ['ACCOUNT_MANAGER'] };
  let prisma: any;
  beforeEach(() => {
    prisma = { businessUnit: { findFirst: jest.fn().mockResolvedValue({ id: unit }) },
      $queryRawUnsafe: jest.fn().mockResolvedValue([{ id: recruiter, fullName: 'Recruiter', canRecruit: true, canReview: false }]) };
  });

  it('lists unit pods with pod assignment permission without pod management access', async () => {
    prisma.pod = { findMany: jest.fn().mockResolvedValue([]) };
    await expect(listJobPods(prisma, { ...actor, permissions: ['job:assign_pod'] }, tenant, branch, unit)).resolves.toEqual([]);
    expect(prisma.pod.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { tenantId: tenant, businessUnitId: unit, branchId: branch } }));
  });
  it('returns the pod member count and lead name for job assignment options', async () => {
    prisma.pod = { findMany: jest.fn().mockResolvedValue([
      {
        id: 'pod-1', name: 'POD 1', businessUnitId: unit, branchId: branch, podHeadId: other,
        podHead: { fullName: 'Pod Lead' }, _count: { users: 3 },
      },
      {
        id: 'pod-2', name: 'POD 2', businessUnitId: unit, branchId: branch, podHeadId: null,
        podHead: null, _count: { users: 0 },
      },
    ]) };

    await expect(listJobPods(prisma, { ...actor, permissions: ['job:assign_pod'] }, tenant, branch, unit)).resolves.toEqual([
      {
        id: 'pod-1', name: 'POD 1', businessUnitId: unit, branchId: branch, podHeadId: other,
        podHeadName: 'Pod Lead', memberCount: 3,
      },
      {
        id: 'pod-2', name: 'POD 2', businessUnitId: unit, branchId: branch, podHeadId: null,
        podHeadName: null, memberCount: 0,
      },
    ]);
    expect(prisma.pod.findMany).toHaveBeenCalledWith(expect.objectContaining({
      select: expect.objectContaining({
        podHead: { select: { fullName: true } },
        _count: { select: { users: true } },
      }),
    }));
  });
  it('does not combine recruiter and pod assignment permissions', async () => {
    await expect(listJobPods(prisma, actor, tenant, branch, unit)).rejects.toThrow('Pod assignment permission');
  });

  it('lets Account Manager select recruiters without user management permission', async () => {
    expect(actor.permissions).not.toContain('user:manage');
    expect(await listJobStaff(prisma, actor, tenant, branch, unit)).toEqual([
      { id: recruiter, fullName: 'Recruiter', canRecruit: true, canReview: false },
    ]);
    expect(prisma.$queryRawUnsafe.mock.calls[0].slice(1)).toEqual([tenant, branch, unit, null]);
    const sql = prisma.$queryRawUnsafe.mock.calls[0][0];
    expect(sql).toContain('staff.is_approved = true');
    expect(sql).toContain('staff.is_active = true');
    expect(sql).toContain("role.permissions::jsonb ? 'submission:create'");
    expect(sql).toContain('staff.email');
  });

  it('denies an admin-labelled active role lacking recruiter assignment capability', async () => {
    await expect(listJobStaff(prisma, { ...actor, roles: ['TENANT_ADMIN'], permissions: ['user:manage'] }, tenant)).rejects.toThrow('Recruiter assignment permission');
    expect(prisma.$queryRawUnsafe).not.toHaveBeenCalled();
  });

  it('denies recruiter-role users even if recruiter assignment permission is accidentally present', async () => {
    await expect(listJobStaff(prisma, { ...actor, roles: ['RECRUITER'], permissions: ['job:assign_recruiter'] }, tenant))
      .rejects.toThrow('Recruiters cannot assign recruiters');
    expect(prisma.$queryRawUnsafe).not.toHaveBeenCalled();
  });

  it('rejects foreign branches before querying staff', async () => {
    await expect(listJobStaff(prisma, actor, tenant, other, unit)).rejects.toThrow('assigned branch');
    expect(prisma.$queryRawUnsafe).not.toHaveBeenCalled();
  });

  it('rejects foreign units for Account Manager', async () => {
    await expect(listJobStaff(prisma, actor, tenant, branch, other)).rejects.toThrow('assigned unit');
    expect(prisma.$queryRawUnsafe).not.toHaveBeenCalled();
  });

  it('fails closed without unit membership', async () => {
    await expect(listJobStaff(prisma, { ...actor, businessUnitId: null }, tenant, branch)).rejects.toThrow('assigned unit');
  });

  it('checks selected units against the tenant and branch for branch administrators', async () => {
    prisma.businessUnit.findFirst.mockResolvedValue(null);
    await expect(listJobStaff(prisma, { ...actor, permissions: [...actor.permissions, 'branch_admin:manage'] }, tenant, branch, other)).rejects.toThrow('outside');
    expect(prisma.businessUnit.findFirst).toHaveBeenCalledWith({ where: { id: other, tenantId: tenant, branchId: branch }, select: { id: true } });
    expect(prisma.$queryRawUnsafe).not.toHaveBeenCalled();
  });

  it('validates every selected recruiter rather than just the primary recruiter', async () => {
    await expect(validateJobRecruiters(prisma, actor, tenant, [recruiter, other], branch, unit)).rejects.toThrow('eligible');
    await expect(validateJobRecruiters(prisma, actor, tenant, [recruiter], branch, unit)).resolves.toBeUndefined();
  });

  it('rejects staff who can review but cannot recruit', async () => {
    prisma.$queryRawUnsafe.mockResolvedValue([{ id: recruiter, fullName: 'Reviewer', canRecruit: false, canReview: true }]);
    await expect(validateJobRecruiters(prisma, actor, tenant, [recruiter], branch, unit)).rejects.toThrow('eligible');
  });

  it('rejects invalid IDs without database queries', async () => {
    await expect(listJobStaff(prisma, actor, tenant, 'bad-id')).rejects.toThrow('valid branch');
    await expect(validateJobRecruiters(prisma, actor, tenant, ['bad-id'], branch, unit)).rejects.toThrow('valid recruiter');
    expect(prisma.$queryRawUnsafe).not.toHaveBeenCalled();
  });

  it('rejects forged recruiters before a job creation write', async () => {
    prisma.tenant = { findUnique: jest.fn().mockResolvedValue({ name: 'Tenant' }) };
    prisma.branch = { findFirst: jest.fn().mockResolvedValue({ id: branch, code: 'BR' }) };
    prisma.job = { create: jest.fn() };
    const service = new JobsService(prisma, {} as any);
    await expect(service.createJob({ title: 'Job', branchId: branch, businessUnitId: unit,
      recruiterIds: [recruiter, other] } as any, tenant, actor.dbId, branch, actor)).rejects.toThrow('eligible');
    expect(prisma.job.create).not.toHaveBeenCalled();
  });

  it('rejects forged secondary recruiters before a job update write', async () => {
    prisma.job = { findFirst: jest.fn().mockResolvedValue({ id: other, tenantId: tenant, branchId: branch, businessUnitId: unit, accountManagerId: actor.dbId }), update: jest.fn() };
    prisma.jobPod = { findMany: jest.fn().mockResolvedValue([]) };
    const service = new JobsService(prisma, {} as any);
    await expect(service.updateJob(other, { recruiterIds: [recruiter, other] }, tenant,
      { ...actor, permissions: [...actor.permissions, 'job:edit'] })).rejects.toThrow('eligible');
    expect(prisma.job.update).not.toHaveBeenCalled();
  });

  it('rejects Account Manager assigning recruiters to jobs created by other Account Managers', async () => {
    prisma.job = { findFirst: jest.fn().mockResolvedValue({ id: other, tenantId: tenant, branchId: branch, businessUnitId: unit, accountManagerId: 'another-am-id' }), update: jest.fn() };
    prisma.jobPod = { findMany: jest.fn().mockResolvedValue([]) };
    const service = new JobsService(prisma, { create: jest.fn(), createMany: jest.fn() } as any);
    await expect(service.updateJob(other, { recruiterIds: [recruiter] }, tenant,
      { ...actor, permissions: [...actor.permissions, 'job:edit'] })).rejects.toThrow('Account Managers can only assign recruiters to their own created jobs');
    expect(prisma.job.update).not.toHaveBeenCalled();
  });

  it('allows Delivery Head to assign recruiters on any job created by any Account Manager', async () => {
    prisma.job = {
      findFirst: jest.fn().mockResolvedValue({ id: other, tenantId: tenant, branchId: branch, businessUnitId: unit, accountManagerId: 'another-am-id', jobCode: 'JOB-DH' }),
      update: jest.fn().mockResolvedValue({ id: other }),
    };
    prisma.jobPod = { findMany: jest.fn().mockResolvedValue([]) };
    prisma.user = { findFirst: jest.fn().mockResolvedValue({ id: recruiter }) };
    prisma.jobRecruiter = { count: jest.fn().mockResolvedValue(1), deleteMany: jest.fn().mockResolvedValue({ count: 1 }), createMany: jest.fn().mockResolvedValue({ count: 1 }) };
    prisma.businessUnit = { findFirst: jest.fn().mockResolvedValue({ id: unit, allowUnassigned: true }) };
    const service = new JobsService(prisma, { create: jest.fn(), createMany: jest.fn() } as any);
    jest.spyOn(service, 'findOneJob').mockResolvedValue({ id: other } as any);

    const deliveryHeadActor = {
      id: 'dh-user-id',
      dbId: 'dh-user-id',
      tenantId: tenant,
      branchId: branch,
      roles: ['DELIVERY_HEAD'],
      permissions: ['job:edit', 'job:assign', 'job:assign_recruiter'],
    };

    const result = await service.updateJob(other, { recruiterIds: [recruiter] }, tenant, deliveryHeadActor);
    expect(result).toBeDefined();
    expect(prisma.jobRecruiter.createMany).toHaveBeenCalledWith({
      data: [{ jobId: other, recruiterId: recruiter }],
    });
  });

  it('allows Branch Admin to assign recruiters on any job within the branch', async () => {
    prisma.job = {
      findFirst: jest.fn().mockResolvedValue({ id: other, tenantId: tenant, branchId: branch, businessUnitId: unit, accountManagerId: 'another-am-id', jobCode: 'JOB-BA' }),
      update: jest.fn().mockResolvedValue({ id: other }),
    };
    prisma.jobPod = { findMany: jest.fn().mockResolvedValue([]) };
    prisma.user = { findFirst: jest.fn().mockResolvedValue({ id: recruiter }) };
    prisma.jobRecruiter = { count: jest.fn().mockResolvedValue(1), deleteMany: jest.fn().mockResolvedValue({ count: 1 }), createMany: jest.fn().mockResolvedValue({ count: 1 }) };
    prisma.businessUnit = { findFirst: jest.fn().mockResolvedValue({ id: unit, allowUnassigned: true }) };
    const service = new JobsService(prisma, { create: jest.fn(), createMany: jest.fn() } as any);
    jest.spyOn(service, 'findOneJob').mockResolvedValue({ id: other } as any);

    const branchAdminActor = {
      id: 'ba-user-id',
      dbId: 'ba-user-id',
      tenantId: tenant,
      branchId: branch,
      roles: ['BRANCH_ADMIN'],
      permissions: ['job:edit', 'branch_admin:manage', 'job:assign_recruiter'],
    };

    const result = await service.updateJob(other, { recruiterIds: [recruiter] }, tenant, branchAdminActor);
    expect(result).toBeDefined();
    expect(prisma.jobRecruiter.createMany).toHaveBeenCalledWith({
      data: [{ jobId: other, recruiterId: recruiter }],
    });
  });

  it('allows Unit Admin to assign recruiters on any job within the unit', async () => {
    prisma.job = {
      findFirst: jest.fn().mockResolvedValue({ id: other, tenantId: tenant, branchId: branch, businessUnitId: unit, accountManagerId: 'another-am-id', jobCode: 'JOB-UA' }),
      update: jest.fn().mockResolvedValue({ id: other }),
    };
    prisma.jobPod = { findMany: jest.fn().mockResolvedValue([]) };
    prisma.user = { findFirst: jest.fn().mockResolvedValue({ id: recruiter }) };
    prisma.jobRecruiter = { count: jest.fn().mockResolvedValue(1), deleteMany: jest.fn().mockResolvedValue({ count: 1 }), createMany: jest.fn().mockResolvedValue({ count: 1 }) };
    prisma.businessUnit = { findFirst: jest.fn().mockResolvedValue({ id: unit, allowUnassigned: true }) };
    const service = new JobsService(prisma, { create: jest.fn(), createMany: jest.fn() } as any);
    jest.spyOn(service, 'findOneJob').mockResolvedValue({ id: other } as any);

    const unitAdminActor = {
      id: 'ua-user-id',
      dbId: 'ua-user-id',
      tenantId: tenant,
      branchId: branch,
      businessUnitId: unit,
      roles: ['UNIT_ADMIN'],
      permissions: ['job:edit', 'unit_admin:manage', 'job:assign_recruiter'],
    };

    const result = await service.updateJob(other, { recruiterIds: [recruiter] }, tenant, unitAdminActor);
    expect(result).toBeDefined();
    expect(prisma.jobRecruiter.createMany).toHaveBeenCalledWith({
      data: [{ jobId: other, recruiterId: recruiter }],
    });
  });

  it('allows Tenant Admin to assign recruiters on any job created by any Account Manager', async () => {
    prisma.job = {
      findFirst: jest.fn().mockResolvedValue({ id: other, tenantId: tenant, branchId: branch, businessUnitId: unit, accountManagerId: 'another-am-id', jobCode: 'JOB-TA' }),
      update: jest.fn().mockResolvedValue({ id: other }),
    };
    prisma.jobPod = { findMany: jest.fn().mockResolvedValue([]) };
    prisma.user = { findFirst: jest.fn().mockResolvedValue({ id: recruiter }) };
    prisma.jobRecruiter = { count: jest.fn().mockResolvedValue(1), deleteMany: jest.fn().mockResolvedValue({ count: 1 }), createMany: jest.fn().mockResolvedValue({ count: 1 }) };
    prisma.businessUnit = { findFirst: jest.fn().mockResolvedValue({ id: unit, allowUnassigned: true }) };
    const service = new JobsService(prisma, { create: jest.fn(), createMany: jest.fn() } as any);
    jest.spyOn(service, 'findOneJob').mockResolvedValue({ id: other } as any);

    const tenantAdminActor = {
      id: 'ta-user-id',
      dbId: 'ta-user-id',
      tenantId: tenant,
      roles: ['TENANT_ADMIN'],
      permissions: ['job:edit', 'tenant:manage', 'job:assign_recruiter'],
    };

    const result = await service.updateJob(other, { recruiterIds: [recruiter] }, tenant, tenantAdminActor);
    expect(result).toBeDefined();
    expect(prisma.jobRecruiter.createMany).toHaveBeenCalledWith({
      data: [{ jobId: other, recruiterId: recruiter }],
    });
  });

  it('cannot clear the last assignment when assign later is disabled', async () => {
    prisma.businessUnit.findFirst.mockResolvedValue({ id: unit, allowUnassigned: false });
    prisma.job = { findFirst: jest.fn().mockResolvedValue({ id: other, branchId: branch, businessUnitId: unit, accountManagerId: actor.dbId }), update: jest.fn() };
    prisma.jobPod = { findMany: jest.fn().mockResolvedValue([]) };
    await expect(new JobsService(prisma, {} as any).updateJob(other, { podId: 'none', recruiterIds: [] }, tenant,
      { ...actor, permissions: [...actor.permissions, 'job:edit'] })).rejects.toThrow('Select a pod or at least one recruiter');
    expect(prisma.job.update).not.toHaveBeenCalled();
  });
  it('cannot remove an existing pod using recruiter assignment permission', async () => {
    prisma.job = { findFirst: jest.fn().mockResolvedValue({ id: other, branchId: branch, businessUnitId: unit, accountManagerId: actor.dbId }), update: jest.fn() };
    prisma.jobPod = { findMany: jest.fn().mockResolvedValue([{ podId: recruiter }]) };
    await expect(new JobsService(prisma, {} as any).updateJob(other, { podId: 'none' }, tenant, actor)).rejects.toThrow('Pod assignment permission');
    expect(prisma.job.update).not.toHaveBeenCalled();
  });

  it('routes staffing requests to the job service rather than the administrative directory', async () => {
    const service: any = { listJobStaff: jest.fn().mockResolvedValue([]) };
    await new JobsController(service).staffingOptions(actor, undefined, branch, unit);
    expect(service.listJobStaff).toHaveBeenCalledWith(actor, tenant, branch, unit, undefined);
  });

  it('allows Account Manager to fetch staffing options for their own created job by jobId', async () => {
    prisma.job = { findFirst: jest.fn().mockResolvedValue({ id: other, branchId: branch, businessUnitId: unit, accountManagerId: actor.dbId }) };
    await expect(listJobStaff(prisma, actor, tenant, branch, unit, other)).resolves.toBeDefined();
  });

  it('rejects Account Manager from fetching staffing options for another users job by jobId', async () => {
    prisma.job = { findFirst: jest.fn().mockResolvedValue({ id: other, branchId: branch, businessUnitId: unit, accountManagerId: '99999999-9999-4999-8999-999999999999' }) };
    await expect(listJobStaff(prisma, actor, tenant, branch, unit, other)).rejects.toThrow('Account Managers can only assign recruiters to their own created jobs');
  });

  it('lets a Pod Lead list eligible recruiters only for a job mapped to their pod', async () => {
    const podId = '66666666-6666-4666-8666-666666666666';
    prisma.pod = { findFirst: jest.fn().mockResolvedValue({ id: podId, branchId: branch, businessUnitId: unit }) };
    prisma.jobPod = { findUnique: jest.fn().mockResolvedValue({ jobId: other }) };
    const podLead = { ...actor, roles: ['POD_LEAD'], permissions: [] };

    await expect(listJobStaff(prisma, podLead, tenant, branch, unit, other)).resolves.toBeDefined();
    expect(prisma.$queryRawUnsafe.mock.calls[0].slice(1)).toEqual([tenant, branch, unit, podId]);
    expect(prisma.$queryRawUnsafe.mock.calls[0][0]).toContain('staff.pod_id = $4::uuid');
  });

  it('denies a Pod Lead staffing list for a job outside their pod', async () => {
    const podId = '66666666-6666-4666-8666-666666666666';
    prisma.pod = { findFirst: jest.fn().mockResolvedValue({ id: podId, branchId: branch, businessUnitId: unit }) };
    prisma.jobPod = { findUnique: jest.fn().mockResolvedValue(null) };
    await expect(listJobStaff(prisma, { ...actor, roles: ['POD_LEAD'], permissions: [] }, tenant, branch, unit, other))
      .rejects.toThrow('mapped to your pod');
    expect(prisma.$queryRawUnsafe).not.toHaveBeenCalled();
  });

  it('rejects a Pod Lead recruiter update when the job is not mapped to their pod', async () => {
    const podId = '66666666-6666-4666-8666-666666666666';
    prisma.job = { findFirst: jest.fn().mockResolvedValue({ id: other, tenantId: tenant, branchId: branch, businessUnitId: unit }), update: jest.fn() };
    prisma.jobPod = { findMany: jest.fn().mockResolvedValue([]) };
    prisma.pod = { findFirst: jest.fn().mockResolvedValue({ id: podId }) };
    const podLead = { ...actor, roles: ['POD_LEAD'], permissions: [] };

    await expect(new JobsService(prisma, {} as any).updateJob(other, { recruiterIds: [recruiter] }, tenant, podLead))
      .rejects.toThrow('mapped to your pod');
    expect(prisma.job.update).not.toHaveBeenCalled();
  });

  it('rejects recruiter assignment in updateJob when actor lacks job:assign_recruiter', async () => {
    prisma.job = { findFirst: jest.fn().mockResolvedValue({ id: other, branchId: branch, businessUnitId: unit, accountManagerId: actor.dbId }) };
    prisma.jobPod = { findMany: jest.fn().mockResolvedValue([]) };
    await expect(new JobsService(prisma, {} as any).updateJob(other, { recruiterIds: [recruiter] }, tenant,
      { ...actor, permissions: ['job:edit'] })).rejects.toThrow('You do not have permission to assign recruiters');
  });
});
