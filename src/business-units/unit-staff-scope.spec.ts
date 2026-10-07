import { BusinessUnitsService } from './business-units.service';

describe('unit staff isolation', () => {
  const prisma = { user: { count: jest.fn(), findMany: jest.fn(), updateMany: jest.fn() } };
  const service = new BusinessUnitsService(prisma as any);
  beforeEach(() => jest.clearAllMocks());
  it('rejects foreign staff before any assignment changes', async () => {
    prisma.user.count.mockResolvedValue(0);
    await expect(service.assignMembers('unit', ['foreign-user'], 'tenant', { branchId: 'branch', businessUnitId: 'unit' })).rejects.toThrow();
    expect(prisma.user.updateMany).not.toHaveBeenCalled();
  });
  it('limits selectable staff at the query boundary', async () => {
    const spy = jest.spyOn(service, 'findOne').mockResolvedValue({ id: 'unit', branchId: 'branch' } as any);
    prisma.user.findMany.mockResolvedValue([]);
    await service.getCandidateStaff('unit', 'tenant', { branchId: 'branch', businessUnitId: 'unit' });
    expect(prisma.user.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { tenantId: 'tenant', isActive: true, branchId: 'branch', businessUnitId: 'unit' },
    }));
    spy.mockRestore();
  });
});
