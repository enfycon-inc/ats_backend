import { resolveBranchId } from './branch-resolver';
import { isTenantAdmin } from './branch-scoping';
describe('branch permission isolation', () => {
  const unit = { branchId: 'home', roles: ['TENANT_ADMIN'], systemRole: 'TENANT_ADMIN', permissions: ['unit_admin:manage'] } as any;
  it('ignores administrator labels without capabilities', () => { expect(isTenantAdmin(unit)).toBe(false); });
  it('rejects a foreign header and missing assignments', () => {
    expect(() => resolveBranchId(unit, 'foreign')).toThrow();
    expect(() => resolveBranchId({ ...unit, branchId: null })).toThrow();
    expect(resolveBranchId(unit, 'all')).toBe('home');
  });
  it('allows all-branch and explicit branch context with a capability', () => {
    const tenant = { ...unit, permissions: ['tenant:settings'] };
    expect(resolveBranchId(tenant, 'all')).toBeNull();
    expect(resolveBranchId(tenant, 'foreign')).toBe('foreign');
  });
});
