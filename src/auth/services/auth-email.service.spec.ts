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
});
