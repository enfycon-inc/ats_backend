import { ForbiddenException, ConflictException } from '@nestjs/common';
import type { AuthUser } from '../interfaces/auth-user.interface';
import { isDeliveryHead } from './admin-role-assignment-policy';

export function isCurrentUnitManager(actor: AuthUser) {
  const permissions = actor.permissions || [];
  return !isDeliveryHead(actor)
    && permissions.includes('unit_admin:manage')
    && !permissions.some(permission => ['tenant:manage', 'tenant:settings', 'platform:manage', 'branch_admin:manage'].includes(permission));
}

export function assertUnitPendingRequest(actor: AuthUser, target: { tenant_id: string; branch_id?: string; business_unit_id?: string; is_approved?: boolean; requested_role?: string | null }) {
  if (!isCurrentUnitManager(actor)) return;
  if (!actor.branchId || !actor.businessUnitId || target.tenant_id !== actor.tenantId || target.branch_id !== actor.branchId || target.business_unit_id !== actor.businessUnitId) throw new ForbiddenException('This request is outside your current unit.');
  if (target.is_approved !== false || !target.requested_role) throw new ConflictException('This user request is no longer pending.');
}
