import { ForbiddenException } from '@nestjs/common';
import { AuthUser } from '../interfaces/auth-user.interface';
export function resolveBranchId(user?: AuthUser, headerBranchId?: string): string | null {
  const permissions = user?.permissions || [];
  const crossBranch = permissions.includes('*') || permissions.some(p => ['platform:manage', 'tenant:manage', 'tenant:settings', 'job:view_all_branches'].includes(p));
  const header = headerBranchId?.trim();
  const requested = header && !['all', 'null', 'undefined'].includes(header.toLowerCase()) ? header : null;
  if (crossBranch) return requested;
  if (!user?.branchId) throw new ForbiddenException('An assigned branch is required.');
  if (requested && requested !== user.branchId) throw new ForbiddenException('You can only access your assigned branch.');
  return user.branchId;
}
