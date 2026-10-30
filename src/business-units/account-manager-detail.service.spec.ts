import { AccountManagerDetailService } from './account-manager-detail.service';
import type { AuthUser } from '../auth/interfaces/auth-user.interface';

describe('Individual account manager performance', () => {
  const id = '00000000-0000-0000-0000-000000000100';
  const where = { tenantId: 'tenant', branchId: 'fresh-branch', businessUnitId: 'fresh-unit' };
  const actor = { dbId: 'viewer', tenantId: 'tenant', branchId: 'stale', businessUnitId: 'stale', permissions: ['unit_admin:manage', 'user:manage', 'client:view', 'job:view', 'submission:view', 'submission:internal_screening'] } as AuthUser;
  let prisma: any, comparison: any, delivery: any, service: AccountManagerDetailService;
  beforeEach(() => {
    prisma = { tenant: { findUnique: jest.fn().mockResolvedValue({ clientsVisibleAcrossUnits: false, bdmClientsTenantWide: false }) },
      user: { findMany: jest.fn().mockResolvedValue([{ id, email: 'manager@example.test' }]) },
      client: { findMany: jest.fn().mockResolvedValue([
        { id: 'added', clientName: 'Added Client', createdBy: id, createdAt: new Date('2020-01-03'), status: 'Active' },
        { id: 'portfolio', clientName: 'Portfolio Client', createdBy: 'someone-else', createdAt: new Date('2019-01-03'), status: 'Active' },
      ]) }, $queryRaw: jest.fn().mockResolvedValue([{ submissions: [{ bucket: 0, count: 3 }], jobs: [
        { id: 'job', title: 'Engineer', code: 'JOB-1', status: 'Active', clientId: 'portfolio', employmentType: 'Full Time', positions: 2, postedJobs: 1, postedPositions: 2,
          submissions: 3, allSubmissions: 3, offers: 1, joined: 1, groups: [{ finalStatus: 'PENDING_APPROVAL', l1Status: 'PENDING', l2Status: null, l3Status: null, _count: { _all: 2 } }] },
      ] }]) };
    delivery = { scope: jest.fn().mockResolvedValue({ where, unit: { id: 'fresh-unit', name: 'Staffing' } }) };
    comparison = { dashboard: jest.fn().mockResolvedValue({ rows: [{ id, name: 'Manager', review: 2 }], unit: { id: 'fresh-unit', name: 'Staffing', branchName: 'Office' },
      charts: { pipeline: [{ id, name: 'Manager', review: 2, l1: 0, l2: 0, l3: 0, offers: 0 }], weekly: [] },
      options: { employmentTypes: ['Full Time'] }, undatedOutcomes: 0, undatedPostedJobs: 0 }) };
    service = new AccountManagerDetailService(prisma, delivery, comparison);
  });
  it('separates recorded client creator from delivery ownership and includes added clients with no jobs', async () => {
    const page = await service.detail(actor, id, { from: '2020-01-01T00:00:00.000Z', to: '2020-02-01T00:00:00.000Z' });
    expect(page.clients.added).toBe(1); expect(page.clients.portfolio).toBe(1);
    expect(page.clients.rows).toEqual([expect.objectContaining({ id: 'added', addedByManager: true, postedJobs: 0, joined: 0 })]);
    expect(page.weekly.clientsAdded!.reduce((sum, week) => sum + week.count, 0)).toBe(1);
    const portfolio = await service.detail(actor, id, { clientMode: 'portfolio' });
    expect(portfolio.clients.rows).toEqual([expect.objectContaining({ id: 'portfolio', addedByManager: false, postedJobs: 1, joined: 1, review: 2 })]);
    expect(portfolio.jobs.rows[0].clientName).toBe('Portfolio Client');
  });
  it('reuses fresh scope and the real client-directory unit ownership policy', async () => {
    await service.detail(actor, id, {});
    expect(comparison.dashboard).toHaveBeenCalledWith(actor, expect.objectContaining({ accountManagerId: id }), expect.objectContaining({ where }));
    expect(prisma.user.findMany).toHaveBeenCalledWith(expect.objectContaining({ where }));
    const clientQuery = JSON.stringify(prisma.client.findMany.mock.calls[0][0]);
    expect(clientQuery).toContain('fresh-branch'); expect(clientQuery).toContain('primaryOwner'); expect(clientQuery).toContain('deletedAt');
    const sql = prisma.$queryRaw.mock.calls[0][0];
    expect(sql.values).toContain('fresh-unit'); expect(sql.values).not.toContain('stale'); expect(sql.text).toContain('s.tenant_id =');
  });
  it('does not fall back to another manager or expose foreign manager/client details', async () => {
    comparison.dashboard.mockResolvedValueOnce({ rows: [] });
    await expect(service.detail(actor, id, {})).rejects.toThrow('unavailable');
    expect(prisma.client.findMany).not.toHaveBeenCalled(); expect(prisma.$queryRaw).not.toHaveBeenCalled();
    await expect(service.detail(actor, id, { clientId: 'foreign' })).rejects.toThrow('unavailable');
  });
  it('keeps restricted metrics null and does not query unauthorized client records', async () => {
    const page = await service.detail({ ...actor, permissions: ['unit_admin:manage', 'user:manage', 'job:view'] }, id, {});
    expect(page.jobs.rows[0]).toMatchObject({ submissions: null, review: null, offers: null, joined: null, clientId: null, clientName: null });
    expect(page.weekly.submissions).toBeNull(); expect(page.weekly.clientsAdded).toBeNull();
    expect(prisma.client.findMany).not.toHaveBeenCalled();
  });
  it('supports job-level attention filters without changing manager totals', async () => {
    const page = await service.detail(actor, id, { attention: 'review' });
    expect(page.jobs.total).toBe(1); expect(page.attention.pendingReview).toBe(2);
    expect((await service.detail(actor, id, { attention: 'uncovered' })).jobs.total).toBe(0);
    await expect(service.detail({ ...actor, permissions: ['unit_admin:manage', 'user:manage', 'job:view'] }, id, { attention: 'review' })).rejects.toThrow('permissions');
  });
  it.each([{ jobPage: 0 }, { clientPage: NaN }, { clientMode: 'all' }, { jobStatus: 'not-a-status' }, { jobSearch: ['bad'] }])('rejects invalid table filters %j', async filters => {
    await expect(service.detail(actor, id, filters as any)).rejects.toThrow('Invalid');
    expect(delivery.scope).not.toHaveBeenCalled();
  });
});
