import * as crypto from 'crypto';
import { JwtAuthGuard } from './jwt-auth.guard';

describe('JWT role revocation', () => {
  const keys = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  function token(roles: string[]) {
    const header = Buffer.from(JSON.stringify({ alg: 'RS256', kid: 'test' })).toString('base64url');
    const payload = Buffer.from(JSON.stringify({ sub: 'subject', email: 'am@deb.com', realm_access: { roles }, exp: Math.floor(Date.now() / 1000) + 600 })).toString('base64url');
    const data = `${header}.${payload}`;
    return `${data}.${crypto.sign('RSA-SHA256', Buffer.from(data), keys.privateKey).toString('base64url')}`;
  }
  function setup() {
    const syncKeycloakUser = jest.fn();
    const findUnique = jest.fn();
    const prisma = { $executeRawUnsafe: jest.fn().mockResolvedValue(0), user: { findUnique } };
    const guard = new JwtAuthGuard({ syncKeycloakUser } as any, prisma as any);
    jest.spyOn(guard as any, 'getPublicKey').mockResolvedValue(keys.publicKey.export({ type: 'spki', format: 'pem' }));
    return { guard, syncKeycloakUser, findUnique };
  }
  const dbUser = { id: 'user', tenant_id: 'tenant', is_active: true, roles: ['BDM'], permissions: ['job:view'], updated_at: new Date('2026-09-17T01:00:00Z') };
  async function request(guard: JwtAuthGuard, roles: string[]) {
    const req: any = { headers: { authorization: `Bearer ${token(roles)}` } };
    await guard.canActivate({ switchToHttp: () => ({ getRequest: () => req }) } as any);
    return req.user;
  }

  it('does not restore removed tenant roles from a signed old token', async () => {
    const { guard, syncKeycloakUser } = setup();
    syncKeycloakUser.mockResolvedValue(dbUser);
    const user = await request(guard, ['BRANCH_ADMIN', 'DELIVERY_HEAD']);
    expect(user.roles).toEqual(['BDM']);
    expect(user.permissions).toEqual(['job:view']);
  });
  it('refreshes permissions immediately when the saved user changes inside the cache lifetime', async () => {
    const { guard, syncKeycloakUser, findUnique } = setup();
    syncKeycloakUser.mockResolvedValueOnce({ ...dbUser, roles: ['BRANCH_ADMIN'], permissions: ['job:delegate'] }).mockResolvedValueOnce(dbUser);
    await request(guard, ['BRANCH_ADMIN']);
    findUnique.mockResolvedValue({ updatedAt: new Date('2026-09-17T01:01:00Z'), isActive: true });
    const user = await request(guard, ['BRANCH_ADMIN']);
    expect(syncKeycloakUser).toHaveBeenCalledTimes(2);
    expect(user.roles).toEqual(['BDM']);
    expect(user.permissions).not.toContain('job:delegate');
  });
  it('retains the explicit platform realm role', async () => {
    const { guard, syncKeycloakUser } = setup();
    syncKeycloakUser.mockResolvedValue(dbUser);
    expect((await request(guard, ['SUPER_ADMIN'])).roles).toContain('SUPER_ADMIN');
  });
});
