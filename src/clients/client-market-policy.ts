import { BadRequestException, ForbiddenException } from '@nestjs/common';
import type { AuthUser } from '../auth/interfaces/auth-user.interface';
import type { PrismaService } from '../prisma/prisma.service';
import { normalizeClientMarket, type ClientCreationContext } from './client-creation.contract';

export function assertClientCreationPermission(actor: AuthUser) {
  const perms = actor.permissions || [];
  if (!['client:create', 'client:direct_add', 'tenant:settings', 'tenant:manage'].some(p => perms.includes(p))) {
    throw new ForbiddenException('Client creation permission is required.');
  }
}

export async function resolveClientCreationContext(prisma: PrismaService, tenantId: string, actor: AuthUser, selectedBranchId?: string): Promise<ClientCreationContext> {
  assertClientCreationPermission(actor);
  const member = await prisma.user.findFirst({
    where: { id: actor.dbId, tenantId, isActive: true },
    select: { id: true, fullName: true, email: true, branchId: true, businessUnitId: true },
  });
  if (!member) throw new ForbiddenException('Workspace membership is unavailable.');
  const branchId = selectedBranchId || member.branchId;
  const tenantManager = ['tenant:settings', 'tenant:manage'].some(p => actor.permissions?.includes(p));
  if (!branchId || branchId === 'ALL') throw new BadRequestException('Select a branch before adding a client.');
  if (typeof branchId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(branchId)) throw new BadRequestException('Select a valid branch.');
  if (branchId !== member.branchId && !tenantManager) throw new ForbiddenException('You cannot add clients in this branch.');
  const branch = await prisma.branch.findFirst({ where: { id: branchId, tenantId, isActive: true }, select: { id: true, name: true, market: true } });
  if (!branch) throw new ForbiddenException('The selected branch is unavailable.');
  const unitId = branchId === member.branchId ? member.businessUnitId : null;
  const unit = unitId ? await prisma.businessUnit.findFirst({
    where: { id: unitId, tenantId, branchId },
    select: { id: true, name: true, currency: true, marketSegmentId: true, marketSegment: { select: { code: true, isActive: true, tenantId: true, defaultCurrency: true } } },
  }) : null;
  if (unitId && !unit) throw new ForbiddenException('Your staffing unit is unavailable in this branch.');
  if (unit?.marketSegmentId && (!unit.marketSegment?.isActive || (unit.marketSegment.tenantId && unit.marketSegment.tenantId !== tenantId))) throw new BadRequestException('Configure an active market segment for this staffing unit.');
  let configuredMarket: string | undefined = unit?.marketSegment?.code || branch.market;
  if (!configuredMarket) {
    const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { defaultMarket: true } });
    configuredMarket = tenant?.defaultMarket;
  }
  const market = normalizeClientMarket(configuredMarket);
  if (!market) throw new BadRequestException('Configure a supported staffing market before adding clients.');
  const currency = market === 'INDIA' ? 'INR' : 'USD';
  const configuredCurrency = unit?.currency || unit?.marketSegment?.defaultCurrency;
  if (configuredCurrency && configuredCurrency.toUpperCase() !== currency) throw new BadRequestException('The staffing market and currency configuration do not match.');
  return { branchId: branch.id, branchName: branch.name, businessUnitId: unit?.id || null, businessUnitName: unit?.name || null,
    ownerId: member.id, ownerName: member.fullName || member.email, market, currency,
    canDirectAdd: ['client:direct_add', 'client:approve', 'tenant:settings', 'tenant:manage'].some(p => actor.permissions?.includes(p)) };
}

export function assertClientMarket(input: { market?: unknown; currency?: unknown }, context: Pick<ClientCreationContext, 'market' | 'currency'>) {
  if ((input.market !== undefined && normalizeClientMarket(input.market) !== context.market) ||
      (input.currency !== undefined && String(input.currency).toUpperCase() !== context.currency)) {
    throw new BadRequestException('Client market and currency must match the staffing context.');
  }
}
