import { AuthInviteService } from './auth-invite.service';

describe('invitation sign-in policy', () => {
  const dependencies = () => {
    const query = jest.fn();
    const provisionUserInKeycloak = jest.fn();
    const service = new AuthInviteService(
      { query } as any,
      { provisionUserInKeycloak } as any,
      {} as any,
      {} as any,
      {} as any,
    );
    return { query, provisionUserInKeycloak, service };
  };

  it('returns enabled tenant sign-in methods without exposing a role', async () => {
    const { query, service } = dependencies();
    query.mockResolvedValue({
      rows: [{
        email: 'member@example.com',
        full_name: 'Example Member',
        tenant_name: 'Example Tenant',
        tenant_domain: 'example',
        allow_password_login: true,
        allow_microsoft_sso: true,
        allow_google_sso: false,
        is_accepted: false,
        token_expires_at: new Date(Date.now() + 60_000),
        system_role: 'RECRUITER',
      }],
    });

    const details = await service.getInvitationDetails('invite-token');

    expect(details).toMatchObject({
      allowPasswordLogin: true,
      allowMicrosoftSso: true,
      allowGoogleSso: false,
    });
    expect(details).not.toHaveProperty('systemRole');
    expect(query.mock.calls[0][0]).toContain('tenant_auth_settings');
    expect(query.mock.calls[0][0]).not.toContain('system_roles');
  });

  it('blocks password acceptance before account activation when password login is disabled', async () => {
    const { query, provisionUserInKeycloak, service } = dependencies();
    query.mockResolvedValue({
      rows: [{
        id: 'invite-id',
        email: 'member@example.com',
        full_name: 'Example Member',
        tenant_id: 'tenant-id',
        token_expires_at: new Date(Date.now() + 60_000),
        allow_password_login: false,
      }],
    });

    await expect(service.acceptInvite({ token: 'invite-token', password: 'valid-password' }))
      .rejects.toThrow('Password sign-in is disabled');

    expect(query).toHaveBeenCalledTimes(1);
    expect(provisionUserInKeycloak).not.toHaveBeenCalled();
  });
});
