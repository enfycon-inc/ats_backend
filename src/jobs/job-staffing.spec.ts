import { listJobStaff, listJobPods, validateJobRecruiters } from './job-staffing';
import { JobsController } from './jobs.controller';
import { JobsService } from './jobs.service';

describe('job recruiter staffing permissions and scope', () => {
  const tenant = '11111111-1111-4111-8111-111111111111';
  const branch = '22222222-2222-4222-8222-222222222222';
  const unit = '33333333-3333-4333-8333-333333333333';
  const recruiter = '44444444-4444-4444-8444-444444444444';
  const other = '55555555-5555-4555-8555-555555555555';
  const actor: any = { tenantId: tenant, branchId: branch, businessUnitId: unit,
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
  it('does not combine recruiter and pod assignment permissions', async () => {
    await expect(listJobPods(prisma, actor, tenant, branch, unit)).rejects.toThrow('Pod assignment permission');
  });

  it('lets Account Manager select recruiters without user management permission', async () => {
    expect(actor.permissions).not.toContain('user:manage');
    expect(await listJobStaff(prisma, actor, tenant, branch, unit)).toEqual([
      { id: recruiter, fullName: 'Recruiter', canRecruit: true, canReview: false },
    ]);
    expect(prisma.$queryRawUnsafe.mock.calls[0].slice(1)).toEqual([tenant, branch, unit]);
    const sql = prisma.$queryRawUnsafe.mock.calls[0][0];
    expect(sql).toContain('staff.is_approved = true');
    expect(sql).toContain('staff.is_active = true');
    expect(sql).toContain("role.permissions::jsonb ? 'submission:create'");
    expect(sql).not.toContain('staff.email');
  });

  it('denies an admin-labelled active role lacking recruiter assignment capability', async () => {
    await expect(listJobStaff(prisma, { ...actor, roles: ['TENANT_ADMIN'], permissions: ['user:manage'] }, tenant)).rejects.toThrow('Recruiter assignment permission');
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
    prisma.job = { findFirst: jest.fn().mockResolvedValue({ id: other, tenantId: tenant, branchId: branch, businessUnitId: unit }), update: jest.fn() };
    prisma.jobPod = { findMany: jest.fn().mockResolvedValue([]) };
    const service = new JobsService(prisma, {} as any);
    await expect(service.updateJob(other, { recruiterIds: [recruiter, other] }, tenant,
      { ...actor, permissions: [...actor.permissions, 'job:edit'] })).rejects.toThrow('eligible');
    expect(prisma.job.update).not.toHaveBeenCalled();
  });

  it('cannot clear the last assignment when assign later is disabled', async () => {
    prisma.businessUnit.findFirst.mockResolvedValue({ id: unit, allowUnassigned: false });
    prisma.job = { findFirst: jest.fn().mockResolvedValue({ id: other, branchId: branch, businessUnitId: unit }), update: jest.fn() };
    prisma.jobPod = { findMany: jest.fn().mockResolvedValue([]) };
    await expect(new JobsService(prisma, {} as any).updateJob(other, { podId: 'none', recruiterIds: [] }, tenant,
      { ...actor, permissions: [...actor.permissions, 'job:edit'] })).rejects.toThrow('Select a pod or at least one recruiter');
    expect(prisma.job.update).not.toHaveBeenCalled();
  });
  it('cannot remove an existing pod using recruiter assignment permission', async () => {
    prisma.job = { findFirst: jest.fn().mockResolvedValue({ id: other, branchId: branch, businessUnitId: unit }), update: jest.fn() };
    prisma.jobPod = { findMany: jest.fn().mockResolvedValue([{ podId: recruiter }]) };
    await expect(new JobsService(prisma, {} as any).updateJob(other, { podId: 'none' }, tenant, actor)).rejects.toThrow('Pod assignment permission');
    expect(prisma.job.update).not.toHaveBeenCalled();
  });

  it('routes staffing requests to the job service rather than the administrative directory', async () => {
    const service: any = { listJobStaff: jest.fn().mockResolvedValue([]) };
    await new JobsController(service).staffingOptions(actor, undefined, branch, unit);
    expect(service.listJobStaff).toHaveBeenCalledWith(actor, tenant, branch, unit);
  });
});
