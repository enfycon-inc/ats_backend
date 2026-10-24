import { ForbiddenException } from '@nestjs/common';
import type { PrismaService } from '../prisma/prisma.service';
import type { AuthUser } from '../auth/interfaces/auth-user.interface';
import { loadWorkspaceFeatures } from '../auth/workspace-features';
import type { JobScope } from './job-action-policy';
export async function loadJobActor(db: PrismaService, actor?: AuthUser) {
  if (!actor?.dbId || !actor.tenantId) return { actor, podId: null, podsEnabled: false };
  const managed = actor as AuthUser & { homeTenantId?: string; managedTenant?: { id: string } };
  if (managed.homeTenantId && managed.managedTenant?.id === actor.tenantId && actor.permissions?.some(key => ['platform:manage', '*'].includes(key))) {
    const member = await db.user.findFirst({ where: { id: actor.dbId, tenantId: managed.homeTenantId, isActive: true, isApproved: true }, select: { id: true } });
    if (!member) throw new ForbiddenException('Your current workspace membership is unavailable.');
    return { actor: { ...actor, branchId: undefined, businessUnitId: undefined, podId: undefined }, podId: null, podsEnabled: (await loadWorkspaceFeatures(db, actor.tenantId)).podsEnabled };
  }
  const member = await db.user.findFirst({ where: { id: actor.dbId, tenantId: actor.tenantId, isActive: true, isApproved: true }, select: { branchId: true, businessUnitId: true, podId: true } });
  if (!member) throw new ForbiddenException('Your current workspace membership is unavailable.');
  const current = { ...actor, branchId: member?.branchId || undefined, businessUnitId: member?.businessUnitId || undefined, podId: member?.podId || undefined };
  const features = member?.businessUnitId ? await loadWorkspaceFeatures(db, actor.tenantId, member.businessUnitId, member.branchId) : { podsEnabled: false };
  return { actor: current, podId: member?.podId || null, podsEnabled: features.podsEnabled };
}
export function rowJobScope(row: any, tenantId: string, context: Awaited<ReturnType<typeof loadJobActor>>): JobScope {
  const ids = (value: unknown) => typeof value === 'string' ? value.split(',').filter(Boolean) : [];
  return { tenantId, status: row.status, approvalStatus: row.approval_status, accountManagerId: row.account_manager_id, branchId: row.branch_id, businessUnitId: row.business_unit_id,
    directlyAssigned: Boolean(context.actor?.dbId && ids(row.recruiter_ids).includes(context.actor.dbId)), podAssigned: Boolean(context.podId && ids(row.pod_id).includes(context.podId)), podsEnabled: context.podsEnabled };
}
