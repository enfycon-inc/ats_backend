import { SessionTrackingService } from './session-tracking.service';
import express = require('express');
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
  it('gracefully skips observation for brokered SSO tokens that omit auth_time and sid', async () => {
    // Microsoft AAD tokens brokered via Keycloak may omit auth_time (and use session_state or
    // neither). observe() must NOT throw — it must silently skip and allow the SSO login to proceed.
    const ssoActor: any = { dbId: 'user-id', tenantId: 'tenant-id' };
    const msftBrokeredClaims = { sub: 'identity', azp: 'app', exp: 2000000000 }; // no auth_time, no sid, no session_state
    const service = new SessionTrackingService({} as any, {} as any);
    await expect(service.observe(ssoActor, msftBrokeredClaims, {})).resolves.toBeUndefined();
  });
  it('gracefully skips when sid is absent but session_state is also absent (brokered SSO)', async () => {
    const ssoActor: any = { dbId: 'user-id', tenantId: 'tenant-id' };
    const claimsWithIatOnly = { sub: 'identity', azp: 'app', exp: 2000000000, iat: 1700000000 }; // has iat but no sid/session_state
    const service = new SessionTrackingService({} as any, {} as any);
    await expect(service.observe(ssoActor, claimsWithIatOnly, {})).resolves.toBeUndefined();
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
    expect(service.ip({ headers: { 'x-forwarded-for': '1.1.1.1' }, socket: { remoteAddress: '::ffff:8.8.8.8' } })).toBe('8.8.8.8');
    expect(service.ip({ headers: { 'x-forwarded-for': '8.8.8.8' }, ip: '172.18.0.11' })).toBeNull();
    expect(service.ip({ ip: '<invalid>' })).toBeNull();
  });
  it('uses the first untrusted hop behind exact ingress proxies, not a spoofed leftmost address', () => {
    const app = express();
    app.set('trust proxy', ['172.18.0.2/32', '172.18.0.3/32']);
    const request = Object.create(app.request);
    request.app = app;
    request.socket = { remoteAddress: '172.18.0.3' };
    request.headers = { 'x-forwarded-for': '1.1.1.1, 8.8.8.8, 172.18.0.2' };
    expect(new SessionTrackingService({} as any, {} as any).ip(request)).toBe('8.8.8.8');
    request.socket = { remoteAddress: '172.18.0.11' };
    expect(new SessionTrackingService({} as any, {} as any).ip(request)).toBeNull();
  });
});
