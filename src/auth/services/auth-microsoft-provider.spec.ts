import { BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import { AuthKeycloakService } from './auth-keycloak.service';
import { AuthTenantService } from './auth-tenant.service';
import { AuthInitService } from './auth-init.service';

describe('tenant Microsoft identity provider configuration', () => {
  const tenantId = '737f666b-916a-4e9c-91bd-b2bd37e475d1';
  const directoryId = '4c26e2f3-c3c8-43d9-b14c-c77e0178720e';
  const storedPolicy = {
    tenant_id: tenantId,
    allow_microsoft_sso: true,
    microsoft_tenant_id: directoryId,
    microsoft_client_id: 'application-id',
    microsoft_client_secret: 'stored-test-secret',
  };

  afterEach(() => jest.restoreAllMocks());

  it.each([200, 404])('uses the saved Microsoft directory when the provider lookup returns %s', async (status) => {
    const fetchMock = jest.spyOn(global, 'fetch').mockImplementation(async (input: any, init: any = {}) => {
      const url = String(input);
      if (url.includes('/identity-provider/instances/microsoft-')) {
        if (init.method === 'PUT' || init.method === 'POST') return new Response(null, { status: 204 });
        return new Response(null, { status });
      }
      if (url.endsWith('/identity-provider/instances')) {
        return new Response(null, { status: 204 });
      }
      if (url.includes('/clients?clientId=')) {
        return new Response(JSON.stringify([{ id: 'client-uuid', clientId: 'enfycon-ats' }]), { status: 200 });
      }
      if (url.endsWith('/protocol-mappers/models')) return new Response('[]', { status: 200 });
      if (url.includes('/protocol-mappers/models/')) return new Response(null, { status: 204 });
      throw new Error(`Unexpected request: ${init.method || 'GET'} ${url}`);
    });
    const service = new AuthKeycloakService({} as any);
    jest.spyOn(service, 'getKeycloakAdminToken').mockResolvedValue('admin-test-token');
    const redirect = await (service.configureTenantIdentityProvider as any)(
      tenantId, 'application-id', 'test-secret', directoryId,
    );
    const providerRequest = fetchMock.mock.calls.find((call: any[]) => String(call[0]).includes('/identity-provider/instances') && call[1]?.body);
    const payload = JSON.parse(providerRequest?.[1]?.body as string);
    expect(payload.alias).toBe(`microsoft-${tenantId}`);
    expect(payload.config.tenantId).toBe(directoryId);
    expect(providerRequest?.[1]?.method).toBe(status === 200 ? 'PUT' : 'POST');
    expect(redirect).toContain(`/broker/microsoft-${tenantId}/endpoint`);
  });

  it('does not attempt to create a provider when its lookup failed', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(new Response(null, { status: 503 }));
    const service = new AuthKeycloakService({} as any);
    jest.spyOn(service, 'getKeycloakAdminToken').mockResolvedValue('admin-test-token');
    await expect((service.configureTenantIdentityProvider as any)(tenantId, 'application-id', 'test-secret', directoryId)).resolves.toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('rejects a masked client secret before changing Keycloak', async () => {
    const fetchMock = jest.spyOn(global, 'fetch');
    const service = new AuthKeycloakService({} as any);
    await expect((service.configureTenantIdentityProvider as any)(
      tenantId, 'application-id', '**********', directoryId,
    )).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('resynchronizes the directory using the persisted secret when no replacement secret is supplied', async () => {
    const configureTenantIdentityProvider = jest.fn().mockResolvedValue('https://auth.example/broker/microsoft/endpoint');
    const service = new AuthTenantService(
      { query: jest.fn().mockResolvedValue({ rows: [storedPolicy] }) } as any,
      {} as any,
      { configureTenantIdentityProvider } as any,
    );
    const saved = await service.updateTenantAuthPolicy(tenantId, { microsoftTenantId: directoryId, microsoftClientId: 'application-id' });
    expect(configureTenantIdentityProvider).toHaveBeenCalledWith(tenantId, 'application-id', 'stored-test-secret', directoryId);
    expect(saved.microsoftRedirectUri).toBe('https://auth.example/broker/microsoft/endpoint');
    expect(saved).not.toHaveProperty('microsoftClientSecret');
  });

  it('reports an unsuccessful identity provider synchronization to the caller', async () => {
    const service = new AuthTenantService(
      { query: jest.fn().mockResolvedValue({ rows: [storedPolicy] }) } as any,
      {} as any,
      { configureTenantIdentityProvider: jest.fn().mockResolvedValue(null) } as any,
    );
    await expect(service.updateTenantAuthPolicy(tenantId, { microsoftTenantId: directoryId, microsoftClientId: 'application-id' }))
      .rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('requires the full client secret when the persisted value is masked', async () => {
    const query = jest.fn().mockResolvedValue({ rows: [{ ...storedPolicy, microsoft_client_secret: '**********' }] });
    const service = new AuthTenantService(
      { query } as any,
      {} as any,
      { configureTenantIdentityProvider: jest.fn() } as any,
    );
    await expect(service.updateTenantAuthPolicy(tenantId, {
      microsoftTenantId: directoryId,
      microsoftClientId: 'application-id',
      microsoftClientSecret: null,
    })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects an email address in the Microsoft application client ID field', async () => {
    const query = jest.fn().mockResolvedValue({ rows: [{ ...storedPolicy, microsoft_client_id: 'sahadeb@enfycon.com' }] });
    const service = new AuthTenantService(
      { query } as any,
      {} as any,
      { configureTenantIdentityProvider: jest.fn() } as any,
    );
    await expect(service.updateTenantAuthPolicy(tenantId, {
      microsoftTenantId: directoryId,
      microsoftClientId: 'sahadeb@enfycon.com',
      microsoftClientSecret: 'secret',
    })).rejects.toThrow('Application (client) ID');
  });

  it('restores the directory restriction when providers are provisioned at startup', async () => {
    const query = jest.fn().mockResolvedValue({ rows: [storedPolicy] });
    const configureTenantIdentityProvider = jest.fn().mockResolvedValue('https://auth.example/endpoint');
    const service = new AuthInitService({ query } as any, {} as any, { configureTenantIdentityProvider } as any);
    await (service as any).reprovisionAllKeycloakIdps();
    expect(query.mock.calls[0][0]).toContain('microsoft_tenant_id');
    expect(configureTenantIdentityProvider).toHaveBeenCalledWith(tenantId, 'application-id', 'stored-test-secret', directoryId);
  });

  it('skips masked secrets during startup provisioning', async () => {
    const query = jest.fn().mockResolvedValue({ rows: [{ ...storedPolicy, microsoft_client_secret: '**********' }] });
    const configureTenantIdentityProvider = jest.fn();
    const service = new AuthInitService({ query } as any, {} as any, { configureTenantIdentityProvider } as any);
    await (service as any).reprovisionAllKeycloakIdps();
    expect(configureTenantIdentityProvider).not.toHaveBeenCalled();
  });
});
