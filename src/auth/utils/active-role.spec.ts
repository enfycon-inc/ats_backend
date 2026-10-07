import { resolveActiveRole } from './active-role';

describe('active role authorization', () => {
  const tenant = 'tenant';
  const unitId = '11111111-1111-4111-8111-111111111111';
  const adminId = '22222222-2222-4222-8222-222222222222';
  const member = { roleId: adminId, assignedRoleIds: [unitId], branchId: 'branch', businessUnitId: 'unit', podId: null };
  const prisma = { user: { findFirst: jest.fn() }, customRole: { findFirst: jest.fn() } };
  const actor = { dbId: 'user', tenantId: tenant, permissions: ['tenant:settings'], roles: ['TENANT_ADMIN'] };
  beforeEach(() => {
    jest.clearAllMocks();
    prisma.user.findFirst.mockResolvedValue(member);
    prisma.customRole.findFirst.mockImplementation(async ({ where }: any) => ({
      id: where.id, name: where.id === unitId ? 'Unit Admin' : 'Tenant Admin',
      permissions: where.id === unitId ? ['unit_admin:manage'] : ['tenant:settings'],
      systemRole: { systemKey: where.id === unitId ? 'UNIT_ADMIN' : 'TENANT_ADMIN' },
    }));
  });
  it('does not retain inactive tenant permissions or role names', async () => {
    const selected = await resolveActiveRole(prisma as any, actor, unitId);
    expect(selected.permissions).toEqual(['unit_admin:manage']);
    expect(selected.roles).toEqual(['UNIT_ADMIN']);
    expect(selected.businessUnitId).toBe('unit');
  });
  it('defaults to the primary assigned role and supports switching back', async () => {
    expect((await resolveActiveRole(prisma as any, actor, undefined)).permissions).toEqual(['tenant:settings']);
    expect((await resolveActiveRole(prisma as any, actor, adminId)).activeRoleId).toBe(adminId);
  });
  it('rejects forged, malformed, revoked, and foreign-tenant roles', async () => {
    await expect(resolveActiveRole(prisma as any, actor, '33333333-3333-4333-8333-333333333333')).rejects.toThrow();
    await expect(resolveActiveRole(prisma as any, actor, ['invalid'])).rejects.toThrow();
    prisma.user.findFirst.mockResolvedValue({ ...member, assignedRoleIds: [] });
    await expect(resolveActiveRole(prisma as any, actor, unitId)).rejects.toThrow();
    prisma.user.findFirst.mockResolvedValue(member);
    prisma.customRole.findFirst.mockResolvedValue(null);
    await expect(resolveActiveRole(prisma as any, actor, unitId)).rejects.toThrow();
  });
  it('rejects a role scoped to a different office assignment', async () => {
    prisma.customRole.findFirst.mockResolvedValue({ id: unitId, permissions: [], branchId: 'other' });
    await expect(resolveActiveRole(prisma as any, actor, unitId)).rejects.toThrow();
  });
  it('grants no permissions to an unassigned member', async () => {
    prisma.user.findFirst.mockResolvedValue({ ...member, roleId: null, assignedRoleIds: [] });
    expect((await resolveActiveRole(prisma as any, actor, undefined)).permissions).toEqual([]);
  });
});
