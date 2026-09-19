import { BranchesController } from './branches.controller';

describe('branch settings isolation', () => {
  const user = { tenantId: 'tenant', branchId: 'home', roles: [], permissions: ['branch_admin:manage', 'job:delegate'] };
  const service = {
    findOne: jest.fn().mockResolvedValue({ id: 'home' }),
    findAll: jest.fn().mockResolvedValue([]),
    getMembers: jest.fn(), getHierarchy: jest.fn(), update: jest.fn(),
    getDelegationTargets: jest.fn().mockResolvedValue([{ id: 'other', name: 'Other branch' }]),
  };
  const controller = new BranchesController(service as any);
  beforeEach(() => jest.clearAllMocks());

  it('returns only the assigned branch without loading the tenant directory', async () => {
    expect(await controller.findAll({ user })).toEqual([{ id: 'home' }]);
    expect(service.findAll).not.toHaveBeenCalled();
  });
  it('rejects direct reads, staff reads, and updates of another branch', async () => {
    await expect(controller.findOne('other', { user })).rejects.toThrow();
    await expect(controller.getMembers('other', { user })).rejects.toThrow();
    await expect(controller.update('other', {}, { user })).rejects.toThrow();
    expect(service.update).not.toHaveBeenCalled();
    expect(service.getMembers).not.toHaveBeenCalled();
  });
  it('denies directory hierarchy to branch-scoped users', async () => {
    await expect(controller.getHierarchy({ user })).rejects.toThrow();
    expect(service.getHierarchy).not.toHaveBeenCalled();
  });
  it('returns no directory for a user without an assigned branch', async () => {
    expect(await controller.findAll({ user: { ...user, branchId: null } })).toEqual([]);
  });
  it('keeps tenant directory access for a tenant administration capability', async () => {
    await controller.findAll({ user: { ...user, permissions: ['tenant:settings'] } });
    expect(service.findAll).toHaveBeenCalledWith('tenant');
  });
  it('keeps delegation target selection separate and capability protected', async () => {
    expect(await controller.delegationTargets({ user })).toEqual([{ id: 'other', name: 'Other branch' }]);
    await expect(controller.delegationTargets({ user: { ...user, permissions: [] } })).rejects.toThrow();
  });
});
