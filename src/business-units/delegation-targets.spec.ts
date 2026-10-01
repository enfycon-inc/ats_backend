import 'reflect-metadata';
import { BusinessUnitsController } from './business-units.controller';
import { BusinessUnitsService } from './business-units.service';
import { JobsService } from '../jobs/jobs.service';

describe('Delegation target contract', () => {
  const user = { tenantId: 'tenant', branchId: 'home', permissions: ['job:delegate'] };
  const job = { id: 'job', tenantId: 'tenant', branchId: 'home', businessUnitId: 'source', businessUnitRef: { marketSegmentId: 'segment' } };
  let prisma: any;
  let service: BusinessUnitsService;
  beforeEach(() => {
    prisma = {
      job: { findFirst: jest.fn().mockResolvedValue(job) },
      businessUnit: { findMany: jest.fn().mockResolvedValue([{ id: 'target', branchId: 'away', marketSegmentId: 'segment', name: 'Unit', branch: { id: 'away', name: 'Away' }, marketSegment: { code: 'INDIA' } }]) },
      jobDelegationRequest: { findFirst: jest.fn().mockResolvedValue(null), create: jest.fn().mockResolvedValue({ id: 'request' }) },
    };
    service = new BusinessUnitsService(prisma);
  });
  it('registers the literal endpoint and requires the delegation capability', async () => {
    const controller = new BusinessUnitsController(service);
    expect(Reflect.getMetadata('path', controller.delegationTargets)).toBe('delegation-targets');
    await expect(controller.delegationTargets({ user }, 'job')).resolves.toEqual(expect.arrayContaining([expect.objectContaining({ id: 'target' })]));
    await expect(controller.delegationTargets({ user: { ...user, permissions: [] } }, 'job')).rejects.toThrow('job:delegate');
  });
  it('constrains targets by exact segment, tenant, and another branch', async () => {
    await service.getDelegationTargets(user, 'job', 'tenant');
    expect(prisma.businessUnit.findMany.mock.calls[0][0].where).toEqual({ tenantId: 'tenant', marketSegmentId: 'segment', id: { not: 'source' }, branchId: { not: 'home' }, branch: { tenantId: 'tenant' } });
    expect(prisma.job.findFirst.mock.calls[0][0].where).toEqual({ id: 'job', tenantId: 'tenant' });
  });
  it('rejects foreign source jobs and missing segment configuration', async () => {
    await expect(service.getDelegationTargets({ ...user, branchId: 'foreign' }, 'job', 'tenant')).rejects.toThrow('your branch');
    prisma.job.findFirst.mockResolvedValue({ ...job, businessUnitRef: null });
    await expect(service.getDelegationTargets(user, 'job', 'tenant')).rejects.toThrow('market segment');
    expect(prisma.businessUnit.findMany).not.toHaveBeenCalled();
  });
  it('persists the selected unit and derived branch and refuses a forged selection', async () => {
    const notifications = { broadcastAnnouncement: jest.fn() };
    const jobs = new JobsService(prisma, notifications as any);
    await expect(jobs.delegateJob('job', { targetUnitId: 'foreign' }, 'tenant', 'home', user)).rejects.toThrow('eligible');
    await expect(jobs.delegateJob('job', { targetUnitId: 'target', targetBranchId: 'wrong' }, 'tenant', 'home', user)).rejects.toThrow('selected branch');
    expect(prisma.jobDelegationRequest.create).not.toHaveBeenCalled();
    await jobs.delegateJob('job', { targetUnitId: 'target', targetBranchId: 'away' }, 'tenant', 'home', user);
    expect(prisma.jobDelegationRequest.create.mock.calls[0][0].data).toEqual(expect.objectContaining({ tenantId: 'tenant', sourceUnitId: 'source', targetUnitId: 'target', targetBranchId: 'away' }));
  });
});
