import { managementScope, hasCapability, requireCapability, deviceLabel } from './management-policy';
const actor: any = { dbId: 'actor', tenantId: 'tenant', branchId: 'branch', businessUnitId: 'unit', permissions: ['user:presence:view'] };
describe('User telemetry resource scope', () => {
  it('isolates a delivery viewer to tenant, branch and unit without relying on a role name', () => {
    const scope = managementScope({ ...actor, roles: ['TENANT_ADMIN'] });
    expect(scope.sql).toContain('u.tenant_id = $1::uuid');
    expect(scope.sql).toContain('u.branch_id = ANY($2::uuid[])');
    expect(scope.sql).toContain('u.business_unit_id = $3::uuid');
    expect(scope.values).toEqual(['tenant', ['branch'], 'unit']);
  });
  it('never removes the tenant restriction for a tenant-wide capability', () => {
    expect(managementScope({ ...actor, permissions: ['tenant:manage'] })).toEqual({ sql: 'u.tenant_id = $1::uuid', values: ['tenant'] });
  });
  it('fails closed for a missing branch and limits a missing unit to self', () => {
    expect(managementScope({ ...actor, branchId: undefined }).sql).toContain('FALSE');
    expect(managementScope({ ...actor, businessUnitId: undefined }).sql).toContain('u.id');
  });
  it('limits a multi-branch manager to assigned branches', () => {
    const scope = managementScope({ ...actor, permissions: ['branch_admin:manage'], assignedBranchIds: ['branch-a', 'branch-b'] });
    expect(scope.sql).toContain('ANY($2::uuid[])');
    expect(scope.values).toEqual(['tenant', ['branch-a', 'branch-b', 'branch']]);
  });
  it('does not treat user management or tenant settings as permission to read IPs', () => {
    for (const permissions of [['user:manage'], ['tenant:settings']]) {
      expect(hasCapability({ ...actor, permissions }, 'user:session_ip:view')).toBe(false);
      expect(() => requireCapability({ ...actor, permissions }, 'user:session_ip:view')).toThrow();
    }
  });
  it('recognises inferred browser labels and never returns arbitrary user agent text', () => {
    expect(deviceLabel('Chrome/123 Windows')).toBe('Chrome · Windows');
    expect(deviceLabel('Edg/123 Windows Chrome/123')).toBe('Edge · Windows');
    expect(deviceLabel('<script>untrusted device</script>')).toBe('Unknown browser · Unknown OS');
  });
});
