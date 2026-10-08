import { AuthKeycloakService } from './auth-keycloak.service';

describe('Keycloak role synchronization after role removal', () => {
  const bdm = 'd7746edf-4e8a-4a9a-866b-7d5b90896003';
  const admin = '27d2659a-76de-4160-832e-a8bc60a6b6fa';
  const input = { keycloakId: 'subject', email: 'am@deb.com', fullName: 'Account Manager', roles: ['BRANCH_ADMIN', 'DELIVERY_HEAD'] };

  function setup(assigned: boolean) {
    const user = { id: 'user', tenant_id: 'tenant', role_id: assigned ? bdm : null, assigned_role_ids: assigned ? [bdm] : [], is_active: true };
    const query = jest.fn(async (sql: string) => {
      if (sql.startsWith('SELECT id, tenant_id') || sql.trim().startsWith('UPDATE users')) return { rows: [user] };
      if (sql.includes('SELECT cr.permissions')) {
        // A legacy JWT-name OR condition would restore admin capabilities.
        return { rows: sql.includes('UPPER(cr.name)') ? [{ permissions: ['branch_admin:manage'] }] : assigned ? [{ permissions: ['job:view'], system_permissions: ['submission:audit_l2'] }] : [] };
      }
      if (sql.includes('UPPER(cr.name)')) return { rows: [{ id: admin, name: 'Branch Admin', system_role: 'BRANCH_ADMIN' }] };
      if (sql.includes('WHERE cr.id = ANY')) return { rows: assigned ? [{ id: bdm, name: 'BDM', system_role: 'ACCOUNT_MANAGER' }] : [] };
      return { rows: [] };
    });
    return new AuthKeycloakService({ query } as any);
  }

  it('uses only current database roles and permissions for an existing user', async () => {
    const result = await setup(true).syncKeycloakUser(input);
    expect(result.roles).toEqual(expect.arrayContaining(['BDM']));
    expect(result.roles).not.toContain('BRANCH_ADMIN');
    expect(result.roles).not.toContain('DELIVERY_HEAD');
    expect(result.permissions).toEqual(expect.arrayContaining(['job:view', 'submission:audit_l2']));
  });

  it('does not repopulate an intentionally empty role assignment from a stale token', async () => {
    const result = await setup(false).syncKeycloakUser(input);
    expect(result.roles).toEqual([]);
    expect(result.permissions).toEqual([]);
  });
});
