import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class PublicJobsKeyGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const oauthMatch = /^Bearer\s+(cat_[A-Za-z0-9_-]{40,})$/i.exec(request.headers.authorization || '');
    if (oauthMatch) {
      const token = await this.prisma.careerOauthToken.findUnique({ where: { tokenHash: createHash('sha256').update(oauthMatch[1]).digest('hex') }, include: { client: { include: { tenant: true, branch: true } } } });
      const client = token?.client;
      if (!token || token.expiresAt <= new Date() || !client || client.revokedAt || (client.expiresAt && client.expiresAt <= new Date()) || client.tenant.status !== 'ACTIVE' || (client.branchId && !client.branch?.isActive)) throw new UnauthorizedException('Invalid or revoked access token.');
      if (client.allowedOrigins.length && !client.allowedOrigins.includes('*') && request.headers.origin && !client.allowedOrigins.includes(request.headers.origin)) throw new UnauthorizedException('Origin is not allowed.');
      request.publicJobsKey = client;
      return true;
    }
    const match = /^Bearer\s+(epk_live_[A-Za-z0-9_-]{40,})$/i.exec(request.headers.authorization || '');
    if (!match) throw new UnauthorizedException('A valid public API key is required.');
    const keyHash = createHash('sha256').update(match[1]).digest('hex');
    const key = await this.prisma.publicJobsApiKey.findUnique({ where: { keyHash }, include: { tenant: { select: { status: true } }, branch: { select: { isActive: true } } } });
    if (!key || key.revokedAt || key.expiresAt <= new Date() || key.tenant.status !== 'ACTIVE') throw new UnauthorizedException('The public API key is invalid, expired, or revoked.');
    if (key.branchId && !key.branch?.isActive) throw new UnauthorizedException('The API key scope is inactive.');
    if (key.allowedOrigins.length && request.headers.origin && !key.allowedOrigins.includes(request.headers.origin)) {
      throw new UnauthorizedException('This API key is not enabled for this website origin.');
    }
    request.publicJobsKey = key;
    return true;
  }
}
