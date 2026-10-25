import { AuthInviteService } from './auth-invite.service';
import { AuthCoreService } from './auth-core.service';

describe('email role display names', () => {
  const tenant = '11111111-1111-4111-8111-111111111111';
  const role = '22222222-2222-4222-8222-222222222222';
  const name = 'Senior Recruitment Consultant';
  const actor = { fullName: 'Sahadeb Barman', email: 'actor@example.com' };
  function query(found = true) {
    return jest.fn(async (sql: string, params: any[]) => {
      if (sql.includes('FROM custom_roles')) return { rows: found ? [{ id: role, name }] : [] };
      if (sql.includes('INSERT INTO users')) return { rows: [{ id: tenant, email: params[1], full_name: params[4], tenant_id: tenant }] };
      if (sql.includes('SELECT name, domain FROM tenants')) return { rows: [{ name: 'Company', domain: 'company' }] };
      return { rows: [] };
    });
  }
  it('account email receives a resolved name instead of the submitted UUID', async () => {
    const sendMemberCredentialsEmail = jest.fn();
    const service = new AuthCoreService({ query: query() } as any, { provisionUserInKeycloak: jest.fn().mockResolvedValue(true) } as any,
      {} as any, { checkSeatLimit: jest.fn() } as any, { sendMemberCredentialsEmail } as any);
    await service.register({ email: 'member@example.com', fullName: 'Member', password: 'test-password', roles: [role] }, { ...actor, tenantId: tenant, permissions: ['user:manage'], roles: [] } as any);
    expect(sendMemberCredentialsEmail).toHaveBeenCalledWith(expect.objectContaining({ roleName: name, actor: expect.objectContaining(actor) }));
  });
  it.each([role, undefined])('invitation uses the custom display name for role selection %s', async roleId => {
    const sendWelcomeEmail = jest.fn();
    const service = new AuthInviteService({ query: query() } as any, {} as any, { sendWelcomeEmail } as any,
      { getTenantAuthPolicy: jest.fn().mockResolvedValue({}) } as any, { checkSeatLimit: jest.fn() } as any);
    await service.inviteUser({ email: 'member@example.com', fullName: 'Member', roleId }, { ...actor, tenantId: tenant, isAdmin: true, roles: [] });
    expect(sendWelcomeEmail).toHaveBeenCalledWith(expect.objectContaining({ roleName: name, actor: expect.objectContaining(actor) }));
  });
  it('rejects an invitation role outside the workspace before any insert', async () => {
    const db = query(false);
    const service = new AuthInviteService({ query: db } as any, {} as any, {} as any,
      { getTenantAuthPolicy: jest.fn().mockResolvedValue({}) } as any, { checkSeatLimit: jest.fn() } as any);
    await expect(service.inviteUser({ email: 'member@example.com', fullName: 'Member', roleId: role }, { ...actor, tenantId: tenant, isAdmin: true, roles: [] })).rejects.toMatchObject({ status: 400 });
    expect(db.mock.calls.some(([sql]) => sql.includes('INSERT'))).toBe(false);
  });
});
