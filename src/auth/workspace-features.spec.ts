import { assertPodsEnabled, loadWorkspaceFeatures, workspaceFeatures } from './workspace-features';
import { AuthUserService } from './services/auth-user.service';

describe('effective pod availability', () => {
  it.each([[true, true, true], [false, true, false], [true, false, false], [undefined, true, false], [true, undefined, false]])('tenant=%s unit=%s enables pods=%s', (tenant, unit, expected) => {
    expect(workspaceFeatures(tenant, unit).podsEnabled).toBe(expected);
  });
  it('reads live settings and scopes the unit to its tenant and branch', async () => {
    const db: any = { tenant: { findUnique: jest.fn().mockResolvedValue({ podSystemEnabled: true }) }, businessUnit: { findFirst: jest.fn().mockResolvedValue({ allowPods: false }) } };
    expect(await loadWorkspaceFeatures(db, 'tenant', 'unit', 'branch')).toEqual({ podsEnabled: false });
    expect(db.businessUnit.findFirst.mock.calls[0][0].where).toEqual({ id: 'unit', tenantId: 'tenant', branchId: 'branch' });
    await expect(assertPodsEnabled(db, 'tenant', 'unit')).rejects.toThrow('disabled');
    db.businessUnit.findFirst.mockResolvedValue({ allowPods: true });
    await expect(assertPodsEnabled(db, 'tenant', 'unit')).resolves.toBeUndefined();
    db.tenant.findUnique.mockResolvedValue({ podSystemEnabled: false });
    await expect(assertPodsEnabled(db, 'tenant', 'unit')).rejects.toThrow('disabled');
  });
  it.each([[true, true, true], [false, true, false], [true, false, false]])('exposes effective profile availability for tenant=%s unit=%s', async (tenant, unit, expected) => {
    const query = jest.fn().mockResolvedValue({ rows: [] }).mockResolvedValueOnce({ rows: [{ id: 'staff', tenant_id: 'tenant', business_unit_id: 'unit', pod_system_enabled: tenant, unit_allow_pods: unit }] });
    const service = new AuthUserService({ query } as any, {} as any, {} as any);
    expect((await service.getProfile('staff')).features.podsEnabled).toBe(expected);
  });
});
