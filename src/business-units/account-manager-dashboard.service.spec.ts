import { AccountManagerDashboardService } from './account-manager-dashboard.service';
import { DeliveryDashboardService } from './delivery-dashboard.service';
import type { AuthUser } from '../auth/interfaces/auth-user.interface';

describe('Account manager comparison', () => {
  const actor = { dbId: 'actor', tenantId: 'tenant', permissions: ['unit_admin:manage', 'user:manage', 'job:view', 'submission:view', 'submission:internal_screening', 'client:view'] } as AuthUser;
  let db: any;
  let service: AccountManagerDashboardService;
  const group = (finalStatus: string, count: number, l1Status = 'PENDING', l2Status: string | null = null, l3Status: string | null = null) => ({ finalStatus, l1Status, l2Status, l3Status, _count: { _all: count } });
  const manager = (id: string, joined = 0) => ({ id, name: `Manager ${id}`, email: 'manager@example.test', avatar: null, postedJobs: 3, activeJobs: 2, closedJobs: 1, positions: 5, submissions: joined, offers: 0, joined, undated: 0, undatedJoined: 0, undatedPosted: 0, groups: joined ? [group('JOIN', joined)] : [] });
  let result: { weekly: { bucket: number; count: number }[]; managers: ReturnType<typeof manager>[]; roster: never[]; unassignedJobs: number; clients: never[]; markets: never[]; employmentTypes: never[] };
  beforeEach(() => {
    result = { weekly: [], managers: [], roster: [], unassignedJobs: 1, clients: [], markets: [], employmentTypes: [] };
    db = { user: { findFirst: jest.fn().mockResolvedValue({ branchId: 'fresh-branch', businessUnitId: 'fresh-unit' }) },
      businessUnit: { findFirst: jest.fn().mockResolvedValue({ id: 'fresh-unit', name: 'IT', branch: { name: 'Office' } }) },
      $queryRaw: jest.fn().mockImplementation(async () => [result]) };
    service = new AccountManagerDashboardService(db, new DeliveryDashboardService(db));
  });

  it('returns top ten in deterministic outcome order and summaries across all managers', async () => {
    result.managers = Array.from({ length: 11 }, (_, i) => manager(String(i), i));
    const page = await service.dashboard(actor, {});
    expect(page.rows).toHaveLength(10);
    expect(page.rows[0].id).toBe('10');
    expect(page.rows[9].id).toBe('1');
    expect(page.total).toBe(11); expect(page.nextOffset).toBe(10);
    expect(page.summary).toEqual({ postedJobs: 33, activeJobs: 22, joined: 55, unassignedJobs: 1 });
    const rest = await service.dashboard(actor, { offset: 10, limit: 100, snapshot: page.snapshot });
    expect(rest.rows.map(row => row.id)).toEqual(['0']); expect(rest.nextOffset).toBeNull();
  });

  it.each([0, 10])('does not offer another page for %i managers', async count => {
    result.managers = Array.from({ length: count }, (_, i) => manager(String(i)));
    const page = await service.dashboard(actor, {});
    expect(page.total).toBe(count); expect(page.nextOffset).toBeNull();
  });

  it('uses canonical current-stage rules including terminal and legacy statuses', async () => {
    result.managers = [{ ...manager('a'), submissions: 35, offers: 6, joined: 7, groups: [group('PENDING_APPROVAL', 2), group('POD_APPROVED', 3), group('IN_PROGRESS', 4, 'CLEARED'),
      group('IN_PROGRESS', 5, 'CLEARED', 'CLEARED'), group('OFFER', 6), group('JOIN', 7), group('NOT_SELECTED', 8)] }];
    const { rows: [row] } = await service.dashboard(actor, {});
    expect(row).toMatchObject({ submissions: 35, review: 2, l1: 3, l2: 4, l3: 5, offers: 6, joined: 7, closed: 8, postedJobs: 3 });
  });

  it('rejects stale expansion snapshots instead of mixing changed result sets', async () => {
    result.managers = [manager('a', 1)];
    const page = await service.dashboard(actor, {});
    result.managers = [manager('a', 2)];
    await expect(service.dashboard(actor, { offset: 10, snapshot: page.snapshot })).rejects.toThrow('Dashboard changed');
  });

  it('refreshes membership and scopes SQL sources to tenant, branch and unit', async () => {
    await service.dashboard({ ...actor, branchId: 'stale', businessUnitId: 'foreign' }, { search: "O'Brien%" });
    const sql = db.$queryRaw.mock.calls[0][0];
    expect(sql.text).toContain('j.tenant_id ='); expect(sql.text).toContain('j.branch_id ='); expect(sql.text).toContain('j.business_unit_id =');
    expect(sql.text).toContain('s.tenant_id ='); expect(sql.text).toContain('u.tenant_id ='); expect(sql.text).toContain('cr.tenant_id =');
    expect(sql.values).toContain('fresh-unit'); expect(sql.values).not.toContain('foreign');
    expect(sql.values).toContain("O'Brien%"); expect(sql.text).not.toContain("O'Brien");
  });

  it('fails closed for missing scope or roster permission before querying metrics', async () => {
    await expect(service.dashboard({ ...actor, permissions: ['user:manage'] }, {})).rejects.toThrow('Unit management');
    await expect(service.dashboard({ ...actor, permissions: ['unit_admin:manage'] }, {})).rejects.toThrow('User management');
    db.user.findFirst.mockResolvedValue({ branchId: 'branch', businessUnitId: null });
    await expect(service.dashboard(actor, {})).rejects.toThrow('assignment');
    expect(db.$queryRaw).not.toHaveBeenCalled();
  });

  it('does not query submissions, disclose metrics or sort by hidden outcomes without read permissions', async () => {
    result.managers = [manager('a', 99)];
    const restricted = { ...actor, permissions: ['unit_admin:manage', 'user:manage'] };
    const page = await service.dashboard(restricted, { sort: 'name' });
    expect(page.rows[0]).toMatchObject({ postedJobs: null, activeJobs: null, submissions: null, review: null, joined: null });
    expect(page.summary.joined).toBeNull();
    expect(db.$queryRaw.mock.calls[0][0].text).not.toContain('JOIN ats.recruiter_submissions');
    await expect(service.dashboard(restricted, { sort: 'joined' })).rejects.toThrow('read permissions');
    await expect(service.dashboard(restricted, { market: 'US', sort: 'name' })).rejects.toThrow('read permissions');
  });

  it('redacts internal review counts without review permission', async () => {
    result.managers = [{ ...manager('a'), submissions: 9, groups: [group('PENDING_APPROVAL', 9)] }];
    const page = await service.dashboard({ ...actor, permissions: actor.permissions!.filter(p => p !== 'submission:internal_screening') }, {});
    expect(page.rows[0].review).toBeNull(); expect(page.rows[0].submissions).toBe(9);
  });

  it.each([{ limit: 101 }, { offset: -1 }, { sort: 'unknown' }, { direction: 'invalid' }, { accountManagerId: 'foreign' }, { from: 'bad', to: 'bad' }, { from: '2026-10-01T00:00:00.000Z' }, { from: '2026-11-01T00:00:00.000Z', to: '2026-10-01T00:00:00.000Z' }, { clientId: 'invalid' }, { snapshot: 'invalid' }, { search: ['array'] }])('validates malformed input %j', async input => {
    await expect(service.dashboard(actor, input as any)).rejects.toThrow('Invalid');
    expect(db.user.findFirst).not.toHaveBeenCalled();
  });

  it('sorts across the full roster in both directions before slicing', async () => {
    result.managers = Array.from({ length: 12 }, (_, i) => manager(String(i), i));
    const page = await service.dashboard(actor, { direction: 'asc' });
    expect(page.rows.map(row => row.joined)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it('projects identity and job metrics independently from current submission stage counts', async () => {
    result.managers = [{ ...manager('a', 7), avatar: null, closedJobs: 2, positions: 8, undated: 2, undatedPosted: 3 }];
    const page = await service.dashboard(actor, {});
    expect(page.rows[0]).toMatchObject({ email: 'manager@example.test', avatar: null, closedJobs: 2, positions: 8 });
    expect(page.undatedOutcomes).toBe(2); expect(page.undatedPostedJobs).toBe(3);
  });

  it('rejects sorting on the restricted review column', async () => {
    await expect(service.dashboard({ ...actor, permissions: actor.permissions!.filter(p => p !== 'submission:internal_screening') }, { sort: 'review' })).rejects.toThrow('read permissions');
  });

  it('ranks charts over the complete roster regardless of table sorting and pagination', async () => {
    result.managers = Array.from({ length: 14 }, (_, i) => manager(String(i).padStart(2, '0'), i));
    const page = await service.dashboard(actor, { sort: 'name' });
    expect(page.rows.map(row => row.id)).not.toContain('13');
    expect(page.charts!.closures[0]).toEqual({ id: '13', name: 'Manager 13', count: 13 });
    expect(page.charts!.closures).toHaveLength(5);
    expect((await service.dashboard(actor, { offset: 10 })).charts).toBeNull();
  });

  it('fills missing weekly intervals and uses exact partial interval boundaries', async () => {
    result.weekly = [{ bucket: 0, count: 4 }, { bucket: 2, count: 1 }];
    const page = await service.dashboard(actor, { from: '2020-01-01T00:00:00.000Z', to: '2020-01-20T00:00:00.000Z' });
    expect(page.charts!.weekly.map(week => week.count)).toEqual([4, 0, 1]);
    expect(page.charts!.weekly[2].to).toBe('2020-01-20T00:00:00.000Z');
    expect(page.charts!.weeklyScope).toBe('selected-period');
  });

  it('redacts review from chart data and ranking and suppresses unauthorized charts', async () => {
    result.managers = [{ ...manager('a'), groups: [group('PENDING_APPROVAL', 50)] }];
    const page = await service.dashboard({ ...actor, permissions: actor.permissions!.filter(permission => permission !== 'submission:internal_screening') }, {});
    expect(page.charts!.pipeline[0].review).toBeNull();
    expect((await service.dashboard({ ...actor, permissions: ['unit_admin:manage', 'user:manage'] }, { sort: 'name' })).charts).toBeNull();
  });
});
