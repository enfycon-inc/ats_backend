import { AuthRbacService } from './auth-rbac.service';

describe('AuthRbacService default presence permission', () => {
  it('includes presence visibility when seeding a built-in tenant role', async () => {
    const query = jest.fn(async (sql: string) => {
      if (sql.includes('SELECT id, name, system_key, permissions FROM system_roles')) {
        return { rows: [{ id: 'system-role-id', name: 'Recruiter', system_key: 'RECRUITER', permissions: ['candidate:view'] }] };
      }
      if (sql.includes('SELECT id FROM custom_roles')) return { rows: [] };
      if (sql.includes('INSERT INTO custom_roles')) return { rows: [{ id: 'tenant-role-id' }] };
      return { rows: [] };
    });
    const service = new AuthRbacService({ query } as any);

    await service.seedTenantRoles('tenant-id');

    const permissionsWrite = query.mock.calls.find(([sql]) => String(sql).includes('UPDATE custom_roles SET permissions'));
    expect(permissionsWrite).toBeDefined();
    const permissions = JSON.parse(String(permissionsWrite?.[1]?.[0]));
    expect(permissions).toContain('candidate:view');
    expect(permissions).toContain('user:presence:view');
  });
});
