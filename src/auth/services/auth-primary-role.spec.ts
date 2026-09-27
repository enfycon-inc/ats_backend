import { AuthUserService } from './auth-user.service';

describe('configured primary dashboard role', () => {
  it('returns the configured BDM role even when Branch Admin is also assigned', async () => {
    const query = jest.fn()
      .mockResolvedValueOnce({ rows: [{ id: 'user', tenant_id: 'tenant', role_id: 'bdm', assigned_role_ids: ['admin', 'bdm'] }] })
      .mockResolvedValueOnce({ rows: [
        { id: 'admin', name: 'Branch Admin', system_role: 'BRANCH_ADMIN' },
        { id: 'bdm', name: 'BDM', system_role: 'ACCOUNT_MANAGER' },
      ] })
      .mockResolvedValueOnce({ rows: [
        { role_id: 'admin', permissions: ['user:manage'] },
        { role_id: 'bdm', permissions: ['client:view'] },
      ] });
    const service = new AuthUserService({ query } as any, {} as any, {} as any);
    const profile = await service.getProfile('user');
    expect(profile.roleId).toBe('bdm');
    expect(profile.roleName).toBe('BDM');
    expect(profile.systemRole).toBe('ACCOUNT_MANAGER');
    expect(profile.permissions).toEqual(expect.arrayContaining(['user:manage', 'client:view']));
  });

  it('returns every assigned role by ID with its inherited archetype and exact permissions', async () => {
    const query = jest.fn()
      .mockResolvedValueOnce({ rows: [{ id: 'user', tenant_id: 'tenant', role_id: 'tenant-admin', assigned_role_ids: ['north', 'south', 'empty'] }] })
      .mockResolvedValueOnce({ rows: [
        { id: 'tenant-admin', name: 'Workspace Admin', system_role: 'TENANT_ADMIN', is_system: true, branch_id: null },
        { id: 'north', name: 'Regional Lead', system_role: 'DELIVERY_HEAD', is_system: false, branch_id: 'north-branch' },
        { id: 'south', name: 'Regional Lead', system_role: 'ACCOUNT_MANAGER', is_system: false, branch_id: 'south-branch' },
        { id: 'empty', name: 'Limited Admin', system_role: 'BRANCH_ADMIN', is_system: false, branch_id: 'north-branch' },
        { id: 'unassigned', name: 'Other Admin', system_role: 'TENANT_ADMIN', is_system: false },
      ] })
      .mockResolvedValueOnce({ rows: [
        { role_id: 'tenant-admin', permissions: ['tenant:settings'] },
        { role_id: 'north', permissions: ['job:view'] },
        { role_id: 'south', permissions: '["client:view"]' },
        { role_id: 'empty', permissions: [] },
        { role_id: 'unassigned', permissions: ['tenant:manage'] },
      ] });
    const rbacService = { listRoles: jest.fn().mockResolvedValue([]) };
    const service = new AuthUserService({ query } as any, rbacService as any, {} as any);
    const profile = await service.getProfile('user');

    expect(profile).toHaveProperty('assignedRoles', [
      expect.objectContaining({ id: 'tenant-admin', name: 'Workspace Admin', systemRole: 'TENANT_ADMIN', isSystem: true, permissions: ['tenant:settings'] }),
      expect.objectContaining({ id: 'north', name: 'Regional Lead', systemRole: 'DELIVERY_HEAD', branchId: 'north-branch', isSystem: false, permissions: ['job:view'] }),
      expect.objectContaining({ id: 'south', name: 'Regional Lead', systemRole: 'ACCOUNT_MANAGER', branchId: 'south-branch', isSystem: false, permissions: ['client:view'] }),
      expect.objectContaining({ id: 'empty', name: 'Limited Admin', systemRole: 'BRANCH_ADMIN', isSystem: false, permissions: [] }),
    ]);
    expect(profile.permissions).toEqual(['tenant:settings', 'job:view', 'client:view']);
    expect(rbacService.listRoles).not.toHaveBeenCalled();
  });

  it('rejects a failed permission lookup instead of returning an apparently valid empty-permission profile', async () => {
    const failure = new Error('temporary database failure');
    const query = jest.fn()
      .mockResolvedValueOnce({ rows: [{ id: 'user', tenant_id: 'tenant', role_id: 'admin', assigned_role_ids: ['admin'] }] })
      .mockResolvedValueOnce({ rows: [{ id: 'admin', name: 'Admin', system_role: 'TENANT_ADMIN' }] })
      .mockRejectedValueOnce(failure);
    const service = new AuthUserService({ query } as any, {} as any, {} as any);

    await expect(service.getProfile('user')).rejects.toBe(failure);
  });
});
