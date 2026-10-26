import type { AuthUser } from '../auth/interfaces/auth-user.interface';

const CLIENT_DELETE_ADMIN_ROLES = new Set([
  'SUPER_ADMIN',
  'TENANT_ADMIN',
  'BRANCH_ADMIN',
  'UNIT_ADMIN',
]);

export function canDeleteClient(user: AuthUser): boolean {
  const role = String(user?.systemRole || '').toUpperCase().replace(/[\s-]+/g, '_');
  const permissions = Array.isArray(user?.permissions) ? user.permissions : [];
  const hasDeletePermission = [
    'client:delete',
    'tenant:settings',
    'tenant:manage',
    'platform:manage',
  ].some((permission) => permissions.includes(permission));

  return CLIENT_DELETE_ADMIN_ROLES.has(role) && hasDeletePermission;
}
