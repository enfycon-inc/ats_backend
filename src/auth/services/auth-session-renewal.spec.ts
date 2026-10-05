import { AuthCoreService } from './auth-core.service';

describe('Keycloak session transport', () => {
  const env = { ...process.env };
  let service: AuthCoreService;
  beforeEach(() => {
    process.env.KEYCLOAK_ISSUER = 'https://auth.example/realms/ats';
    process.env.KEYCLOAK_INTERNAL_URL = 'http://keycloak:8080';
    process.env.KEYCLOAK_CLIENT_SECRET = 'test-secret';
    service = new AuthCoreService(null as any, null as any, null as any, null as any, null as any);
  });
  afterEach(() => { jest.restoreAllMocks(); process.env = { ...env }; });
  it('renews independent sessions using the public HTTPS scheme and rotated tokens', async () => {
    const mock = jest.spyOn(global, 'fetch').mockImplementation(async (_url, options) => {
      const token = new URLSearchParams(options?.body as string).get('refresh_token');
      return new Response(JSON.stringify({ access_token: `access-${token}`, refresh_token: `rotated-${token}`, expires_in: 300 }));
    });
    const results = await Promise.all(['one', 'two', 'three'].map(token => service.refreshKeycloakToken(token)));
    expect(results.map(r => r.accessToken)).toEqual(['access-one', 'access-two', 'access-three']);
    expect(results[0].refreshToken).toBe('rotated-one');
    for (const [url, options] of mock.mock.calls) {
      expect(url).toBe('http://keycloak:8080/realms/ats/protocol/openid-connect/token');
      expect(options?.headers).toMatchObject({ 'X-Forwarded-Proto': 'https' });
    }
  });
  it('returns 401 for a genuinely revoked token without retrying it', async () => {
    const mock = jest.spyOn(global, 'fetch').mockResolvedValue(new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400 }));
    await expect(service.refreshKeycloakToken('revoked')).rejects.toMatchObject({ status: 401 });
    expect(mock).toHaveBeenCalledTimes(1);
  });
  it('returns 503 for a network failure rather than claiming expiry', async () => {
    jest.spyOn(global, 'fetch').mockRejectedValue(new Error('network'));
    await expect(service.refreshKeycloakToken('valid')).rejects.toMatchObject({ status: 503 });
  });
  it('retains HTTPS on fallback transport after a server failure', async () => {
    const mock = jest.spyOn(global, 'fetch').mockResolvedValueOnce(new Response('', { status: 503 })).mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'renewed', expires_in: 300 })));
    await expect(service.refreshKeycloakToken('valid')).resolves.toMatchObject({ accessToken: 'renewed' });
    expect(mock.mock.calls[1][1]?.headers).toMatchObject({ 'X-Forwarded-Proto': 'https' });
  });
  it('treats a client configuration rejection as service failure', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(new Response(JSON.stringify({ error: 'invalid_client' }), { status: 401 }));
    await expect(service.refreshKeycloakToken('valid')).rejects.toMatchObject({ status: 503 });
  });
  it('forwards HTTPS when terminating a session', async () => {
    const mock = jest.spyOn(global, 'fetch').mockResolvedValue(new Response(null, { status: 204 }));
    await service.logoutKeycloakSession('valid');
    expect(mock.mock.calls[0][1]?.headers).toMatchObject({ 'X-Forwarded-Proto': 'https' });
  });
  it('issues password tokens using the same HTTPS scheme as renewal', async () => {
    const query = { query: jest.fn().mockResolvedValue({ rows: [{
      id: 'user', email: 'user@example.test', tenant_id: 'tenant', tenant_domain: 'workspace',
      is_active: true, is_approved: true, tenant_status: 'ACTIVE', system_role: 'RECRUITER',
    }] }) };
    const keycloak = { syncKeycloakUser: jest.fn().mockResolvedValue(undefined) };
    const tenant = { getTenantAuthPolicy: jest.fn().mockResolvedValue({ allowPasswordLogin: true }) };
    service = new AuthCoreService(query as any, keycloak as any, tenant as any, null as any, null as any);
    const mock = jest.spyOn(global, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      access_token: 'header.eyJzdWIiOiJ1c2VyIn0.signature', refresh_token: 'renewal', expires_in: 300,
    })));
    await expect(service.login({ email: 'user@example.test', password: 'example' })).resolves.toMatchObject({ refreshToken: 'renewal', expiresIn: 300 });
    expect(new URLSearchParams(mock.mock.calls[0][1]?.body as string).get('grant_type')).toBe('password');
    expect(mock.mock.calls[0][1]?.headers).toMatchObject({ 'X-Forwarded-Proto': 'https' });
  });
});
