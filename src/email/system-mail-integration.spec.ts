import { EmailController } from './email.controller';
import { EmailService } from './email.service';
import { EmailAuthController } from './email-auth.controller';
import { AuthEmailService } from '../auth/services/auth-email.service';
import { AuthTenantService } from '../auth/services/auth-tenant.service';

describe('system mail application integration', () => {
  const env = { ...process.env };
  beforeEach(() => {
    process.env.FRONTEND_URL = 'https://enfyjobs.com';
    process.env.BASE_DOMAIN = 'enfyjobs.com';
    process.env.MICROSOFT_CLIENT_ID = 'test-client';
    process.env.MICROSOFT_CLIENT_SECRET = 'test-secret';
    process.env.MICROSOFT_REDIRECT_URI =
      'https://api.enfyjobs.com/api/v1/auth/callback/microsoft';
  });
  afterEach(() => {
    process.env = { ...env };
  });

  it('routes welcome, account, and onboarding templates through the same tenant dispatcher', async () => {
    const send = jest
      .fn()
      .mockResolvedValue({
        success: true,
        status: 'accepted',
        provider: 'brevo',
        from: 'no-reply@enfyjobs.com',
      });
    const mail = new AuthEmailService({ send } as any);
    const options = {
      tenantId: 'tenant-a',
      to: 'user@example.com',
      fullName: '<script>bad</script>',
      tenantName: 'Company A',
      subdomain: 'company-a',
    };
    await mail.sendWelcomeEmail({
      ...options,
      invitationToken: 'token&extra=1',
    });
    await mail.sendMemberCredentialsEmail(options);
    await mail.sendTenantStatusEmail({ ...options, pending: true });
    expect(send).toHaveBeenCalledTimes(3);
    for (const [request] of send.mock.calls) {
      expect(request.tenantId).toBe('tenant-a');
      expect(request.html).not.toContain('<script>');
      expect(request.replyTo).toBeUndefined();
    }
    expect(send.mock.calls[0][0].html).toContain('token%26extra%3D1');
  });
  it('does not swallow failed account email sends', async () => {
    const mail = new AuthEmailService({
      send: jest.fn().mockRejectedValue(new Error('mail failure')),
    } as any);
    await expect(
      mail.sendMemberCredentialsEmail({
        tenantId: 'tenant-a',
        to: 'user@example.com',
        fullName: 'User',
        tenantName: 'Company',
        subdomain: 'company',
      }),
    ).rejects.toThrow('mail failure');
  });
  it('sends a role approval welcome email to the validated tenant workspace', async () => {
    const send = jest.fn().mockResolvedValue({ success: true, status: 'accepted' });
    const mail = new AuthEmailService({ send } as any);
    await mail.sendRoleApprovalWelcomeEmail({
      tenantId: 'tenant-a',
      to: 'user@example.com',
      fullName: 'User One',
      tenantName: 'Company A',
      subdomain: 'company-a',
    });
    expect(send).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: 'tenant-a',
      to: 'user@example.com',
      subject: expect.stringContaining('Your access request was approved'),
      html: expect.stringContaining('https://company-a.enfyjobs.com/auth/login'),
      text: expect.stringContaining('existing credentials'),
    }));
  });
  it('reports onboarding acceptance or failure without undoing a saved account', async () => {
    const sendTenantStatusEmail = jest
      .fn()
      .mockResolvedValue({ success: true });
    const tenant = new AuthTenantService(
      {} as any,
      {} as any,
      {} as any,
      { sendTenantStatusEmail } as any,
    );
    const options = {
      tenantId: 'tenant-a',
      to: 'admin@example.com',
      fullName: 'Admin',
      tenantName: 'Company',
      subdomain: 'company',
      pending: false,
    };
    await expect((tenant as any).notifyTenant(options)).resolves.toEqual({
      status: 'accepted',
    });
    sendTenantStatusEmail.mockRejectedValue(new Error('provider unavailable'));
    await expect((tenant as any).notifyTenant(options)).resolves.toMatchObject({
      status: 'failed',
    });
  });
  it.each([false, true])(
    'sends registration onboarding after provisioning, preserving the account on mail failure=%s',
    async (failMail) => {
      let provisioned = false;
      const tenantRow = {
        id: 'tenant-a',
        name: 'Company A',
        domain: 'company-a',
        status: 'PENDING',
      };
      const userRow = {
        id: 'user-a',
        email: 'admin@example.com',
        full_name: 'Admin One',
        tenant_id: 'tenant-a',
      };
      const query = jest.fn(async (sql: string) => {
        if (sql.includes('INSERT INTO tenants')) return { rows: [tenantRow] };
        if (sql.includes('INSERT INTO users')) return { rows: [userRow] };
        return { rows: [] };
      });
      const sendTenantStatusEmail = jest.fn(async () => {
        expect(provisioned).toBe(true);
        if (failMail) throw new Error('provider unavailable');
        return { success: true };
      });
      const service = new AuthTenantService(
        { query } as any,
        {
          seedTenantRoles: jest
            .fn()
            .mockResolvedValue({ TENANT_ADMIN: 'role-a' }),
        } as any,
        {
          provisionUserInKeycloak: jest.fn(async () => {
            provisioned = true;
          }),
        } as any,
        { sendTenantStatusEmail } as any,
      );
      const result = await service.registerTenant({
        companyName: 'Company A',
        subdomain: 'company-a',
        email: 'admin@example.com',
        fullName: 'Admin One',
        password: 'test-password',
      });
      expect(result.tenant.id).toBe('tenant-a');
      expect(result.emailNotification.status).toBe(
        failMail ? 'failed' : 'accepted',
      );
      expect(sendTenantStatusEmail).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId: 'tenant-a',
          to: 'admin@example.com',
          pending: true,
        }),
      );
    },
  );
  it('sends an approval email only for a new approval, not a repeated request', async () => {
    let approved = false;
    const sendTenantStatusEmail = jest
      .fn()
      .mockResolvedValue({ success: true });
    const query = jest.fn(async (sql: string) => {
      if (sql.startsWith('SELECT tenant_id FROM users'))
        return { rows: [{ tenant_id: 'tenant-a' }] };
      if (sql.startsWith('UPDATE users')) {
        const rows = approved ? [] : [{ id: 'user-a' }];
        approved = true;
        return { rows };
      }
      if (sql.startsWith('SELECT u.email'))
        return {
          rows: [
            {
              email: 'admin@example.com',
              full_name: 'Admin One',
              name: 'Company A',
              domain: 'company-a',
            },
          ],
        };
      return { rows: [] };
    });
    const service = new AuthTenantService(
      { query } as any,
      {} as any,
      {} as any,
      { sendTenantStatusEmail } as any,
    );
    await expect(service.approveUser('user-a', 'US')).resolves.toMatchObject({
      emailNotification: { status: 'accepted' },
    });
    await expect(service.approveUser('user-a', 'US')).resolves.toMatchObject({
      emailNotification: { status: 'disabled' },
    });
    expect(sendTenantStatusEmail).toHaveBeenCalledTimes(1);
    expect(sendTenantStatusEmail).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'tenant-a', pending: false }),
    );
  });
  it('denies settings changes to users without a granular permission', async () => {
    const setTenantEmailMode = jest.fn();
    const controller = new EmailController({ setTenantEmailMode } as any);
    await expect(
      controller.setTenantEmailMode({ mode: 'DEFAULT_SUBDOMAIN' }, {
        tenantId: 'tenant-a',
        permissions: [],
      } as any),
    ).rejects.toMatchObject({ status: 403 });
    expect(setTenantEmailMode).not.toHaveBeenCalled();
  });
  it('rejects cross-tenant settings access and missing workspace identity', async () => {
    const getTenantEmailSettings = jest.fn();
    const controller = new EmailController({ getTenantEmailSettings } as any);
    await expect(
      controller.getTenantEmailSettings(
        { tenantId: 'tenant-a', permissions: ['tenant:settings'] } as any,
        'tenant-b',
      ),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      controller.getTenantEmailSettings({
        permissions: ['tenant:settings'],
      } as any),
    ).rejects.toMatchObject({ status: 403 });
    expect(getTenantEmailSettings).not.toHaveBeenCalled();
  });
  it('allows a workspace administrator to select its own sender', async () => {
    const setTenantEmailMode = jest.fn().mockResolvedValue({ success: true });
    const controller = new EmailController({ setTenantEmailMode } as any);
    await controller.setTenantEmailMode({ mode: 'DIRECT_ACCOUNT' }, {
      tenantId: 'tenant-a',
      permissions: ['tenant:settings'],
    } as any);
    expect(setTenantEmailMode).toHaveBeenCalledWith(
      'tenant-a',
      'DIRECT_ACCOUNT',
    );
  });
  function connectionService() {
    const redis = {
      set: jest.fn().mockResolvedValue('OK'),
      defineCommand: jest.fn(),
      runCommand: jest.fn(),
    };
    const tenant = jest.fn().mockResolvedValue({ id: 'tenant-a' });
    const service = new EmailService(
      {} as any,
      { client: Promise.resolve(redis) } as any,
      { tenant } as any,
      { appendDefault: jest.fn() } as any,
    );
    return { service, redis, tenant };
  }
  it('binds Microsoft OAuth to server-side identity with expiring single-use state and PKCE', async () => {
    const { service, redis } = connectionService();
    const { url } = await service.beginMicrosoftConnection(
      'tenant-a',
      'user-a',
      'https://company-a.enfyjobs.com/company?tab=email',
    );
    const auth = new URL(url);
    const state = auth.searchParams.get('state')!;
    expect(state).toMatch(/^[a-f0-9]{64}$/);
    expect(auth.searchParams.get('code_challenge_method')).toBe('S256');
    expect(redis.set.mock.calls[0][2]).toEqual({ EX: 600 });
    const context = JSON.parse(redis.set.mock.calls[0][1]);
    expect(context).toMatchObject({ tenantId: 'tenant-a', userId: 'user-a' });
    expect(context.codeVerifier).toBeTruthy();
    redis.runCommand
      .mockResolvedValueOnce(JSON.stringify(context))
      .mockResolvedValueOnce(null);
    await expect(
      service.consumeMicrosoftConnection(state),
    ).resolves.toMatchObject({ tenantId: 'tenant-a', userId: 'user-a' });
    expect(redis.defineCommand).toHaveBeenCalledWith(
      'consumeMailOAuthState',
      expect.objectContaining({ numberOfKeys: 1 }),
    );
    expect(redis.runCommand).toHaveBeenCalledWith('consumeMailOAuthState', [
      `email:microsoft:state:${state}`,
    ]);
    await expect(
      service.consumeMicrosoftConnection(state),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      service.consumeMicrosoftConnection('{"tenantId":"tenant-b"}'),
    ).rejects.toMatchObject({ status: 400 });
  });
  it('rejects deceptive return hosts and missing OAuth settings', async () => {
    const { service, redis } = connectionService();
    await expect(
      service.beginMicrosoftConnection(
        'tenant-a',
        'user-a',
        'https://fakeenfyjobs.com/company',
      ),
    ).rejects.toMatchObject({ status: 400 });
    delete process.env.MICROSOFT_REDIRECT_URI;
    await expect(
      service.beginMicrosoftConnection('tenant-a', 'user-a'),
    ).rejects.toMatchObject({ status: 503 });
    expect(redis.set).not.toHaveBeenCalled();
  });
  it('uses authenticated identity for mailbox connection instead of user-supplied IDs', async () => {
    const beginMicrosoftConnection = jest.fn();
    const controller = new EmailController({ beginMicrosoftConnection } as any);
    await controller.connectMicrosoft({ returnTo: '/company?tab=email' }, {
      tenantId: 'tenant-a',
      dbId: 'user-a',
    } as any);
    expect(beginMicrosoftConnection).toHaveBeenCalledWith(
      'tenant-a',
      'user-a',
      '/company?tab=email',
    );
  });
  it('rejects forged callback state before exchanging any authorization code', async () => {
    const handleMicrosoftCallback = jest.fn();
    const consumeMicrosoftConnection = jest
      .fn()
      .mockRejectedValue(new Error('invalid state'));
    const controller = new EmailAuthController({
      handleMicrosoftCallback,
      consumeMicrosoftConnection,
    } as any);
    const res: any = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    await controller.microsoftAuthCallback(
      'code',
      '{"tenantId":"tenant-b"}',
      res,
    );
    expect(res.status).toHaveBeenCalledWith(400);
    expect(handleMicrosoftCallback).not.toHaveBeenCalled();
  });
  it('does not clear tenant defaults when the requested account belongs to another tenant', async () => {
    const updateMany = jest.fn();
    const service = new EmailService(
      {
        emailAccount: {
          findFirst: jest.fn().mockResolvedValue(null),
          updateMany,
        },
      } as any,
      {} as any,
      { tenant: jest.fn().mockResolvedValue({ id: 'tenant-a' }) } as any,
      { appendDefault: jest.fn() } as any,
    );
    await expect(
      service.setDefaultAccount('account-b', 'tenant-a'),
    ).rejects.toMatchObject({ status: 400 });
    expect(updateMany).not.toHaveBeenCalled();
  });
});
