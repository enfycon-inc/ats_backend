import { AuthEmailService } from './auth-email.service';

describe('AuthEmailService password reset links', () => {
  const originalEnv = { ...process.env };
  let systemMail: { send: jest.Mock };

  beforeEach(() => {
    process.env.FRONTEND_URL = 'https://enfyjobs.com';
    process.env.BASE_DOMAIN = 'enfyjobs.com';
    systemMail = { send: jest.fn().mockResolvedValue({ messageId: 'email-id' }) };
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('sends reset links to the tenant host', async () => {
    const service = new AuthEmailService(systemMail as any);

    await service.sendPasswordResetEmail({
      tenantId: 'tenant-id',
      to: 'person@example.com',
      fullName: 'Person Example',
      tenantName: 'Example Tenant',
      subdomain: 'example',
      resetToken: 'reset-token',
    });

    const delivered = systemMail.send.mock.calls[0][0];
    expect(delivered.html).toContain(
      'https://example.enfyjobs.com/auth/create-password?token=reset-token',
    );
  });

  it('preserves local tenant selection while building reset links', async () => {
    process.env.FRONTEND_URL = 'http://localhost:3000';
    const service = new AuthEmailService(systemMail as any);

    await service.sendPasswordResetEmail({
      tenantId: 'tenant-id',
      to: 'person@example.com',
      fullName: 'Person Example',
      tenantName: 'Example Tenant',
      subdomain: 'example',
      resetToken: 'reset-token',
    });

    const delivered = systemMail.send.mock.calls[0][0];
    expect(delivered.html).toContain(
      'http://localhost:3000/auth/create-password?subdomain=example&amp;token=reset-token',
    );
  });

  it('sends password setup links to the tenant host', async () => {
    const service = new AuthEmailService(systemMail as any);

    await service.sendWelcomeEmail({
      tenantId: 'tenant-id',
      to: 'person@example.com',
      fullName: 'Person Example',
      tenantName: 'Example Tenant',
      subdomain: 'example',
      invitationToken: 'invite-token',
    });

    const delivered = systemMail.send.mock.calls[0][0];
    expect(delivered.html).toContain(
      'https://example.enfyjobs.com/auth/setup-password?token=invite-token',
    );
  });

  it('preserves local tenant selection in password setup links', async () => {
    process.env.FRONTEND_URL = 'http://localhost:3000';
    const service = new AuthEmailService(systemMail as any);

    await service.sendWelcomeEmail({
      tenantId: 'tenant-id',
      to: 'person@example.com',
      fullName: 'Person Example',
      tenantName: 'Example Tenant',
      subdomain: 'example',
      invitationToken: 'invite-token',
    });

    const delivered = systemMail.send.mock.calls[0][0];
    expect(delivered.html).toContain(
      'http://localhost:3000/auth/setup-password?subdomain=example&amp;token=invite-token',
    );
  });

  it('does not provide password setup links when password login is disabled', async () => {
    const authQuery = {
      query: jest.fn((sql: string) => Promise.resolve(
        sql.includes('tenant_auth_settings')
          ? { rows: [{ allow_password_login: false, allow_microsoft_sso: true, allow_google_sso: false }] }
          : { rows: [] },
      )),
    };
    const service = new AuthEmailService(systemMail as any, authQuery as any);

    await service.sendWelcomeEmail({
      tenantId: 'tenant-id',
      to: 'person@example.com',
      fullName: 'Person Example',
      tenantName: 'Example Tenant',
      subdomain: 'example',
      invitationToken: 'invite-token',
    });

    const delivered = systemMail.send.mock.calls[0][0];
    expect(delivered.html).not.toContain('/auth/setup-password');
  });
});
