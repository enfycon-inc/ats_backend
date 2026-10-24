import { ForbiddenException } from '@nestjs/common';
import type { PrismaService } from '../prisma/prisma.service';

export interface WorkspaceFeatures { podsEnabled: boolean; }
export function workspaceFeatures(tenantEnabled: unknown, unitAllowed: unknown): WorkspaceFeatures {
  return { podsEnabled: tenantEnabled === true && unitAllowed === true };
}
// Live settings, never JWT feature flags. A disabled tenant wins over every unit.
export async function loadWorkspaceFeatures(db: PrismaService, tenantId: string, businessUnitId?: string | null, branchId?: string | null): Promise<WorkspaceFeatures> {
  const tenant = await db.tenant.findUnique({ where: { id: tenantId }, select: { podSystemEnabled: true } });
  if (!tenant?.podSystemEnabled) return { podsEnabled: false };
  const unit = await db.businessUnit.findFirst({ where: { tenantId, ...(businessUnitId ? { id: businessUnitId } : { allowPods: true }), ...(branchId ? { branchId } : {}) }, select: { allowPods: true } });
  return workspaceFeatures(tenant.podSystemEnabled, unit?.allowPods);
}
export async function assertPodsEnabled(db: PrismaService, tenantId: string, businessUnitId?: string | null, branchId?: string | null) {
  if (!(await loadWorkspaceFeatures(db, tenantId, businessUnitId, branchId)).podsEnabled) throw new ForbiddenException('Recruitment pods are disabled for this workspace or operating unit.');
}
