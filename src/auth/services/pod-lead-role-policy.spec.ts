import { rejectManualPodLeadRoles, existingPodLeadRoleIds } from './pod-lead-role-policy';
import { AuthRbacService } from './auth-rbac.service';
import { PodsService } from '../../pods/pods.service';

describe('automatic unit-scoped Pod Lead role', () => {
  it.each(['POD_LEAD', 'Recruitment Captain', 'role-id'])('rejects manual assignment using %s', async identifier => {
    const query = { query: jest.fn().mockResolvedValue({ rows: [{ id: 'lead-role' }] }) };
    await expect(rejectManualPodLeadRoles(query as any, 'tenant', [identifier])).rejects.toMatchObject({ status: 400 });
    expect(query.query.mock.calls[0][1]).toEqual(['tenant', [identifier.toLowerCase()]]);
    expect(query.query.mock.calls[0][0]).toContain("sr.system_key = 'POD_LEAD'");
  });
  it('allows ordinary custom roles and does no lookup for an empty selection', async () => {
    const query = { query: jest.fn().mockResolvedValue({ rows: [] }) };
    await rejectManualPodLeadRoles(query as any, 'tenant', []);
    expect(query.query).not.toHaveBeenCalled();
    await rejectManualPodLeadRoles(query as any, 'tenant', ['recruiter-role']);
    expect(query.query).toHaveBeenCalledTimes(1);
  });
  it('preserves automatic grants only for actual tenant pod heads', async () => {
    const query = { query: jest.fn().mockResolvedValue({ rows: [{ id: 'lead-role' }] }) };
    expect(await existingPodLeadRoleIds(query as any, 'tenant', 'user')).toEqual(['lead-role']);
    expect(query.query.mock.calls[0][0]).toContain('p.pod_head_id = u.id');
    expect(query.query.mock.calls[0][1]).toEqual(['user', 'tenant']);
  });
  it('excludes both system and custom Pod Lead roles from assignable roles', async () => {
    const service = new AuthRbacService({} as any);
    jest.spyOn(service, 'listRoles').mockResolvedValue([
      { id: 'system', name: 'Pod Lead', isSystem: true, systemRole: 'POD_LEAD' },
      { id: 'custom', name: 'Recruitment Captain', isSystem: false, systemRole: 'POD_LEAD' },
      { id: 'recruiter', name: 'Talent Partner', isSystem: false, systemRole: 'RECRUITER' },
    ] as any);
    expect((await service.getAssignableRolePool('tenant')).map(role => role.id)).toEqual(['recruiter']);
  });
  it.each(['assignUserRoles', 'batchAssignUsersToRole', 'unassignUserFromRole'])('blocks manual %s before any user mutation', async method => {
    const query = { query: jest.fn().mockResolvedValue({ rows: [{ id: 'lead-role' }] }) };
    const service = new AuthRbacService(query as any);
    const call = method === 'assignUserRoles'
      ? service.assignUserRoles('tenant', 'user', ['lead-role'], [])
      : method === 'batchAssignUsersToRole' ? service.batchAssignUsersToRole('tenant', 'lead-role', ['user'], [])
      : service.unassignUserFromRole('tenant', 'lead-role', 'user');
    await expect(call).rejects.toMatchObject({ status: 400 });
    expect(query.query).toHaveBeenCalledTimes(1);
  });
  it('chooses the custom role for the pod unit and retains existing role grants', async () => {
    const db = {
      customRole: { findMany: jest.fn().mockResolvedValue([{ id: 'custom-lead', name: 'Recruitment Captain', businessUnitId: 'unit-a' }]), findFirst: jest.fn() },
      user: { findFirst: jest.fn().mockResolvedValue({ roleId: 'original', assignedRoleIds: ['secondary'] }), update: jest.fn() },
    };
    const service = new PodsService(db as any);
    await (service as any).promoteToPodHead('user', 'tenant', 'unit-a');
    expect(db.customRole.findFirst).not.toHaveBeenCalled();
    expect(db.customRole.findMany.mock.calls[0][0].where).toEqual({ tenantId: 'tenant', businessUnitId: 'unit-a', isSystem: false, systemRole: { systemKey: 'POD_LEAD' } });
    expect(db.user.update).toHaveBeenCalledWith({ where: { id: 'user' }, data: { roleId: 'custom-lead', assignedRoleIds: ['original', 'secondary', 'custom-lead'] } });
  });
  it('fails closed on existing duplicate custom roles', async () => {
    const db = { customRole: { findMany: jest.fn().mockResolvedValue([{ id: 'a' }, { id: 'b' }]) }, user: { update: jest.fn() } };
    await expect((new PodsService(db as any) as any).promoteToPodHead('user', 'tenant', 'unit-a')).rejects.toMatchObject({ status: 409 });
    expect(db.user.update).not.toHaveBeenCalled();
  });
  it('removes only leadership and restores the original non-Recruiter role', async () => {
    const db = {
      pod: { findFirst: jest.fn().mockResolvedValue(null) },
      customRole: { findMany: jest.fn().mockResolvedValue([{ id: 'lead-role' }]) },
      user: { findFirst: jest.fn().mockResolvedValue({ roleId: 'lead-role', assignedRoleIds: ['account-manager', 'secondary', 'lead-role'] }), update: jest.fn() },
    };
    await (new PodsService(db as any) as any).demoteFromPodHead('user', 'tenant');
    expect(db.user.update).toHaveBeenCalledWith({ where: { id: 'user' }, data: { roleId: 'account-manager', assignedRoleIds: ['account-manager', 'secondary'] } });
  });
  function customRoleCreation(duplicate = false) {
    const tx = {
      $queryRawUnsafe: jest.fn().mockImplementation(async (sql: string) => {
        if (!sql.includes('INSERT INTO')) return [];
        if (duplicate) throw { meta: { code: '23505' } };
        return [{ id: 'custom-lead', name: 'Recruitment Captain' }];
      }),
      $executeRawUnsafe: jest.fn(),
    };
    const query = jest.fn(async (sql: string) => {
      if (sql.includes('SELECT cr.id, sr.id')) return { rows: [{ id: 'template', system_role_id: 'system-id' }] };
      if (sql === 'SELECT system_key, permissions FROM system_roles') return { rows: [{ system_key: 'POD_LEAD', permissions: ['pod:view', 'job:assign_recruiter'] }] };
      if (sql.includes('FROM ats.business_units')) return { rows: [{ id: 'unit-a', branch_id: 'branch-a' }] };
      return { rows: [] };
    });
    const service = new AuthRbacService({ query, prisma: { $transaction: async (fn: any) => fn(tx) } } as any);
    return { service, tx };
  }
  it('creates a unit-scoped custom name and adopts only current pod heads in that unit', async () => {
    const { service, tx } = customRoleCreation();
    const role = await service.createCustomRole('tenant', 'Recruitment Captain', '', ['pod:view'], 'POD_LEAD', 'branch-a', 'unit-a', undefined, undefined, { permissions: ['tenant:settings'] } as any);
    expect(role.name).toBe('Recruitment Captain');
    expect(tx.$queryRawUnsafe.mock.calls.find(([sql]) => sql.includes('INSERT INTO'))!.slice(1, 4)).toEqual(['tenant', 'branch-a', 'unit-a']);
    expect(tx.$queryRawUnsafe.mock.calls[0][0]).toContain('pg_advisory_xact_lock');
    expect(tx.$executeRawUnsafe.mock.calls[0][0]).toContain('p.business_unit_id=$3::uuid');
    expect(tx.$executeRawUnsafe.mock.calls[0].slice(1)).toEqual(['tenant', 'custom-lead', 'unit-a']);
  });
  it('turns a database singleton conflict into a useful 409 and makes no user changes', async () => {
    const { service, tx } = customRoleCreation(true);
    await expect(service.createCustomRole('tenant', 'Second name', '', ['pod:view'], 'POD_LEAD', 'branch-a', 'unit-a')).rejects.toMatchObject({ status: 409 });
    expect(tx.$executeRawUnsafe).not.toHaveBeenCalled();
  });
  it('prevents branch-scoped managers from creating a unit-scoped leadership role', async () => {
    const { service, tx } = customRoleCreation();
    await expect(service.createCustomRole('tenant', 'Team Lead', '', [], 'POD_LEAD', 'branch-a', 'unit-a', undefined, undefined, { permissions: ['user:manage', 'branch_admin:manage'] } as any)).rejects.toMatchObject({ status: 403 });
    expect(tx.$queryRawUnsafe).not.toHaveBeenCalled();
  });

  it('rejects a second role for the same unit at the application boundary before migration', async () => {
    const { service, tx } = customRoleCreation();
    tx.$queryRawUnsafe.mockImplementation(async (sql: string) => sql.includes('SELECT cr.id FROM ats.custom_roles') ? [{ id: 'existing-custom' }] : []);
    await expect(service.createCustomRole('tenant', 'Second name', '', ['pod:view'], 'POD_LEAD', 'branch-a', 'unit-a', undefined, undefined, { permissions: ['tenant:settings'] } as any)).rejects.toMatchObject({ status: 409 });
    expect(tx.$queryRawUnsafe.mock.calls.some(([sql]) => sql.includes('INSERT INTO'))).toBe(false);
    expect(tx.$executeRawUnsafe).not.toHaveBeenCalled();
  });

  it('does not grant a legacy branch-scoped leadership role across tenant units', async () => {
    const db = { customRole: { findMany: jest.fn().mockResolvedValue([{ id: 'legacy', branchId: 'other-branch' }]) }, user: { update: jest.fn() } };
    await expect((new PodsService(db as any) as any).promoteToPodHead('user', 'tenant')).rejects.toMatchObject({ status: 400 });
    expect(db.user.update).not.toHaveBeenCalled();
  });

});
