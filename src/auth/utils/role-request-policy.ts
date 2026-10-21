import type { AuthUser } from '../interfaces/auth-user.interface';
import { assertRoleAssignmentAllowed } from './admin-role-assignment-policy';

export type RequestScope = {
  id?: string;
  tenant_id: string;
  branch_id?: string | null;
  business_unit_id?: string | null;
};
export type RequestedRole = {
  id: string;
  name?: string;
  system_role?: string | null;
  permissions: unknown;
  branch_id?: string | null;
  business_unit_id?: string | null;
};

export function permissionList(value: unknown): string[] {
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value);
    } catch {
      return [];
    }
  }
  return Array.isArray(value)
    ? value.filter((p): p is string => typeof p === 'string')
    : [];
}

export function canReviewRoleRequest(
  actor: Pick<
    AuthUser,
    'dbId' | 'tenantId' | 'permissions' | 'branchId' | 'businessUnitId'
  >,
  target: RequestScope,
): boolean {
  const p = actor.permissions || [];
  if (target.id && actor.dbId === target.id) return false;
  if (actor.tenantId !== target.tenant_id) return false;
  if (!p.some((key) => ['user:manage', '*', 'platform:manage'].includes(key)))
    return false;
  if (
    p.some((key) =>
      ['*', 'platform:manage', 'tenant:manage', 'tenant:settings'].includes(
        key,
      ),
    )
  )
    return true;
  if (!actor.branchId || actor.branchId !== target.branch_id) return false;
  if (actor.businessUnitId && actor.businessUnitId !== target.business_unit_id)
    return false;
  if (
    p.includes('unit_admin:manage') &&
    !p.includes('branch_admin:manage') &&
    (!actor.businessUnitId || actor.businessUnitId !== target.business_unit_id)
  )
    return false;
  return true;
}

export function canGrantRequestedRole(
  actor: Partial<AuthUser>,
  role: RequestedRole,
  scope: RequestScope,
): boolean {
  if (
    (role.branch_id && role.branch_id !== scope.branch_id) ||
    (role.business_unit_id && role.business_unit_id !== scope.business_unit_id)
  )
    return false;
  let permissions: unknown = role.permissions;
  if (typeof permissions === 'string') {
    try {
      permissions = JSON.parse(permissions);
    } catch {
      return false;
    }
  }
  if (
    !Array.isArray(permissions) ||
    permissions.some((p) => typeof p !== 'string')
  )
    return false;
  try {
    assertRoleAssignmentAllowed(
      actor,
      { ...role, permissions },
      { branchId: scope.branch_id, businessUnitId: scope.business_unit_id },
    );
  } catch {
    return false;
  }
  const p = actor.permissions || [];
  if (
    p.some((key) =>
      ['*', 'platform:manage', 'tenant:manage', 'tenant:settings'].includes(
        key,
      ),
    )
  )
    return true;
  return permissions.every((key) => p.includes(key));
}
