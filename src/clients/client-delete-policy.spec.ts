import { canDeleteClient } from './client-delete-policy';

const user = (systemRole: string, permissions: string[]) => ({
  dbId: 'user-id',
  keycloakId: 'keycloak-id',
  email: 'user@example.com',
  fullName: 'Test User',
  roles: [systemRole],
  tenantId: 'tenant-id',
  isActive: true,
  systemRole,
  permissions,
});

describe('client delete policy', () => {
  it.each(['SUPER_ADMIN', 'TENANT_ADMIN', 'BRANCH_ADMIN', 'UNIT_ADMIN'])(
    'allows %s when the active role has client deletion permission',
    (role) => expect(canDeleteClient(user(role, ['client:delete']))).toBe(true),
  );

  it.each(['DELIVERY_HEAD', 'ACCOUNT_MANAGER', 'POD_LEAD', 'RECRUITER'])(
    'denies %s even when the active role has client deletion permission',
    (role) => expect(canDeleteClient(user(role, ['client:delete', 'tenant:manage']))).toBe(false),
  );

  it('denies an administrator without an explicit delete or tenant-management permission', () => {
    expect(canDeleteClient(user('BRANCH_ADMIN', ['client:view']))).toBe(false);
  });
});
