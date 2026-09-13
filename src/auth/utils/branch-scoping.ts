import { ForbiddenException } from '@nestjs/common';
import type { AuthUser } from '../interfaces/auth-user.interface';

/**
 * Checks whether a user has tenant-wide administrative authority.
 * Tenant Admins, Super Admins, or users with tenant:manage / tenant:settings permissions
 * have full cross-branch administrative capabilities.
 */
export function isTenantAdmin(user: AuthUser): boolean {
  if (!user) return false;
  const roles = user.roles || [];
  if (roles.includes('SUPER_ADMIN') || roles.includes('ADMIN')) return true;

  const sysRole = (user as any).systemRole;
  if (sysRole === 'SUPER_ADMIN' || sysRole === 'ADMIN' || sysRole === 'TENANT_ADMIN') return true;

  const perms = Array.isArray(user.permissions) ? user.permissions : [];
  if (perms.includes('tenant:manage') || perms.includes('tenant:settings')) return true;

  return false;
}

/**
 * Extracts all branch IDs assigned to the user.
 * Merges primary `branchId` with any multi-branch assignments in `assignedBranchIds`.
 */
export function getUserAssignedBranchIds(user: AuthUser): string[] {
  const branchIds = new Set<string>();
  if (user.branchId) branchIds.add(user.branchId);

  const assignedList = (user as any).assignedBranchIds;
  if (Array.isArray(assignedList)) {
    assignedList.forEach((id: string) => {
      if (id && typeof id === 'string') branchIds.add(id);
    });
  }

  return Array.from(branchIds);
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
