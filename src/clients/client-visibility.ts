import { ForbiddenException } from '@nestjs/common';
import type { AuthUser } from '../auth/interfaces/auth-user.interface';
import type { PrismaService } from '../prisma/prisma.service';

export async function clientReadWhere(prisma: PrismaService, tenantId: string, actor: AuthUser) {
  const permissions = actor?.permissions || [];
  if (actor?.tenantId !== tenantId || !permissions.includes('client:view')) {
    throw new ForbiddenException('Client viewing permission is required in this workspace.');
  }
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { clientsVisibleAcrossUnits: true } });
  if (!tenant) throw new ForbiddenException('Workspace unavailable.');
  const tenantAdmin = permissions.some(p => ['tenant:settings', 'tenant:manage', 'platform:manage'].includes(p));
  if (tenant.clientsVisibleAcrossUnits || tenantAdmin) return { tenantId };
  if (!actor.branchId) throw new ForbiddenException('A branch assignment is required to view clients.');
  const branchAdmin = permissions.includes('branch_admin:manage');
  const unitAdmin = permissions.includes('unit_admin:manage');
  if (!branchAdmin && !actor.businessUnitId) throw new ForbiddenException('A unit assignment is required to view clients.');
  const users = await prisma.user.findMany({
    where: { tenantId, branchId: actor.branchId, ...(!branchAdmin ? { businessUnitId: actor.businessUnitId } : {}) },
    select: { id: true, email: true },
  });
  const identities = users.flatMap(user => [user.id, user.email]).filter(Boolean);
  const ownedBy = (ids: string[]) => ({ OR: [
    { primaryOwner: { in: ids } },
    { AND: [{ OR: [{ primaryOwner: null }, { primaryOwner: '' }] }, { createdBy: { in: ids } }] },
  ] });
  const ownerScope = ownedBy(identities);
  const branchScope = { OR: [{ branchId: actor.branchId }, { AND: [{ branchId: null }, ownerScope] }] };
  if (branchAdmin) return { tenantId, AND: [branchScope] };
  if (unitAdmin) return { tenantId, AND: [branchScope, ownerScope] };
  const own = [actor.dbId, actor.email].filter(Boolean);
  return { tenantId, AND: [branchScope, ownedBy(own)] };
}

export function clientJobReadWhere(tenantId: string, actor: AuthUser) {
  const permissions = actor.permissions || [];
  if (!permissions.includes('job:view')) return { tenantId, id: { in: [] as string[] } };
  if (permissions.some(p => ['tenant:settings', 'tenant:manage', 'platform:manage', 'job:view_all_branches'].includes(p))) return { tenantId };
  if (!actor.branchId) return { tenantId, id: { in: [] as string[] } };
  return { tenantId, branchId: actor.branchId, ...(!permissions.includes('branch_admin:manage') ? { businessUnitId: actor.businessUnitId || null } : {}) };
}
