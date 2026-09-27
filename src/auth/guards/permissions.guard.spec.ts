import { PermissionsGuard } from './permissions.guard';
describe('explicit permissions', () => {
  const reflector = { getAllAndOverride: () => ['tenant:settings'] };
  const guard = new PermissionsGuard(reflector as any);
  const context = (user: any) => ({ getHandler: () => null, getClass: () => null, switchToHttp: () => ({ getRequest: () => ({ user }) }) } as any);
  it('does not grant company/SSO access by role label', () => {
    for (const role of ['ADMIN', 'TENANT_ADMIN', 'SUPER_ADMIN', 'UNIT_ADMIN']) expect(() => guard.canActivate(context({ roles: [role], permissions: [] }))).toThrow();
  });
  it('permits explicit tenant settings or platform capability', () => {
    expect(guard.canActivate(context({ roles: [], permissions: ['tenant:settings'] }))).toBe(true);
    expect(guard.canActivate(context({ roles: [], permissions: ['platform:manage'] }))).toBe(true);
  });
});
