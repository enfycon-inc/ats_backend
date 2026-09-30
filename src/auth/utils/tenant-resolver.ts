import { UnauthorizedException, ForbiddenException } from '@nestjs/common';
import type { AuthUser } from '../interfaces/auth-user.interface';

const DEFAULT_TENANT_ID = process.env.DEFAULT_TENANT_ID as string;

/**
 * Centralized Tenant Resolver Utility
 * 
 * Enforces strict tenant isolation:
 * - If user is SUPER_ADMIN, allows using incoming `headerTenantId` for tenant impersonation / multi-tenant management.
 * - If user is NOT SUPER_ADMIN, strictly returns `user.tenantId`. Any attempt to override `tenantId` via header is denied.
 */
export function resolveTenantId(user?: AuthUser, headerTenantId?: string): string {
  if (!user) {
    throw new UnauthorizedException('Authentication context is required for tenant resolution.');
  }

  const isSuperAdmin = Array.isArray(user.roles) && user.roles.some(
    (role) => role.toUpperCase() === 'SUPER_ADMIN'
  );

  const cleanHeader = headerTenantId ? headerTenantId.trim() : undefined;

  if (isSuperAdmin) {
    if (cleanHeader) {
      return cleanHeader;
    }
    return user.tenantId || DEFAULT_TENANT_ID;
  }

  // Non-Super-Admin Users:
  // If an arbitrary header was passed that differs from user's tenantId, throw ForbiddenException
  if (cleanHeader && cleanHeader !== user.tenantId) {
    throw new ForbiddenException('Cross-tenant data access is denied.');
  }

  if (!user.tenantId) {
    return DEFAULT_TENANT_ID;
  }

  return user.tenantId;
}
