import { AuthUserService } from './auth-user.service';

describe('member role replacement', () => {
  const bdm = 'd7746edf-4e8a-4a9a-866b-7d5b90896003';
  const admin = '27d2659a-76de-4160-832e-a8bc60a6b6fa';
  const head = '6c76b41d-12a6-4c09-b750-20482c2a6ee6';
  const userId = 'f8bdcd3f-c327-46ea-a277-678e812d5c74';
  const tenantId = '737f666b-916a-4e9c-91bd-b2bd37e475d1';
  const branchId = '01141515-78b4-4384-99c3-3dc7ffea4492';
  let query: jest.Mock;
  let service: AuthUserService;
  let protection: jest.Mock;
  const requester = { tenantId, branchId, roles: [], permissions: ['user:manage', 'branch_admin:manage'] };

  beforeEach(() => {
    query = jest.fn().mockResolvedValue({ rows: [] });
    query.mockResolvedValueOnce({ rows: [{ id: userId, tenant_id: tenantId, branch_id: branchId,
      email: 'am@deb.com', full_name: 'Account Manager', role_id: admin, assigned_role_ids: [admin, head, bdm] }] });
    protection = jest.fn().mockResolvedValue(undefined);
    service = new AuthUserService({ query } as any, { verifyLastAdminProtection: protection } as any, {} as any);
    jest.spyOn(service, 'getProfile').mockResolvedValue({ id: userId } as any);
  });

  const writes = () => query.mock.calls.filter(([sql]) => /^UPDATE users SET first_name/.test(sql.trim()));

  it('replaces all removed roles and primary role with the selected ID in one write', async () => {
    query.mockResolvedValueOnce({ rows: [{ id: bdm, name: 'BDM', branch_id: branchId, system_role: 'ACCOUNT_MANAGER' }] });
    await service.updateUserDetails(userId, { assignedRoleIds: [bdm] }, requester);
    expect(writes()).toHaveLength(1);
    expect(writes()[0][1].slice(7, 9)).toEqual([bdm, [bdm]]);
    expect(protection).toHaveBeenCalled();
  });

  it('does not re-add a stale primary role or legacy roles to an explicit selection', async () => {
    query.mockResolvedValueOnce({ rows: [{ id: bdm, name: 'BDM', branch_id: branchId, system_role: 'ACCOUNT_MANAGER' }] });
    await expect(service.updateUserDetails(userId, { assignedRoleIds: [bdm], roleId: admin, roles: ['Branch Admin'] }, requester)).rejects.toThrow();
    expect(writes()).toHaveLength(0);
  });

  it('rejects an unknown or another-tenant role before any update', async () => {
    await expect(service.updateUserDetails(userId, { assignedRoleIds: [bdm] }, requester)).rejects.toThrow();
    expect(writes()).toHaveLength(0);
  });

  it('clears both role columns for an explicitly empty selection', async () => {
    await service.updateUserDetails(userId, { assignedRoleIds: [] }, requester);
    expect(writes()[0][1].slice(7, 9)).toEqual([null, []]);
    expect(protection).toHaveBeenCalled();
  });

  it('preserves roles when only profile details change', async () => {
    await service.updateUserDetails(userId, { fullName: 'Updated Name' }, requester);
    expect(writes()[0][1].slice(7, 9)).toEqual([admin, [admin, head, bdm]]);
    expect(protection).not.toHaveBeenCalled();
  });

  it('assigns tenant, branch and unit administration together while preserving staffing scope', async () => {
    const unitId = 'cc920277-98c9-4b0f-a69b-22e8029a2100';
    query.mockReset();
    query.mockResolvedValueOnce({ rows: [{ id: userId, tenant_id: tenantId, branch_id: branchId,
      business_unit_id: unitId, email: 'member@example.com', role_id: bdm, assigned_role_ids: [bdm] }] });
    query.mockImplementation(async (sql, params) => {
      if (sql.includes('FROM custom_roles')) return { rows: params[3] === branchId ? [
        { id: bdm, name: 'BDM', permissions: [], branch_id: branchId },
        { id: admin, name: 'Tenant Admin', permissions: ['tenant:settings'] },
        { id: head, name: 'Branch and Unit Admin', permissions: ['branch_admin:manage', 'unit_admin:manage'] },
      ] : [] };
      return { rows: [] };
    });
    await service.updateUserDetails(userId, { branchId, businessUnitId: unitId, assignedRoleIds: [bdm, admin, head] },
      { ...requester, permissions: ['user:manage', 'tenant:settings'] });
    expect(writes()[0][1].slice(4, 6)).toEqual([branchId, unitId]);
    expect(writes()[0][1].slice(7, 9)).toEqual([bdm, [bdm, admin, head]]);
    expect(protection).not.toHaveBeenCalled();
  });

  it('rejects moving an existing member while assigning branch administration', async () => {
    query.mockResolvedValueOnce({ rows: [{ id: admin, name: 'Branch Admin', permissions: ['branch_admin:manage'] }] });
    await expect(service.updateUserDetails(userId, { branchId: tenantId, assignedRoleIds: [admin] },
      { ...requester, permissions: ['tenant:settings'] })).rejects.toThrow('existing branch');
    expect(writes()).toHaveLength(0);
  });

  it('rejects clearing an existing unit while assigning unit administration', async () => {
    query.mockReset();
    query.mockResolvedValueOnce({ rows: [{ id: userId, tenant_id: tenantId, branch_id: branchId, business_unit_id: branchId }] });
    query.mockResolvedValueOnce({ rows: [{ id: admin, name: 'Unit Admin', permissions: ['unit_admin:manage'] }] });
    await expect(service.updateUserDetails(userId, { businessUnitId: '', assignedRoleIds: [admin] }, requester))
      .rejects.toThrow('existing branch unit');
    expect(writes()).toHaveLength(0);
  });
});

describe('assigned member role metadata', () => {
  it('returns every exact assigned role including roles hidden from the selectable catalog', async () => {
    const query = jest.fn()
      .mockResolvedValueOnce({ rows: [{ id: 'user', role_id: 'tenant', assigned_role_ids: ['tenant', 'unit'], full_name: 'Member' }] })
      .mockResolvedValueOnce({ rows: [
        { id: 'tenant', name: 'TENANT_ADMIN', is_system: true, system_role: 'TENANT_ADMIN', branch_id: null },
        { id: 'unit', name: 'Unit Admin', is_system: true, system_role: 'UNIT_ADMIN', branch_id: null },
      ] })
      .mockResolvedValueOnce({ rows: [] });
    const service = new AuthUserService({ query } as any, {} as any, {} as any);
    const users = await service.listUsers('tenant-id');
    expect(users[0].assignedRoles.map(role => [role.id, role.systemRole])).toEqual([['tenant', 'TENANT_ADMIN'], ['unit', 'UNIT_ADMIN']]);
  });
});
