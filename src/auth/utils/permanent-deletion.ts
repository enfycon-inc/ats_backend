import { ForbiddenException } from '@nestjs/common';
import type { AuthUser } from '../interfaces/auth-user.interface';

/** Permanent deletion is tenant administration, never an ordinary edit capability. */
export function assertPermanentDeletion(actor: Partial<AuthUser>, tenantId: string) {
  const permissions = actor.permissions || [];
  const platform = permissions.includes('*') || permissions.includes('platform:manage');
  if ((!platform && actor.tenantId !== tenantId) ||
      !permissions.some(p => ['*', 'platform:manage', 'tenant:settings', 'tenant:manage'].includes(p))) {
    throw new ForbiddenException('Tenant administration permission is required to permanently delete records.');
  }
}
