import { ForbiddenException } from '@nestjs/common';

export function managesCurrentUnit(user: { permissions?: string[] } | undefined): boolean {
  const permissions = user?.permissions || [];
  return permissions.includes('unit_admin:manage') && !permissions.some(permission => ['tenant:settings', 'tenant:manage', 'platform:manage', 'branch_admin:manage'].includes(permission));
}

export function assertUnitJobScope(user: { permissions?: string[]; branchId?: string; businessUnitId?: string } | undefined, job: { branchId?: string | null; businessUnitId?: string | null }) {
  if (managesCurrentUnit(user) && (!user?.branchId || !user.businessUnitId || job.branchId !== user.branchId || job.businessUnitId !== user.businessUnitId)) throw new ForbiddenException('Job is outside your current unit.');
}
