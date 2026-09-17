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
});
