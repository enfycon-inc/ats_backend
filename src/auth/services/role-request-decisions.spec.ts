import { AuthUserService } from './auth-user.service';

describe('versioned role request decisions', () => {
  const id = '11111111-1111-4111-8111-111111111111';
  const roleId = '22222222-2222-4222-8222-222222222222';
  const version = '44444444-4444-4444-8444-444444444444';
  const target = {
    id,
    tenant_id: 'tenant',
    branch_id: 'branch',
    business_unit_id: 'unit',
    email: 'member@example.com',
    full_name: 'Member',
    requested_role: roleId,
    role_request_version: version,
    is_approved: false,
    is_active: true,
  };
  const actor: any = {
    dbId: 'reviewer',
    tenantId: 'tenant',
    permissions: ['user:manage', 'tenant:manage'],
    roles: [],
    email: 'reviewer@example.com',
  };
  function setup(user: any = target) {
    const query = jest.fn(async (sql: string, ...params: any[]) => {
      if (sql.includes('UPDATE users')) return { rows: [{ id }] };
      if (
        sql.includes('SELECT u.id, u.email') ||
        sql.includes('SELECT id, email, full_name')
      )
        return { rows: [user] };
      if (sql.includes('permissions'))
        return { rows: [{ id: roleId, permissions: [], name: 'Recruiter' }] };
      return { rows: [] };
    });
    const mail = {
      sendRoleApprovalWelcomeEmail: jest
        .fn()
        .mockResolvedValue({ status: 'accepted' }),
    };
    const review = jest.fn().mockResolvedValue({});
    const enqueueApproval = jest.fn();
    const service = new AuthUserService(
      { query, prisma: { $transaction: async fn => fn({ $queryRawUnsafe: async (sql, ...params) => (await query(sql, ...params)).rows }) } } as any,
      { checkSeatLimit: jest.fn() } as any,
      {
        provisionUserInKeycloak: jest.fn().mockResolvedValue(undefined),
        setKeycloakUserStatus: jest.fn().mockResolvedValue(undefined),
      } as any,
      mail as any,
      undefined,
      { review, enqueueApproval } as any,
    );
    return { service, query, mail, review, enqueueApproval };
  }
  it.each(['missing', 'replaced'])(
    'rejects %s request versions before writing approval',
    async (mode) => {
      const { service, query } = setup();
      await expect(
        service.approveTenantUser(
          id,
          {
            roleId,
            expectedRequestVersion: mode === 'missing' ? undefined : 'old',
          },
          actor,
        ),
      ).rejects.toThrow('handled or replaced');
      expect(
        query.mock.calls.some(([sql]) => sql.includes('UPDATE users')),
      ).toBe(false);
    },
  );
  it('consumes approval exactly once and sends no second welcome email under competing decisions', async () => {
    const { service, query, mail, enqueueApproval } = setup();
    let writes = 0;
    const original = query.getMockImplementation()!;
    query.mockImplementation(async (sql) =>
      sql.includes('UPDATE users')
        ? { rows: ++writes === 1 ? [{ id }] : [] }
        : original(sql),
    );
    const results = await Promise.allSettled(
      [1, 2].map(() =>
        service.approveTenantUser(
          id,
          { roleId, expectedRequestVersion: version },
          actor,
        ),
      ),
    );
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);
    expect(enqueueApproval).toHaveBeenCalledTimes(1);
    expect(mail.sendRoleApprovalWelcomeEmail).not.toHaveBeenCalled();
    const write = query.mock.calls.find(([sql]) =>
      sql.includes('UPDATE users'),
    )!;
    expect(write[0]).toContain(
      'role_request_version IS NOT DISTINCT FROM $9::uuid',
    );
    expect(write[0]).toContain('branch_id IS NOT DISTINCT FROM $10::uuid');
    expect(write[0]).toContain('role_request_version = NULL');
  });
  it('refuses stale rejection without deactivating the user', async () => {
    const { service, query } = setup();
    await expect(service.rejectTenantUser(id, actor, 'old')).rejects.toThrow(
      'handled or replaced',
    );
    expect(query.mock.calls.some(([sql]) => sql.includes('UPDATE users'))).toBe(
      false,
    );
  });
  it('rechecks reviewer eligibility and request ownership before rejection', async () => {
    const { service, query, review } = setup();
    await service.rejectTenantUser(id, actor, version);
    expect(review).toHaveBeenCalledWith(id, version, actor);
    const write = query.mock.calls.find(([sql]) =>
      sql.includes('UPDATE users'),
    )!;
    expect(write[0]).toContain(
      'role_request_version IS NOT DISTINCT FROM $7::uuid',
    );
    expect(write[0]).toContain('branch_id IS NOT DISTINCT FROM $9::uuid');
  });
  it.each(['approve', 'reject'])(
    'does not reuse an old link to %s a previously handled request',
    async (action) => {
      const { service } = setup({
        ...target,
        requested_role: null,
        role_request_version: null,
      });
      await expect(
        action === 'approve'
          ? service.approveTenantUser(
              id,
              { roleId, expectedRequestVersion: version },
              actor,
            )
          : service.rejectTenantUser(id, actor, version),
      ).rejects.toThrow('already been handled');
    },
  );
  it('rejects self-approval and foreign-tenant review', async () => {
    const { service } = setup();
    for (const reviewer of [
      { ...actor, dbId: id },
      { ...actor, tenantId: 'foreign' },
    ]) {
      await expect(
        service.approveTenantUser(
          id,
          { roleId, expectedRequestVersion: version },
          reviewer,
        ),
      ).rejects.toThrow('approval scope');
    }
  });
});
