import {
  canGrantRequestedRole,
  canReviewRoleRequest,
} from './role-request-policy';

describe('role request reviewer policy', () => {
  const target = {
    id: 'requester',
    tenant_id: 'tenant',
    branch_id: 'branch',
    business_unit_id: 'unit',
  };
  const actor = {
    dbId: 'reviewer',
    tenantId: 'tenant',
    branchId: 'branch',
    businessUnitId: 'unit',
    permissions: ['user:manage', 'candidate:view'],
  };
  const role = {
    id: 'role',
    permissions: ['candidate:view'],
    branch_id: 'branch',
    business_unit_id: 'unit',
  };
  it('permits a custom-role reviewer with explicit permission in the same office', () => {
    expect(canReviewRoleRequest(actor, target)).toBe(true);
    expect(canGrantRequestedRole(actor, role, target)).toBe(true);
  });
  it.each([
    { ...actor, dbId: 'requester' },
    { ...actor, tenantId: 'other' },
    { ...actor, branchId: 'other' },
    { ...actor, businessUnitId: 'other' },
    { ...actor, permissions: [] },
    { ...actor, branchId: undefined },
  ])(
    'excludes self, foreign tenants/offices, missing scope and missing permission',
    (candidate) => {
      expect(canReviewRoleRequest(candidate, target)).toBe(false);
    },
  );
  it('does not grant workspace-wide requests to a branch-only reviewer', () => {
    expect(
      canReviewRoleRequest(actor, {
        ...target,
        branch_id: null,
        business_unit_id: null,
      }),
    ).toBe(false);
  });
  it('requires user management capability even for tenant settings reviewers', () => {
    expect(
      canReviewRoleRequest(
        { ...actor, permissions: ['tenant:settings'] },
        target,
      ),
    ).toBe(false);
  });
  it('allows a tenant reviewer across offices without crossing tenants', () => {
    const admin = { ...actor, permissions: ['user:manage', 'tenant:manage'] };
    expect(canReviewRoleRequest(admin, { ...target, branch_id: 'other' })).toBe(
      true,
    );
    expect(canReviewRoleRequest(admin, { ...target, tenant_id: 'other' })).toBe(
      false,
    );
  });
  it('blocks granting permissions or office scope beyond the reviewer', () => {
    expect(
      canGrantRequestedRole(
        actor,
        { ...role, permissions: ['tenant:manage'] },
        target,
      ),
    ).toBe(false);
    expect(
      canGrantRequestedRole(
        actor,
        { ...role, business_unit_id: 'other' },
        target,
      ),
    ).toBe(false);
    expect(
      canGrantRequestedRole(
        actor,
        { ...role, permissions: '{invalid}' },
        target,
      ),
    ).toBe(false);
  });
  it('respects existing administrative-role assignment restrictions', () => {
    const head = {
      ...actor,
      systemRole: 'DELIVERY_HEAD',
      permissions: ['user:manage', 'unit_admin:manage', 'job:approve'],
    };
    expect(
      canGrantRequestedRole(
        head,
        { ...role, permissions: ['unit_admin:manage'] },
        target,
      ),
    ).toBe(false);
    expect(
      canGrantRequestedRole(head, { ...role, permissions: [] }, target),
    ).toBe(true);
  });
});
