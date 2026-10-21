import { ForbiddenException } from '@nestjs/common';
import type { AuthUser } from '../interfaces/auth-user.interface';
import { activeManagementRole } from '../user-management-policy';

const ELEVATED_ADMIN_PERMISSIONS = new Set([
  'tenant:settings',
  'tenant:manage',
  'platform:manage',
  'branch_admin:manage',
  'unit_admin:manage',
]);

function normalize(value?: string | null) {
  return String(value || '').toUpperCase().replace(/[\s-]/g, '_');
}

export function isDeliveryHead(actor: Partial<AuthUser>) {
  return activeManagementRole(actor) === 'DELIVERY_HEAD';
}

export function isUnitAdmin(actor: Partial<AuthUser>) {
  if (isDeliveryHead(actor)) return false;
  const permissions = actor.permissions || [];
  const hasHigherAdminScope = permissions.some(permission =>
    ['tenant:settings', 'tenant:manage', 'platform:manage', 'branch_admin:manage'].includes(permission),
  );
  return normalize(actor.systemRole) === 'UNIT_ADMIN'
    || (permissions.includes('unit_admin:manage') && !hasHigherAdminScope);
}

export function isAdministrativeRole(role: {
  system_role?: string | null;
  name?: string | null;
  permissions?: unknown;
}) {
  const key = normalize(role.system_role || role.name);
  if (['TENANT_ADMIN', 'SUPER_ADMIN', 'BRANCH_ADMIN', 'UNIT_ADMIN'].includes(key)) return true;
  const permissions = typeof role.permissions === 'string'
    ? JSON.parse(role.permissions)
    : role.permissions;
  return Array.isArray(permissions) && permissions.some(permission =>
    ELEVATED_ADMIN_PERMISSIONS.has(permission),
  );
}

/**
 * Keep Delivery Heads out of role administration and constrain Unit Admins to
 * assigning only unit-scoped administration within their own unit.
 */
export function assertRoleManagementAccess(actor: Partial<AuthUser>) {
  if (isDeliveryHead(actor)) {
    throw new ForbiddenException('Delivery Heads cannot manage roles or permissions.');
  }
}

export function assertRoleAssignmentAllowed(
  actor: Partial<AuthUser>,
  role: { system_role?: string | null; name?: string | null; permissions?: unknown; branch_id?: string | null; business_unit_id?: string | null },
  target?: { branchId?: string | null; businessUnitId?: string | null },
) {
  if (!isAdministrativeRole(role)) return;

  if (isDeliveryHead(actor)) {
    throw new ForbiddenException('Delivery Heads cannot assign administrative roles.');
  }

  if (isUnitAdmin(actor)) {
    const roleKey = normalize(role.system_role || role.name);
    const rawPermissions = typeof role.permissions === 'string'
      ? JSON.parse(role.permissions)
      : role.permissions;
    const permissions = Array.isArray(rawPermissions) ? rawPermissions : [];
    const allowedPermissions = new Set(actor.permissions || []);
    const hasOnlyUnitAdminScope = roleKey === 'UNIT_ADMIN'
      && !permissions.some(permission =>
        ['tenant:settings', 'tenant:manage', 'platform:manage', 'branch_admin:manage'].includes(permission),
      )
      && permissions.every(permission => allowedPermissions.has(permission));
    if (!hasOnlyUnitAdminScope) {
      throw new ForbiddenException('Unit Admins may assign only Unit Admin access within their own unit.');
    }
    if (!actor.branchId || !actor.businessUnitId
      || target?.branchId !== actor.branchId
      || target?.businessUnitId !== actor.businessUnitId
      || (role.branch_id && role.branch_id !== actor.branchId)
      || (role.business_unit_id && role.business_unit_id !== actor.businessUnitId)) {
      throw new ForbiddenException('Unit Admin access can only be assigned within your current unit.');
    }
  }
}
