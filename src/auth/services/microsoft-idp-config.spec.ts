import { AuthKeycloakService } from './auth-keycloak.service';

describe('Microsoft Keycloak identity-provider configuration', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
    jest.restoreAllMocks();
  });

  it('sends the Entra directory ID to Keycloak and installs the broker claim mapper', async () => {
    process.env.KEYCLOAK_INTERNAL_URL = 'http://keycloak:8080';
    process.env.KEYCLOAK_ISSUER = 'http://localhost:8080/realms/enfycon-ats';
    process.env.KEYCLOAK_CLIENT_ID = 'enfycon-ats';

    const requests: Array<{ url: string; method: string; body?: string }> = [];
    const fetchMock = jest.spyOn(globalThis, 'fetch').mockImplementation(async (input: any, init: any = {}) => {
      const url = String(input);
      requests.push({ url, method: init.method || 'GET', body: init.body });

      if (url.endsWith('/identity-provider/instances/microsoft-tenant')) {
        return { ok: false, status: 404, text: async () => '' } as any;
      }
      if (url.endsWith('/identity-provider/instances')) {
        return { ok: true, status: 201, text: async () => '' } as any;
      }
      if (url.includes('/clients?clientId=')) {
        return { ok: true, json: async () => [{ id: 'client-uuid', clientId: 'enfycon-ats' }] } as any;
      }
      if (url.endsWith('/protocol-mappers/models')) {
        return { ok: true, json: async () => [] } as any;
      }
      if (url.endsWith('/protocol-mappers/models') && init.method === 'POST') {
        return { ok: true, status: 201 } as any;
      }
      throw new Error(`Unexpected request: ${init.method || 'GET'} ${url}`);
    });

    const service = new AuthKeycloakService({} as any);
    jest.spyOn(service, 'getKeycloakAdminToken').mockResolvedValue('admin-token');

    const redirectUri = await service.configureTenantIdentityProvider(
      'tenant',
      'azure-client',
      'azure-secret',
      '11111111-1111-4111-8111-111111111111',
    );

    expect(redirectUri).toContain('/broker/microsoft-tenant/endpoint');
    const idpCreate = requests.find((request) => request.method === 'POST' && request.url.endsWith('/identity-provider/instances'));
    expect(JSON.parse(idpCreate?.body || '{}').config.tenantId).toBe('11111111-1111-4111-8111-111111111111');
    expect(requests.some((request) => request.method === 'POST' && request.url.endsWith('/protocol-mappers/models'))).toBe(true);
    expect(fetchMock).toHaveBeenCalled();
  });
});
