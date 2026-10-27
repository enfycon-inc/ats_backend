import { UserManagementService } from './user-management.service';
const actor: any = { dbId: 'actor', tenantId: 'tenant', branchId: 'branch', businessUnitId: 'unit', permissions: [] };
describe('Security activity authorization and redaction', () => {
  function setup(enabled = true) {
    const db: any = { $queryRawUnsafe: jest.fn().mockResolvedValue([]), $executeRawUnsafe: jest.fn().mockResolvedValue(1) };
    db.$transaction = jest.fn(fn => fn(db));
    const tracking: any = { enabled, publish: jest.fn().mockResolvedValue(undefined) };
    return { db, tracking, service: new UserManagementService(db, tracking) };
  }
  it('denies session reads without a session capability before accessing storage', async () => {
    const { db, service } = setup();
    await expect(service.sessions({ ...actor, permissions: ['user:manage'] }, 'other')).rejects.toThrow();
    expect(db.$queryRawUnsafe).not.toHaveBeenCalled();
  });
  it('denies out-of-scope detail requests without returning whether the user exists', async () => {
    const { db, service } = setup();
    await expect(service.sessions({ ...actor, permissions: ['user:sessions:view'] }, 'other')).rejects.toThrow('authorised scope');
    expect(db.$queryRawUnsafe.mock.calls[0][0]).toContain('u.tenant_id');
    expect(db.$queryRawUnsafe.mock.calls[0][0]).toContain('u.business_unit_id');
  });
  it('omits IP projection when session viewer lacks IP capability', async () => {
    const { db, service } = setup();
    db.$queryRawUnsafe.mockResolvedValueOnce([{ id: 'other' }]).mockResolvedValueOnce([{ id: 'session', device: 'Chrome' }]);
    const response = await service.sessions({ ...actor, permissions: ['user:sessions:view'] }, 'other');
    expect(db.$queryRawUnsafe.mock.calls[1][0]).not.toContain('AS "ipAddress"');
    expect(response[0]).not.toHaveProperty('ipAddress');
    expect(db.$executeRawUnsafe).toHaveBeenCalled();
  });
  it('allows own-session review without granting access to anyone else', async () => {
    const { db, service } = setup();
    await service.sessions(actor, actor.dbId);
    expect(db.$queryRawUnsafe.mock.calls[0][1]).toBe('actor');
    expect(db.$queryRawUnsafe.mock.calls[0][2]).toBe('tenant');
  });
  it('makes repeated revocation idempotent and does not insert another event/outbox item', async () => {
    const { db, service } = setup();
    db.$queryRawUnsafe.mockResolvedValue([{ user_id: actor.dbId }]);
    db.$executeRawUnsafe.mockResolvedValue(0);
    await expect(service.revoke(actor, 'session')).resolves.toMatchObject({ success: true });
    expect(db.$executeRawUnsafe).toHaveBeenCalledTimes(1);
  });
  it('does not expose user sessions when the migration feature is disabled', async () => {
    const { service, db } = setup(false);
    await expect(service.sessions(actor, actor.dbId)).resolves.toEqual([]);
    expect(db.$queryRawUnsafe).not.toHaveBeenCalled();
  });
  it('rejects unbounded page sizes and invalid user states', async () => {
    const { service, db } = setup();
    const admin = { ...actor, permissions: ['user:manage'] };
    await expect(service.list(admin, { pageSize: '1000000' })).rejects.toThrow('pagination');
    await expect(service.list(admin, { state: 'all-tenants' })).rejects.toThrow('view');
    expect(db.$queryRawUnsafe).not.toHaveBeenCalled();
  });
});
