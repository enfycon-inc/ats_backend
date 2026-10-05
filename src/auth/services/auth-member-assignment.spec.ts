import { AuthUserService } from './auth-user.service';

describe('member assignment updates', () => {
  const id = '11111111-1111-4111-8111-111111111111';
  const branch = '22222222-2222-4222-8222-222222222222';
  const role = '33333333-3333-4333-8333-333333333333';
  function setup(empty = false) {
    const user = { id, tenant_id: id, email: 'member@example.com', first_name: 'Member', last_name: 'One', full_name: 'Member One', branch_id: empty ? null : branch, business_unit_id: empty ? null : id, job_reviewer_id: null, role_id: role, assigned_role_ids: [role] };
    const query = jest.fn(async (sql: string, _params?: any[]) => {
      if (sql.startsWith('SELECT * FROM users')) return { rows: [user] };
      if (sql.includes('FROM custom_roles cr')) return { rows: [{ id: role, name: 'Delivery Head', permissions: ['job:view'] }] };
      if (sql.startsWith('UPDATE users')) {
        if (!sql.includes('branch_id = $5::uuid') || !sql.includes('business_unit_id = $6::uuid')) throw new Error('UUID fields cannot accept text');
      }
      return { rows: [] };
    });
    const service = new AuthUserService({ query } as any, { verifyLastAdminProtection: jest.fn() } as any, {} as any);
    jest.spyOn(service, 'getProfile').mockResolvedValue({ id } as any);
    return { service, query, requester: { tenantId: id, permissions: ['user:manage', 'tenant:settings'] } };
  }
  it('saves custom roles with typed branch and unit parameters', async () => {
    const { service, query, requester } = setup();
    await service.updateUserDetails(id, { assignedRoleIds: [role], roleId: role }, requester);
    const update = query.mock.calls.find(([sql]) => sql.startsWith('UPDATE users'))!;
    expect(update[1]?.slice(4, 9)).toEqual([branch, id, null, role, [role]]);
  });
  it.each([id, null])('assigns or resets manager %s without changing roles or branch', async manager => {
    const { service, query, requester } = setup();
    await service.updateUserDetails(id, { jobReviewerId: manager }, requester);
    expect(query.mock.calls.find(([sql]) => sql.startsWith('UPDATE users'))?.[1]?.slice(4, 9)).toEqual([branch, id, manager, role, [role]]);
  });
  it('supports users without a branch or unit', async () => {
    const { service, query, requester } = setup(true);
    await service.updateUserDetails(id, { jobReviewerId: id }, requester);
    expect(query.mock.calls.find(([sql]) => sql.startsWith('UPDATE users'))?.[1]?.slice(4, 6)).toEqual([null, null]);
  });
  it.each(['branchId', 'businessUnitId', 'jobReviewerId'])('rejects malformed %s before database work', async field => {
    const { service, query, requester } = setup();
    await expect(service.updateUserDetails(id, { [field]: 'not-an-id' }, requester)).rejects.toMatchObject({ status: 400 });
    expect(query).not.toHaveBeenCalled();
  });
  it('rejects cross-tenant changes', async () => {
    const { service, query } = setup();
    await expect(service.updateUserDetails(id, { jobReviewerId: id }, { tenantId: branch })).rejects.toMatchObject({ status: 403 });
    expect(query.mock.calls.some(([sql]) => sql.startsWith('UPDATE users'))).toBe(false);
  });
});
