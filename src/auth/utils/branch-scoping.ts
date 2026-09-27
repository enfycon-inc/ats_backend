import { ForbiddenException } from '@nestjs/common';
import type { AuthUser } from '../interfaces/auth-user.interface';

/**
 * Checks whether a user has tenant-wide administrative authority.
 * Tenant Admins, Super Admins, or users with tenant:manage / tenant:settings permissions
 * have full cross-branch administrative capabilities.
 */
export function isTenantAdmin(user: AuthUser): boolean {
  if (!user) return false;
  const perms = Array.isArray(user.permissions) ? user.permissions : [];
  if (perms.includes('tenant:manage') || perms.includes('tenant:settings') || perms.includes('platform:manage')) return true;

  return false;
}

export function getUserAssignedBranchIds(user: AuthUser): string[] {
  return user.branchId ? [user.branchId] : [];
}

/**
 * Enforces that a non-tenant admin is strictly operating within their assigned branch(es).
 * Throws a ForbiddenException if the targetBranchId is not in the user's assigned branches.
 */
export function validateBranchAccess(user: AuthUser, targetBranchId?: string | null, actionDescription = 'perform this action'): void {
  if (isTenantAdmin(user)) return;

  const assigned = getUserAssignedBranchIds(user);
  if (!targetBranchId || !assigned.includes(targetBranchId)) {
    throw new ForbiddenException(
      `Access denied. You can only ${actionDescription} for your assigned branch office.`
    );
  }
}
