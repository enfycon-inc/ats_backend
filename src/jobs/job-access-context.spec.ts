import { loadJobActor, rowJobScope } from './job-access-context';
import { jobCapabilities } from './job-action-policy';

describe('live job assignment context', () => {
  const actor: any = { dbId: 'staff', tenantId: 'tenant', branchId: 'old-branch', businessUnitId: 'old-unit', podId: 'old-pod', permissions: ['job:view', 'candidate:view', 'submission:create', 'job:find_matches_assigned', 'job:submit_pod_jobs'] };
  const row = { status: 'Active', approval_status: 'APPROVED', branch_id: 'branch', business_unit_id: 'unit', recruiter_ids: 'staff', pod_id: 'pod' };
  function database(member: any, enabled = false) {
    return { user: { findFirst: jest.fn().mockResolvedValue(member) }, tenant: { findUnique: jest.fn().mockResolvedValue({ podSystemEnabled: enabled }) }, businessUnit: { findFirst: jest.fn().mockResolvedValue({ allowPods: enabled }) } } as any;
  }
  it('refreshes membership and resolves an entire page without per-row lookups', async () => {
    const db = database({ branchId: 'branch', businessUnitId: 'unit', podId: 'pod' });
    const context = await loadJobActor(db, actor);
    for (let i = 0; i < 25; i++) expect(jobCapabilities(context.actor, rowJobScope(row, 'tenant', context)).submitCandidate).toBe(true);
    expect(db.user.findFirst).toHaveBeenCalledTimes(1);
    expect(db.tenant.findUnique).toHaveBeenCalledTimes(1);
    expect(db.businessUnit.findFirst).not.toHaveBeenCalled();
    expect(jobCapabilities(context.actor, rowJobScope({ ...row, recruiter_ids: '', pod_id: 'old-pod' }, 'tenant', context)).findMatches).toBe(false);
  });
  it('retains direct assignment while disabling retained pod history', async () => {
    const context = await loadJobActor(database({ branchId: 'branch', businessUnitId: 'unit', podId: 'pod' }), actor);
    expect(jobCapabilities(context.actor, rowJobScope(row, 'tenant', context)).findMatches).toBe(true);
    expect(jobCapabilities(context.actor, rowJobScope({ ...row, recruiter_ids: '' }, 'tenant', context)).findMatches).toBe(false);
  });
  it('does not retain administrative access for removed or inactive membership', async () => {
    await expect(loadJobActor(database(null), { ...actor, permissions: ['tenant:manage'] })).rejects.toThrow('membership');
  });
});
