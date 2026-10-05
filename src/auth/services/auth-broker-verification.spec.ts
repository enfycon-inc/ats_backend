import { AuthCoreService } from './auth-core.service';

describe('broker token verification diagnostics', () => {
  const originalEnv = { ...process.env };
  const claims = () => ({ iss: 'https://auth.example/realms/ats', azp: 'ats', sub: 'user-id', exp: Math.floor(Date.now() / 1000) + 300, email: 'user@example.com', identity_provider: 'microsoft-workspace' });
  beforeEach(() => {
    process.env.KEYCLOAK_ISSUER = 'https://auth.example/realms/ats';
    process.env.KEYCLOAK_CLIENT_ID = 'ats';
    process.env.KEYCLOAK_CLIENT_SECRET = 'test-only-secret';
    delete process.env.KEYCLOAK_INTERNAL_URL;
  });
  afterEach(() => { jest.restoreAllMocks(); process.env = { ...originalEnv }; });
  function service(payload: any) {
    const instance: any = Object.create(AuthCoreService.prototype);
    instance.logger = { warn: jest.fn() };
    instance.decodeTokenPayload = jest.fn().mockReturnValue(payload);
    return instance;
  }
  it('accepts a broker token confirmed by introspection', async () => {
    const payload = claims();
    jest.spyOn(global, 'fetch').mockResolvedValue(new Response(JSON.stringify({ active: true, client_id: 'ats', sub: payload.sub, exp: payload.exp })));
    const instance = service(payload);
    await expect(instance.verifyBrokerAccessToken('test-token')).resolves.toEqual(payload);
    expect(instance.logger.warn).not.toHaveBeenCalled();
  });
  it('identifies a missing provider claim without logging the token or email', async () => {
    const payload = claims();
    delete (payload as any).identity_provider;
    jest.spyOn(global, 'fetch').mockResolvedValue(new Response(JSON.stringify({ active: true, client_id: 'ats', sub: payload.sub, exp: payload.exp })));
    const instance = service(payload);
    await expect(instance.verifyBrokerAccessToken('test-token')).rejects.toThrow('Microsoft sign-in could not be verified');
    expect(instance.logger.warn).toHaveBeenCalledWith('[SSO verification] rejected: missing_microsoft_provider_claim');
  });
  it('preserves the HTTP rejection reason', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(new Response(null, { status: 401 }));
    const instance = service(claims());
    await expect(instance.verifyBrokerAccessToken('test-token')).rejects.toThrow('Microsoft sign-in could not be verified');
    expect(instance.logger.warn).toHaveBeenCalledTimes(1);
    expect(instance.logger.warn).toHaveBeenCalledWith('[SSO verification] rejected: introspection_http_401');
  });
  it('preserves the configured HTTPS issuer scheme when introspecting over internal HTTP', async () => {
    process.env.KEYCLOAK_INTERNAL_URL = 'http://keycloak:8080';
    const payload = claims();
    const fetchMock = jest.spyOn(global, 'fetch').mockImplementation(async (_url, init) => {
      const headers = init?.headers as Record<string, string>;
      // Reproduce Keycloak's request-derived issuer: internal HTTP without the
      // proxy scheme rejects an otherwise valid token issued through HTTPS.
      return new Response(JSON.stringify(headers['X-Forwarded-Proto'] === 'https'
        ? { active: true, client_id: 'ats', sub: payload.sub, exp: payload.exp }
        : { active: false }));
    });
    await expect(service(payload).verifyBrokerAccessToken('test-token')).resolves.toEqual(payload);
    expect(fetchMock).toHaveBeenCalledWith('http://keycloak:8080/realms/ats/protocol/openid-connect/token/introspect', expect.objectContaining({ headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-Forwarded-Proto': 'https' } }));
  });
  it('binds new workspace account IDs as UUIDs', async () => {
    const payload = { ...claims(), identity_provider: 'microsoft-154fbda6-0a8f-4fa5-9c12-93727235798e' };
    const instance = service(payload);
    instance.verifyBrokerAccessToken = jest.fn().mockResolvedValue(payload);
    instance.tenantService = { getTenantAuthPolicy: jest.fn().mockResolvedValue({ allowedEmailDomains: ['example.com'] }) };
    let inserted = false;
    instance.authQuery = { query: jest.fn(async (sql: string) => {
      if (sql.startsWith('SELECT id, status FROM tenants')) return { rows: [{ status: 'ACTIVE' }] };
      if (sql.includes('INSERT INTO users')) {
        if (!sql.includes('VALUES ($1::uuid, $2::uuid,')) throw new Error('PostgreSQL 42804: UUID columns received text');
        inserted = true;
        throw new Error('stop_after_validated_insert');
      }
      return { rows: [] };
    }) };
    await expect(instance.ssoLogin({ provider: 'keycloak', accessToken: 'test-token' })).rejects.toThrow('stop_after_validated_insert');
    expect(inserted).toBe(true);
  });
});
