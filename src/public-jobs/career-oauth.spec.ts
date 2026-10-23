import { createHash } from 'node:crypto';
import { CareerOauthService } from './career-oauth.service';
import { PublicJobsKeyGuard } from './public-jobs-key.guard';

describe('career OAuth credentials', () => {
  const id = '11111111-1111-4111-8111-111111111111';
  const secret = 'test-secret';
  const basic = 'Basic ' + Buffer.from(`${id}:${secret}`).toString('base64');
  const client = () => ({ id, secretHash: createHash('sha256').update(secret).digest('hex'), tenant: { status: 'ACTIVE' }, revokedAt: null, expiresAt: null, branchId: null, allowedOrigins: ['*'] });
  it('issues a hashed, short-lived token without returning the client secret', async () => {
    const prisma = { careerOauthClient: { findUnique: jest.fn().mockResolvedValue(client()) }, careerOauthToken: { create: jest.fn(), deleteMany: jest.fn() } };
    const result = await new CareerOauthService(prisma as any).token(basic, { grant_type: 'client_credentials' });
    expect(result.access_token).toMatch(/^cat_/);
    expect(result.expires_in).toBeLessThanOrEqual(900);
    expect(prisma.careerOauthToken.create.mock.calls[0][0].data.tokenHash).not.toBe(result.access_token);
    expect(result).not.toHaveProperty('client_secret');
  });
  it('rejects revoked clients when requesting new tokens', async () => {
    const prisma = { careerOauthClient: { findUnique: jest.fn().mockResolvedValue({ ...client(), revokedAt: new Date() }) } };
    await expect(new CareerOauthService(prisma as any).token(basic, { grant_type: 'client_credentials' })).rejects.toThrow();
  });
  it('rejects already-issued tokens immediately after client revocation', async () => {
    const prisma = { careerOauthToken: { findUnique: jest.fn().mockResolvedValue({ expiresAt: new Date(Date.now() + 60000), client: { ...client(), revokedAt: new Date() } }) } };
    const req = { headers: { authorization: 'Bearer cat_' + 'a'.repeat(43) } };
    await expect(new PublicJobsKeyGuard(prisma as any).canActivate({ switchToHttp: () => ({ getRequest: () => req }) } as any)).rejects.toThrow();
  });
  it('rejects a unit scope without a selected branch before writing data', async () => {
    await expect(new CareerOauthService({} as any).create({ dbId: id, tenantId: id, permissions: ['tenant:settings'] }, { name: 'Website', scope: 'BUSINESS_UNIT', businessUnitId: id, expiryMonths: null, allowedOrigins: ['*'] })).rejects.toThrow();
  });
});
