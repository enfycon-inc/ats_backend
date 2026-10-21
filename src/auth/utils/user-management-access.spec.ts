import { AuthUserService } from '../services/auth-user.service';
import { AuthPasswordService } from '../services/auth-password.service';
import { userManagementActions } from '../user-management-policy';

describe('staff management scope and peer access', () => {
  const id = '11111111-1111-4111-8111-111111111111';
  const roleId = '22222222-2222-4222-8222-222222222222';
  const member = {
    id,
    tenant_id: 'tenant',
    branch_id: 'branch',
    business_unit_id: 'unit',
    email: 'staff@example.com',
    full_name: 'Staff',
    role_id: roleId,
    assigned_role_ids: [roleId],
    is_active: true,
    is_approved: true,
    management_permissions: ['user:manage', 'unit_admin:manage', 'job:approve'],
  };
  const actor: any = {
    dbId: 'actor',
    tenantId: 'tenant',
    branchId: 'branch',
    businessUnitId: 'unit',
    systemRole: 'UNIT_ADMIN',
    roles: ['UNIT_ADMIN'],
    permissions: ['user:manage', 'unit_admin:manage', 'job:approve'],
  };
  function setup(target: any = member) {
    const query = jest.fn(async (sql: string) => {
      if (sql.startsWith('SELECT')) return { rows: [target] };
      return { rows: [] };
    });
    const keycloak = {
      setKeycloakUserStatus: jest.fn().mockResolvedValue(undefined),
    };
    const service = new AuthUserService(
      { query } as any,
      { verifyLastAdminProtection: jest.fn() } as any,
      keycloak as any,
    );
    jest.spyOn(service, 'getProfile').mockResolvedValue({ id } as any);
    return { service, query, keycloak };
  }
  it.each(['UNIT_ADMIN', 'DELIVERY_HEAD'])(
    'allows %s to edit a same-unit multi-role member without changing assignments',
    async (systemRole) => {
      const { service, query } = setup();
      await service.updateUserDetails(
        id,
        { city: 'BBSR' },
        { ...actor, systemRole, roles: [systemRole] },
      );
      const write = query.mock.calls.find(([sql]) =>
        sql.startsWith('UPDATE users'),
      )!;
      expect(write).toBeDefined();
      expect(
        query.mock.calls.some(([sql]) => sql.includes('SELECT cr.id, cr.name')),
      ).toBe(false);
    },
  );
  it.each([
    { ...member, tenant_id: 'foreign' },
    { ...member, branch_id: 'foreign' },
    { ...member, business_unit_id: 'foreign' },
    { ...member, management_permissions: ['tenant:settings'] },
    { ...member, management_permissions: ['branch_admin:manage'] },
  ])(
    'blocks direct profile and status mutations outside the allowed scope or for higher administrative accounts',
    async (target) => {
      const { service, query, keycloak } = setup(target);
      await expect(
        service.updateUserDetails(id, { city: 'BBSR' }, actor),
      ).rejects.toMatchObject({ status: 403 });
      await expect(
        service.setUserActive(id, false, actor.dbId, actor),
      ).rejects.toMatchObject({ status: 403 });
      expect(query.mock.calls.some(([sql]) => sql.startsWith('UPDATE'))).toBe(
        false,
      );
      expect(keycloak.setKeycloakUserStatus).not.toHaveBeenCalled();
    },
  );
  it('blocks moving a manageable member into a different unit', async () => {
    const { service, query } = setup();
    await expect(
      service.updateUserDetails(id, { businessUnitId: roleId }, actor),
    ).rejects.toMatchObject({ status: 403 });
    expect(query.mock.calls.some(([sql]) => sql.startsWith('UPDATE'))).toBe(
      false,
    );
  });
  it('blocks reset-link emails before token creation for another unit', async () => {
    const { query } = setup({ ...member, business_unit_id: 'foreign' });
    const email = { sendPasswordResetEmail: jest.fn() };
    const service = new AuthPasswordService(
      { query } as any,
      {} as any,
      email as any,
    );
    await expect(service.adminSendResetLink(id, actor)).rejects.toMatchObject({
      status: 403,
    });
    expect(query).toHaveBeenCalledTimes(1);
    expect(email.sendPasswordResetEmail).not.toHaveBeenCalled();
  });
  it('validates every member before a batch manager assignment', async () => {
    const { service, query } = setup({
      ...member,
      tenant_id: id,
      business_unit_id: 'foreign',
    });
    await expect(
      service.bulkSetJobReviewer(id, [id], null, { ...actor, tenantId: id }),
    ).rejects.toMatchObject({ status: 403 });
    expect(query.mock.calls.some(([sql]) => sql.startsWith('UPDATE'))).toBe(
      false,
    );
  });
  it('rejects an out-of-unit manager even when the member being edited is in scope', async () => {
    const { service, query } = setup();
    query.mockImplementation(async (sql) => ({
      rows: [
        sql.startsWith('SELECT users.*')
          ? member
          : { ...member, id: roleId, business_unit_id: 'foreign' },
      ],
    }));
    await expect(
      service.updateUserDetails(id, { jobReviewerId: roleId }, actor),
    ).rejects.toMatchObject({ status: 403 });
    expect(query.mock.calls.some(([sql]) => sql.startsWith('UPDATE'))).toBe(
      false,
    );
  });
  it('separates self-management, staff management and permanent deletion', () => {
    const target = {
      id,
      tenantId: 'tenant',
      branchId: 'branch',
      businessUnitId: 'unit',
      permissions: member.management_permissions,
    };
    const actions = userManagementActions(actor, target);
    expect(actions.editProfile).toBe(true);
    expect(actions.changeStatus).toBe(true);
    expect(actions.deleteUser).toBe(false);
    expect(
      userManagementActions({ ...actor, dbId: id }, target).changeStatus,
    ).toBe(false);
    expect(
      userManagementActions({ ...actor, permissions: [] }, target).editProfile,
    ).toBe(false);
  });
});
