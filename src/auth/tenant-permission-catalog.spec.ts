import { effectiveTenantPermissions, tenantPermissionCatalog } from './tenant-permission-catalog';

describe('tenant administration permission bundle', () => {
  it('grants every catalogued tenant capability without granting platform access', () => {
    const permissions = effectiveTenantPermissions(['tenant:settings']);
    for (const item of tenantPermissionCatalog()) {
      if (item.id !== 'platform:manage') expect(permissions).toContain(item.id);
    }
    expect(permissions).not.toContain('platform:manage');
    expect(permissions).not.toContain('*');
  });

  it('preserves explicit platform permissions for platform administrators', () => {
    expect(effectiveTenantPermissions(['tenant:settings', 'platform:manage'])).toContain('platform:manage');
  });

  it('does not elevate scoped staff roles', () => {
    expect(effectiveTenantPermissions(['unit_admin:manage', 'user:manage'])).toEqual(['unit_admin:manage', 'user:manage']);
  });
});
