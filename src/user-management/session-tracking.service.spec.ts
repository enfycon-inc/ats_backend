import { SessionTrackingService } from './session-tracking.service';
describe('Session tracking and presence failures', () => {
  const actor: any = { dbId: 'member', tenantId: 'tenant', keycloakId: 'identity' };
  const claims = { sub: 'identity', sid: 'session', azp: 'app', exp: 2000000000, auth_time: 1000 };
  const originalFlag = process.env.USER_MANAGEMENT_TELEMETRY_ENABLED;
  beforeEach(() => { process.env.USER_MANAGEMENT_TELEMETRY_ENABLED = 'true'; });
  afterEach(() => { if (originalFlag === undefined) delete process.env.USER_MANAGEMENT_TELEMETRY_ENABLED; else process.env.USER_MANAGEMENT_TELEMETRY_ENABLED = originalFlag; });
  it('rejects a pre-block token even after the account was unblocked', async () => {
    const db: any = { $queryRawUnsafe: jest.fn().mockResolvedValue([{ is_active: true, session_valid_after: new Date(2000000) }]) };
    await expect(new SessionTrackingService(db, {} as any).observe(actor, claims, {})).rejects.toThrow('new sign-in');
  });
  it('does not resurrect an individually revoked membership', async () => {
    const db: any = { $queryRawUnsafe: jest.fn().mockResolvedValueOnce([{ is_active: true }]).mockResolvedValueOnce([{ id: 'membership', revoked_at: new Date() }]) };
    await expect(new SessionTrackingService(db, {} as any).observe(actor, claims, {})).rejects.toThrow('ended');
  });
  it('reports unknown, rather than offline, when Redis fails', async () => {
    const queue: any = { client: Promise.resolve({ pipeline: () => { throw new Error('Redis unavailable'); } }) };
    const result = await new SessionTrackingService({} as any, queue).presences('tenant', ['one', 'two']);
    expect([...result.values()]).toEqual(['unknown', 'unknown']);
  });
  it('aggregates activity across tabs and ignores stale connections', async () => {
    const now = Date.now();
    const results = [
      [null, { tab1: JSON.stringify({ seen: now, active: now - 600000 }), tab2: JSON.stringify({ seen: now, active: now }) }],
      [null, { tab: JSON.stringify({ seen: now, active: now - 600000 }) }],
      [null, { tab: JSON.stringify({ seen: now - 100000, active: now }) }],
    ];
    const pipeline: any = { hgetall: jest.fn(), exec: jest.fn().mockResolvedValue(results) };
    const result = await new SessionTrackingService({} as any, { client: Promise.resolve({ pipeline: () => pipeline }) } as any).presences('tenant', ['active', 'away', 'offline']);
    expect([...result.values()]).toEqual(['active', 'away', 'offline']);
  });
  it('takes the server-resolved IP and ignores arbitrary forwarded headers', () => {
    const service = new SessionTrackingService({} as any, {} as any);
    expect(service.ip({ headers: { 'x-forwarded-for': '203.0.113.1' }, socket: { remoteAddress: '::ffff:192.0.2.1' } })).toBe('192.0.2.1');
    expect(service.ip({ ip: '<invalid>' })).toBeNull();
  });
});
