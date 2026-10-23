import { BadRequestException, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';

const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const metadata = { id: true, name: true, scope: true, branchId: true, businessUnitId: true, allowedOrigins: true, expiresAt: true, revokedAt: true, createdAt: true } as const;

@Injectable()
export class CareerOauthService {
  constructor(private readonly prisma: PrismaService) {}

  private admin(user: any) {
    if (!user?.dbId || !user?.tenantId || !['tenant:settings', 'tenant:manage'].some(p => user.permissions?.includes(p))) throw new ForbiddenException('Tenant administration permission is required.');
  }

  async create(user: any, input: any) {
    this.admin(user);
    const name = typeof input?.name === 'string' ? input.name.trim() : '';
    if (!name || name.length > 120) throw new BadRequestException('Enter a client name (maximum 120 characters).');
    const { scope, branchId, businessUnitId } = input;
    if ([branchId, businessUnitId].some(id => id && (typeof id !== 'string' || !/^[0-9a-f-]{36}$/i.test(id)))) throw new BadRequestException('Invalid office identifier.');
    if (!['TENANT', 'BRANCH', 'BUSINESS_UNIT'].includes(scope) ||
        (scope === 'TENANT' && (branchId || businessUnitId)) ||
        (scope === 'BRANCH' && (!branchId || businessUnitId)) ||
        (scope === 'BUSINESS_UNIT' && (!branchId || !businessUnitId))) throw new BadRequestException('Select tenant, then branch, then unit as required by the scope.');
    if (branchId && !await this.prisma.branch.findFirst({ where: { id: branchId, tenantId: user.tenantId, isActive: true } })) throw new BadRequestException('Invalid tenant branch.');
    if (businessUnitId && !await this.prisma.businessUnit.findFirst({ where: { id: businessUnitId, tenantId: user.tenantId, branchId } })) throw new BadRequestException('Invalid branch unit.');
    if (![null, 1, 6, 12, 24].includes(input.expiryMonths)) throw new BadRequestException('Select no expiry, 1 month, 6 months, 1 year or 2 years.');
    let expiresAt: Date | null = null;
    if (input.expiryMonths !== null) {
      expiresAt = new Date();
      const day = expiresAt.getUTCDate();
      expiresAt.setUTCDate(1);
      expiresAt.setUTCMonth(expiresAt.getUTCMonth() + input.expiryMonths);
      const lastDay = new Date(Date.UTC(expiresAt.getUTCFullYear(), expiresAt.getUTCMonth() + 1, 0)).getUTCDate();
      expiresAt.setUTCDate(Math.min(day, lastDay));
    }
    const origins = input.allowedOrigins;
    if (!Array.isArray(origins) || origins.length > 10 || origins.some(o => typeof o !== 'string' || (o !== '*' && !/^https:\/\/[a-z0-9.-]+(?::\d+)?$/i.test(o)))) throw new BadRequestException('Use HTTPS origins or * for any origin.');
    const secret = randomBytes(32).toString('base64url');
    const client = await this.prisma.careerOauthClient.create({ data: { name, tenantId: user.tenantId, createdBy: user.dbId, scope, branchId: branchId || null, businessUnitId: businessUnitId || null, secretHash: hash(secret), allowedOrigins: origins.includes('*') ? ['*'] : [...new Set(origins)] as string[], expiresAt }, select: metadata });
    await this.prisma.auditLog.create({ data: { tenantId: user.tenantId, actorId: user.dbId, action: 'CAREER_OAUTH_CLIENT_CREATED', targetType: 'career_oauth_client', targetId: client.id, details: { name, scope } } });
    return { ...client, client_id: client.id, client_secret: secret };
  }

  list(user: any) { this.admin(user); return this.prisma.careerOauthClient.findMany({ where: { tenantId: user.tenantId }, select: metadata, orderBy: { createdAt: 'desc' } }); }

  async revoke(user: any, id: string) {
    this.admin(user);
    await this.prisma.careerOauthClient.updateMany({ where: { id, tenantId: user.tenantId, revokedAt: null }, data: { revokedAt: new Date() } });
    await this.prisma.auditLog.create({ data: { tenantId: user.tenantId, actorId: user.dbId, action: 'CAREER_OAUTH_CLIENT_REVOKED', targetType: 'career_oauth_client', targetId: id, details: {} } });
    return { revoked: true };
  }

  async token(authorization: string | undefined, body: any) {
    const fail = () => new UnauthorizedException({ error: 'invalid_client', error_description: 'Client authentication failed.' });
    if (body?.grant_type !== 'client_credentials') throw new BadRequestException({ error: 'unsupported_grant_type' });
    if (!authorization?.startsWith('Basic ')) throw fail();
    const decoded = Buffer.from(authorization.slice(6), 'base64').toString('utf8');
    const separator = decoded.indexOf(':');
    if (separator < 1) throw fail();
    const id = decoded.slice(0, separator);
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw fail();
    const client = await this.prisma.careerOauthClient.findUnique({ where: { id }, include: { tenant: true, branch: true } });
    if (!client || !timingSafeEqual(Buffer.from(client.secretHash, 'hex'), Buffer.from(hash(decoded.slice(separator + 1)), 'hex')) || client.revokedAt || (client.expiresAt && client.expiresAt <= new Date()) || client.tenant.status !== 'ACTIVE' || (client.branchId && !client.branch?.isActive)) throw fail();
    const accessToken = `cat_${randomBytes(32).toString('base64url')}`;
    const expiresAt = new Date(Math.min(Date.now() + 900000, client.expiresAt?.getTime() ?? Infinity));
    await this.prisma.careerOauthToken.deleteMany({ where: { clientId: id, expiresAt: { lte: new Date() } } });
    await this.prisma.careerOauthToken.create({ data: { clientId: id, tokenHash: hash(accessToken), expiresAt } });
    return { access_token: accessToken, token_type: 'Bearer', expires_in: Math.max(0, Math.floor((expiresAt.getTime() - Date.now()) / 1000)) };
  }
}
