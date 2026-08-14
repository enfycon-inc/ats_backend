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
  const cleanHeader = headerBranchId ? headerBranchId.trim() : null;

  if (cleanHeader && cleanHeader !== 'ALL' && cleanHeader !== 'null' && cleanHeader !== 'undefined') {
    return cleanHeader;
  }

  return user?.branchId || null;
}
