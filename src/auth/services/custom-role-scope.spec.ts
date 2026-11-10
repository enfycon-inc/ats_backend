import { AuthRbacService } from './auth-rbac.service';

describe('unit-scoped role names', () => {
  it('checks the exact unit with normalized names and excludes the edited role', async () => {
    const query = jest.fn().mockResolvedValue({ rows: [] });
    const service = new AuthRbacService({ query } as any);
    await (service as any).assertUniqueRoleName('tenant', ' Account Manager ', 'branch', 'unit', 'role');
    expect(query.mock.calls[0][1]).toEqual(['tenant', 'ACCOUNT MANAGER', 'branch', 'unit', 'role']);
    expect(query.mock.calls[0][0]).toContain('business_unit_id IS NOT DISTINCT FROM $4::uuid');
  });
  it('allows the same name to be created in two units of the same branch', async () => {
    const saved: string[] = [];
    const query = jest.fn(async (sql: string, params: any[]) => {
      if (sql.includes('FROM ats.business_units')) return { rows: [{ id: params[0], branch_id: 'branch' }] };
      if (sql.includes('SELECT cr.id, sr.id')) return { rows: [{ id: 'template', system_role_id: 'system' }] };
      if (sql.includes('SELECT system_key, permissions')) return { rows: [{ system_key: 'ACCOUNT_MANAGER', permissions: ['job:view'] }] };
      if (sql.includes('UPPER(BTRIM(name))')) return { rows: saved.includes(params[3]) ? [{ id: 'duplicate' }] : [] };
      if (sql.includes('INSERT INTO custom_roles')) { saved.push(params[2]); return { rows: [{ id: params[2], name: params[3] }] }; }
      return { rows: [] };
    });
    const service = new AuthRbacService({ query } as any);
    for (const unit of ['unit-a', 'unit-b']) {
      await expect(service.createCustomRole('tenant', 'Account Manager', '', ['job:view'], 'ACCOUNT_MANAGER', 'branch', unit)).resolves.toMatchObject({ id: unit });
    }
    await expect(service.createCustomRole('tenant', ' account manager ', '', ['job:view'], 'ACCOUNT_MANAGER', 'branch', 'unit-a')).rejects.toMatchObject({ status: 409 });
  });
  it('rejects duplicates with a unit-specific message', async () => {
    const service = new AuthRbacService({ query: async () => ({ rows: [{ id: 'duplicate' }] }) } as any);
    await expect((service as any).assertUniqueRoleName('tenant', 'Account Manager', 'branch', 'unit')).rejects.toMatchObject({ status: 409, message: expect.stringContaining('branch unit') });
  });
  it('rejects foreign-tenant units', async () => {
    const service = new AuthRbacService({ query: async () => ({ rows: [] }) } as any);
    await expect((service as any).validateRoleScope('tenant', 'branch', 'unit')).rejects.toMatchObject({ status: 400 });
  });
  it('rejects mismatched branch/unit and unauthorized unit access', async () => {
    const service = new AuthRbacService({ query: async () => ({ rows: [{ id: 'unit', branch_id: 'branch' }] }) } as any);
    await expect((service as any).validateRoleScope('tenant', 'other', 'unit')).rejects.toMatchObject({ status: 400 });
    await expect((service as any).validateRoleScope('tenant', 'branch', 'unit', { branchId: 'branch', businessUnitId: 'other', permissions: ['user:manage'] })).rejects.toMatchObject({ status: 403 });
  });
  it('checks a scope-only update before any mutation', async () => {
    const query = jest.fn(async (sql: string) => {
      if (sql.includes('SELECT cr.id, cr.name')) return { rows: [{ id: 'role', name: 'Account Manager', branch_id: 'branch', business_unit_id: 'unit', system_role: 'ACCOUNT_MANAGER' }] };
      if (sql.includes('FROM ats.business_units')) return { rows: [{ id: 'unit', branch_id: 'branch' }] };
      if (sql.includes('UPPER(BTRIM(name))')) return { rows: [{ id: 'duplicate' }] };
      return { rows: [] };
    });
    const service = new AuthRbacService({ query } as any);
    await expect(service.updateCustomRole('tenant', 'role', { businessUnitId: 'other' })).rejects.toMatchObject({ status: 409 });
    expect(query.mock.calls.some(([sql]) => sql.startsWith('UPDATE'))).toBe(false);
  });
  it('maps concurrent ordinary-role conflicts correctly', () => {
    const service = new AuthRbacService({} as any);
    expect(() => (service as any).rethrowRoleConflict({ meta: { code: '23505' } }, 'unit', false)).toThrow('A custom role with this name already exists in this branch unit.');
  });
});
