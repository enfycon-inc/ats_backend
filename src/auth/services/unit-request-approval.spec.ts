import { AuthUserService } from './auth-user.service';

describe('current-unit request review', () => {
  const roleId = 'd7746edf-4e8a-4a9a-866b-7d5b90896003';
  const actor: any = { tenantId: 'tenant', branchId: 'branch', businessUnitId: 'unit', permissions: ['unit_admin:manage', 'user:manage', 'candidate:view'], roles: [] };
  const pending = { tenant_id: 'tenant', branch_id: 'branch', business_unit_id: 'unit', is_approved: false, is_active: true, requested_role: 'Recruiter' };
  function setup(permissions: string[], target = pending) {
    const query = jest.fn(async (sql: string, ...params: any[]) => {
      if (sql.includes('SELECT u.id, u.email, u.full_name')) return { rows: [target] };
      if (sql.includes('cr.permissions')) return { rows: [{ id: roleId, permissions, branch_id: 'branch', business_unit_id: 'unit' }] };
      return { rows: [] };
    });
    const service = new AuthUserService({ query, prisma: { $transaction: async fn => fn({ $queryRawUnsafe: async (sql, ...params) => (await query(sql, ...params)).rows }) } } as any, { checkSeatLimit: jest.fn() } as any, {} as any, {} as any, undefined, { enqueueApproval: jest.fn() } as any);
    return { service, query };
  }
  it('rejects roles with permissions beyond the reviewing manager', async () => {
    const { service, query } = setup(['tenant:manage']);
    await expect(service.approveTenantUser('target', { roleId }, actor)).rejects.toThrow(/cannot grant roles|may assign only Unit Admin/);
    expect(query.mock.calls.some(([sql]) => sql.includes('UPDATE users'))).toBe(false);
  });
  it('rejects a request moved to another unit before review', async () => {
    const { service, query } = setup([], { ...pending, business_unit_id: 'foreign' });
    await expect(service.approveTenantUser('target', { roleId }, actor)).rejects.toThrow('current unit');
    expect(query).toHaveBeenCalledTimes(1);
  });
  it('checks pending status and ownership again when writing approval', async () => {
    const { service, query } = setup(['candidate:view']);
    await expect(service.approveTenantUser('target', { roleId }, actor)).rejects.toThrow('already changed');
    const write = query.mock.calls.find(([sql]) => sql.includes('UPDATE users'))!;
    expect(write[0]).toContain('business_unit_id = $4::uuid AND is_approved = false');
  });
});
