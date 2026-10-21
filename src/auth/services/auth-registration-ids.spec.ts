import { AuthCoreService } from './auth-core.service';
import { AuthUserService } from './auth-user.service';

describe('account creation IDs', () => {
  const id = '11111111-1111-4111-8111-111111111111';
  const branch = '22222222-2222-4222-8222-222222222222';
  function setup(unitFound = true) {
    const query = jest.fn(async (sql: string, params: any[]) => {
      if (sql.includes('FROM business_units')) return { rows: unitFound ? [{ id }] : [] };
      if (sql.includes('FROM custom_roles')) return { rows: [{ id, name: 'BDM' }] };
      if (sql.includes('INSERT INTO users')) {
        return { rows: [{ id, email: params[1], full_name: params[4], tenant_id: params[0] }] };
      }
      return { rows: [] };
    });
    const provisionUserInKeycloak = jest.fn().mockResolvedValue(true);
    const service = new AuthCoreService({ query } as any, { provisionUserInKeycloak } as any, {} as any, { checkSeatLimit: jest.fn() } as any, {} as any);
    const dto = { email: 'member@example.com', fullName: 'Member One', password: 'test-only-password', tenantId: id, branchId: branch, businessUnitId: id, roles: [id], sendEmailInvite: false };
    const requester = { tenantId: id, permissions: ['user:manage'], roles: [] };
    return { service, query, dto, requester, provisionUserInKeycloak };
  }
  it('persists the selected unit in the initial member insert', async () => {
    const { service, query, dto, requester } = setup();
    await service.register(dto, requester);
    const insert = query.mock.calls.find(([sql]) => sql.includes('INSERT INTO users'))!;
    expect(insert[1].slice(6)).toEqual([id, [id], branch, id]);
    expect(insert[0]).toContain('$10::uuid');
  });
  it.each([id, 'BDM'])('uses the database display name for selected role %s', async role => {
    const { service, dto, requester } = setup();
    const result = await service.register({ ...dto, roles: [role] }, requester);
    expect(result.user.roles).toEqual(['BDM']);
  });
  it('keeps the selected primary role when query results arrive in reverse order', async () => {
    const { service, dto, requester, query } = setup();
    const original = query.getMockImplementation()!;
    query.mockImplementation(async (sql, params) => sql.includes('FROM custom_roles')
      ? { rows: [{ id: branch, name: 'Recruiter' }, { id, name: 'Business Development Manager' }] }
      : original(sql, params));
    const result = await service.register({ ...dto, roles: [id, branch] }, requester);
    expect(result.user.roles).toEqual(['Business Development Manager']);
    const insert = query.mock.calls.find(([sql]) => sql.includes('INSERT INTO users'))!;
    expect(insert[1][6]).toBe(id);
    expect(insert[1][7]).toEqual([id, branch]);
  });
  it('rejects an unresolved role before creating or provisioning the account', async () => {
    const { service, dto, requester, query, provisionUserInKeycloak } = setup();
    await expect(service.register({ ...dto, roles: [branch] }, requester)).rejects.toMatchObject({ status: 400 });
    expect(query.mock.calls.some(([sql]) => sql.includes('INSERT INTO users'))).toBe(false);
    expect(provisionUserInKeycloak).not.toHaveBeenCalled();
  });
  it('does not fabricate a role when none was selected', async () => {
    const { service, dto, requester } = setup();
    expect((await service.register({ ...dto, roles: [] }, requester)).user.roles).toEqual([]);
  });
  it('rejects a unit outside the selected tenant/branch before provisioning', async () => {
    const { service, query, dto, requester, provisionUserInKeycloak } = setup(false);
    await expect(service.register(dto, requester)).rejects.toMatchObject({ status: 400 });
    expect(query.mock.calls.some(([sql]) => sql.includes('INSERT INTO users'))).toBe(false);
    expect(provisionUserInKeycloak).not.toHaveBeenCalled();
  });
  it('rejects malformed branch IDs', async () => {
    const { service, dto, requester } = setup();
    await expect(service.register({ ...dto, branchId: 'bad-id' }, requester)).rejects.toMatchObject({ status: 400 });
  });
  it('pins creation to the requesting tenant', async () => {
    const { service, query, dto, requester } = setup();
    await service.register({ ...dto, tenantId: branch }, requester);
    expect(query.mock.calls.find(([sql]) => sql.includes('INSERT INTO users'))![1][0]).toBe(id);
  });
  it.each([id, null])('bulk assigns or resets manager %s', async manager => {
    const query = jest.fn().mockResolvedValue({ rows: [] });
    query.mockResolvedValueOnce({ rows: [{ id, tenant_id: id }] });
    if (manager) query.mockResolvedValueOnce({ rows: [{ id: manager, tenant_id: id }] });
    const service = new AuthUserService({ query } as any, {} as any, {} as any);
    await service.bulkSetJobReviewer(id, [id], manager, { tenantId: id, permissions: ['user:manage', 'tenant:settings'] } as any);
    const write = query.mock.calls.find(([sql]) => sql.startsWith('UPDATE users'))!;
    expect(write[0]).toContain('job_reviewer_id = $1::uuid');
    expect(write[1]).toEqual([manager, [id], id]);
  });
  it('rejects invalid bulk manager input without a write', async () => {
    const query = jest.fn();
    const service = new AuthUserService({ query } as any, {} as any, {} as any);
    await expect(service.bulkSetJobReviewer(id, [id], 'name')).rejects.toMatchObject({ status: 400 });
    expect(query).not.toHaveBeenCalled();
  });
});
