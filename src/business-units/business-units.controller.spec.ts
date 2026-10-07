import { BusinessUnitsController } from './business-units.controller';
describe('Unit Admin management scope', () => {
  const service = { findOne: jest.fn(async (id: string) => ({ id, branchId: id === 'foreign' ? 'other' : 'home' })), findAll: jest.fn(), onboardingOptions: jest.fn().mockResolvedValue([]), update: jest.fn(), remove: jest.fn(), create: jest.fn() };
  const controller = new BusinessUnitsController(service as any);
  const user = { tenantId: 'tenant', branchId: 'home', businessUnitId: 'unit', permissions: ['unit_admin:manage'] };
  beforeEach(() => jest.clearAllMocks());
  it('lists only the assigned unit and denies other branch headers', async () => {
    expect(await controller.findAll({ user })).toEqual([{ id: 'unit', branchId: 'home' }]);
    expect(service.findAll).not.toHaveBeenCalled();
    await expect(controller.findAll({ user }, 'other')).rejects.toThrow();
  });
  it('denies foreign unit reads, updates, moves, and directory mutations', async () => {
    await expect(controller.findOne('another', { user })).rejects.toThrow();
    await expect(controller.update('another', {}, { user })).rejects.toThrow();
    await expect(controller.update('unit', { branchId: 'other' }, { user })).rejects.toThrow();
    await expect(controller.create({ name: 'extra', branchId: 'home' } as any, { user })).rejects.toThrow();
    await expect(controller.remove('unit', { user })).rejects.toThrow();
    expect(service.update).not.toHaveBeenCalled();
    expect(service.remove).not.toHaveBeenCalled();
  });
  it('allows editing the assigned unit with the capability', async () => {
    await controller.update('unit', { name: 'Updated' }, { user });
    expect(service.update).toHaveBeenCalledWith('unit', { name: 'Updated' }, 'tenant');
  });
  it('does not return a tenant-wide directory when assignments are missing', async () => {
    expect(await controller.findAll({ user: { ...user, branchId: null } })).toEqual([]);
    expect(await controller.findAll({ user: { ...user, businessUnitId: null } })).toEqual([]);
    expect(service.findAll).not.toHaveBeenCalled();
  });
  it('restricts the minimal onboarding picker to pending members', async () => {
    await expect(controller.onboardingOptions({ user })).rejects.toThrow();
    expect(await controller.onboardingOptions({ user: { ...user, isApproved: false } })).toEqual([]);
    expect(service.onboardingOptions).toHaveBeenCalledWith('tenant');
  });
});
