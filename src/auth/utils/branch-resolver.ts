import { AuthUser } from '../interfaces/auth-user.interface';

/**
 * Centralized Branch Resolver Utility
 * 
 * Enforces active branch context scoping:
 * - If user has branch switching permission (ADMIN, SUPER_ADMIN, DELIVERY_HEAD),
 *   uses the active branch selected in the header (`x-branch-id`).
 * - Otherwise, strictly defaults to the user's primary assigned branch (`user.branchId`).
 */
export function resolveBranchId(user?: AuthUser, headerBranchId?: string): string | null {
  if (!user) return null;

  const canSwitchBranch =
    user.roles?.includes('ADMIN') ||
    user.roles?.includes('SUPER_ADMIN') ||
    user.roles?.includes('DELIVERY_HEAD') ||
    user.permissions?.includes('candidate:search_all_branches') ||
    user.permissions?.includes('job:view_all_branches');

  const cleanHeader = headerBranchId ? headerBranchId.trim() : null;

  if (canSwitchBranch && cleanHeader && cleanHeader !== 'ALL') {
    return cleanHeader;
  }

  return user.branchId || null;
}
