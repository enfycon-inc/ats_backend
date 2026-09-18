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
});
