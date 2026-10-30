import { RecruiterPerformanceService } from './recruiter-performance.service';
import { DeliveryDashboardService } from './delivery-dashboard.service';
import type { AuthUser } from '../auth/interfaces/auth-user.interface';
describe('Recruiter performance boundary', () => {
  const id = '00000000-0000-0000-0000-000000000100';
  const actor = {
    dbId: 'actor',
    tenantId: 'tenant',
    permissions: [
      'unit_admin:manage',
      'user:manage',
      'job:view',
      'submission:view',
      'submission:internal_screening',
      'pod:view',
    ],
  } as AuthUser;
  let db: any, service: RecruiterPerformanceService, result: any;
  beforeEach(() => {
    result = {
      rows: [],
      roster: [],
      pods: [],
      activeJobs: 0,
      unattributed: 0,
      weekly: [],
    };
    db = {
      user: {
        findFirst: jest
          .fn()
          .mockResolvedValue({
            branchId: 'fresh-branch',
            businessUnitId: 'fresh-unit',
          }),
      },
      businessUnit: {
        findFirst: jest
          .fn()
          .mockResolvedValue({
            id: 'fresh-unit',
            name: 'Staffing',
            allowPods: true,
          }),
      },
      tenant: {
        findUnique: jest.fn().mockResolvedValue({ podSystemEnabled: true }),
      },
      $queryRaw: jest.fn().mockImplementation(async () => [result]),
    };
    service = new RecruiterPerformanceService(
      db,
      new DeliveryDashboardService(db),
    );
  });
  it.each([
    { limit: 101 },
    { offset: -1 },
    { sort: 'unknown' },
    { from: 'bad', to: 'bad' },
    { from: '2026-10-02T00:00:00.000Z', to: '2026-10-01T00:00:00.000Z' },
    { recruiterId: 'website' },
    { snapshot: 'bad' },
  ])('rejects malformed filters before queries: %j', async (filters) => {
    await expect(service.dashboard(actor, filters as any)).rejects.toThrow(
      'Invalid',
    );
    expect(db.$queryRaw).not.toHaveBeenCalled();
  });
  it('refreshes membership and parameterizes source scope and search', async () => {
    await service.dashboard(
      { ...actor, businessUnitId: 'stale' },
      { search: "O'Brien%" },
    );
    const q = db.$queryRaw.mock.calls[0][0];
    expect(q.values).toContain('fresh-unit');
    expect(q.values).not.toContain('stale');
    expect(q.values).toContain("O'Brien%");
    expect(q.text).not.toContain("O'Brien");
    expect(q.text).toContain('s.recruiter_id::text');
    expect(q.text).not.toContain('s.recruiter_id::uuid');
    expect(q.text).toContain('c.deleted_at IS NULL');
  });
  it('requires unit and roster capabilities independently', async () => {
    await expect(
      service.dashboard({ ...actor, permissions: ['user:manage'] }, {}),
    ).rejects.toThrow('Unit management');
    await expect(
      service.dashboard({ ...actor, permissions: ['unit_admin:manage'] }, {}),
    ).rejects.toThrow('User management');
    expect(db.$queryRaw).not.toHaveBeenCalled();
  });
  it('rejects missing capability sorts and pod filtering', async () => {
    await expect(
      service.dashboard(
        { ...actor, permissions: ['unit_admin:manage', 'user:manage'] },
        { sort: 'submissions' },
      ),
    ).rejects.toThrow('Additional');
    await expect(
      service.dashboard(
        {
          ...actor,
          permissions: actor.permissions.filter((p) => p !== 'pod:view'),
        },
        { podId: id },
      ),
    ).rejects.toThrow('Additional');
  });
  it('sorts the full roster before slicing, zero-fills weeks, and retains unique job total', async () => {
    result.rows = Array.from({ length: 12 }, (_, i) => ({
      id: String(i),
      name: `Recruiter ${i}`,
      submissions: i,
      joined: i,
      offers: 0,
      directActive: 1,
      sharedJobs: 2,
      groups: [],
      undated: 0,
    }));
    result.activeJobs = 3;
    const page = await service.dashboard(actor, {});
    expect(page.rows[0].joined).toBe(11);
    expect(page.total).toBe(12);
    expect(page.nextOffset).toBe(10);
    expect(page.summary.activeJobs).toBe(3);
    expect(page.summary.submissions).toBe(66);
    expect(page.charts?.submissions.length).toBeGreaterThan(0);
    const rest = await service.dashboard(actor, {
      offset: 10,
      snapshot: page.snapshot,
    });
    expect(rest.rows).toHaveLength(2);
    result.rows[0].joined = 99;
    await expect(
      service.dashboard(actor, { offset: 10, snapshot: page.snapshot }),
    ).rejects.toThrow('changed');
  });
  it('hides metrics rather than fabricating zeroes when read capabilities are absent', async () => {
    result.rows = [{ id, name: 'Recruiter', groups: [], undated: 0 }];
    const r = await service.dashboard(
      { ...actor, permissions: ['unit_admin:manage', 'user:manage'] },
      { sort: 'name' },
    );
    expect(r.summary.activeJobs).toBeNull();
    expect(r.rows[0].submissions).toBeNull();
    expect(r.charts).toBeNull();
  });
  it('does not fallback to another recruiter for an unavailable detail ID', async () => {
    await expect(service.detail(actor, id)).rejects.toThrow('unavailable');
  });
});
