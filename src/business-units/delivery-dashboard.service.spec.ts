import { DeliveryDashboardService } from './delivery-dashboard.service';
import type { AuthUser } from '../auth/interfaces/auth-user.interface';

describe('Current unit delivery dashboard', () => {
  const where = { tenantId: 'tenant', branchId: 'branch', businessUnitId: 'unit' };
  const actor = { dbId: 'actor', tenantId: 'tenant', permissions: ['unit_admin:manage', 'job:view', 'submission:view', 'pod:view', 'user:manage'], branchId: 'stale-branch', businessUnitId: 'stale-unit' } as AuthUser;
  let db: any;
  let service: DeliveryDashboardService;
  beforeEach(() => {
    db = {
      user: { findFirst: jest.fn().mockResolvedValue({ branchId: 'branch', businessUnitId: 'unit' }), findMany: jest.fn().mockResolvedValue([]), count: jest.fn().mockResolvedValue(0), updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      businessUnit: { findFirst: jest.fn().mockResolvedValue({ id: 'unit', name: 'Engineering', branch: { name: 'Office' } }) },
      recruiterSubmission: { groupBy: jest.fn().mockResolvedValue([]), findMany: jest.fn().mockResolvedValue([]), count: jest.fn().mockResolvedValue(0) },
      job: { findMany: jest.fn().mockResolvedValue([]), count: jest.fn().mockResolvedValue(0) },
      pod: { findMany: jest.fn().mockResolvedValue([]) }, customRole: { findMany: jest.fn().mockResolvedValue([]) },
    };
    db.job.aggregate = jest.fn().mockResolvedValue({ _sum: { submissionRequired: 50 } });
    db.auditLog = { create: jest.fn().mockResolvedValue({}) };
    db.$queryRaw = jest.fn().mockResolvedValue([]);
    db.$transaction = jest.fn(callback => callback(db));
    service = new DeliveryDashboardService(db);
  });
  it('scopes all metrics and pages to fresh membership, even with broader permissions', async () => {
    await service.dashboard({ ...actor, permissions: [...actor.permissions!, 'tenant:manage', 'job:view_all_branches'] });
    expect(db.job.count).toHaveBeenCalledWith({ where: { ...where, deletedAt: null, status: { in: ['ACTIVE', 'Active'] } } });
    expect(db.job.aggregate).toHaveBeenCalledWith({ where: { ...where, deletedAt: null }, _sum: { submissionRequired: true } });
    expect(db.recruiterSubmission.groupBy).toHaveBeenCalledWith(expect.objectContaining({ where: { tenantId: 'tenant', job: { ...where, deletedAt: null } } }));
    expect(db.user.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { ...where, isApproved: false, requestedRole: { not: null } }, take: 10 }));
    expect(db.pod.findMany).toHaveBeenCalledWith(expect.objectContaining({ where, take: 8 }));
    const [sql, ...values] = db.$queryRaw.mock.calls[0];
    expect(sql.join('?')).toContain('j.business_unit_id = ?::uuid');
    expect(values).toEqual([true, 'tenant', 'tenant', 'branch', 'unit']);
  });
  it('fails closed without active membership or a unit assignment', async () => {
    db.user.findFirst.mockResolvedValue(null);
    await expect(service.dashboard(actor)).rejects.toThrow('assignment');
    expect(db.job.count).not.toHaveBeenCalled();
    db.user.findFirst.mockResolvedValue({ branchId: 'branch', businessUnitId: null });
    await expect(service.dashboard(actor)).rejects.toThrow('assignment');
  });
  it('does not query or disclose sections without their read capabilities', async () => {
    const result = await service.dashboard({ ...actor, permissions: ['unit_admin:manage'] });
    expect(result.pipeline).toBeNull(); expect(result.pendingUsers).toBeNull(); expect(result.pods).toBeNull(); expect(result.activeJobs).toBeNull();
    expect(result.submissionRequired).toBeNull();
    expect(db.job.aggregate).not.toHaveBeenCalled();
    expect(db.recruiterSubmission.groupBy).not.toHaveBeenCalled(); expect(db.user.findMany).not.toHaveBeenCalled();
  });
  it('returns at most ten interviews sorted across all three rounds', async () => {
    db.recruiterSubmission.findMany.mockImplementation(async query => {
      if (!query.select.l1Date) return [];
      expect(query.take).toBe(10);
      return Array.from({ length: 5 }, (_, index) => ({ id: `${Object.keys(query.orderBy)[0]}-${index}`, l1Date: new Date(`2030-01-${String(index + 1).padStart(2, '0')}T10:00:00Z`), l2Date: new Date(`2030-01-${String(index + 2).padStart(2, '0')}T10:00:00Z`), l3Date: new Date(`2030-01-${String(index + 3).padStart(2, '0')}T10:00:00Z`), candidate: { fullName: 'Candidate', tenantId: 'tenant' }, job: { jobTitle: 'Job' } }));
    });
    const result = await service.dashboard(actor);
    expect(result.interviews).toHaveLength(10);
    expect(result.interviews!.map(interview => interview.date)).toEqual(result.interviews!.map(interview => interview.date).sort());
  });
  it('rejects invalid filters before querying', async () => {
    await expect(service.dashboard(actor, 'other')).rejects.toThrow();
    await expect(service.dashboard(actor, 'l1', -1)).rejects.toThrow();
    expect(db.user.findFirst).not.toHaveBeenCalled();
  });
  it('blocks foreign unit users, self changes, and accounts with greater permissions', async () => {
    await expect(service.setMemberActive(actor, 'actor', false)).rejects.toThrow();
    db.user.findFirst.mockResolvedValueOnce({ branchId: 'branch', businessUnitId: 'unit' }).mockResolvedValueOnce(null);
    await expect(service.setMemberActive(actor, 'foreign', false)).rejects.toThrow('current unit');
    db.user.findFirst.mockResolvedValueOnce({ branchId: 'branch', businessUnitId: 'unit' }).mockResolvedValueOnce({ roleId: 'admin-role', assignedRoleIds: [] });
    db.customRole.findMany.mockResolvedValue([{ permissions: ['tenant:manage'] }]);
    await expect(service.setMemberActive(actor, 'admin', false)).rejects.toThrow('beyond your own');
    expect(db.user.updateMany).not.toHaveBeenCalled();
  });
  it('writes account status with tenant, branch, and unit predicates', async () => {
    db.user.findFirst.mockResolvedValueOnce({ branchId: 'branch', businessUnitId: 'unit' }).mockResolvedValueOnce({ roleId: null, assignedRoleIds: [], isActive: true, updatedAt: new Date(0) });
    expect(await service.setMemberActive(actor, 'member', false)).toEqual({ id: 'member', isActive: false });
    expect(db.user.updateMany).toHaveBeenCalledWith({ where: { ...where, id: 'member', updatedAt: new Date(0) }, data: { isActive: false } });
    expect(db.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ action: 'UNIT_MEMBER_ACCESS_CHANGED', targetId: 'member' }) }));
  });
  it('treats a repeated account status request as an idempotent success', async () => {
    db.user.findFirst.mockResolvedValueOnce({ branchId: 'branch', businessUnitId: 'unit' }).mockResolvedValueOnce({ roleId: null, assignedRoleIds: [], isActive: false, updatedAt: new Date(0) });
    await expect(service.setMemberActive(actor, 'member', false)).resolves.toEqual({ id: 'member', isActive: false });
    expect(db.user.updateMany).not.toHaveBeenCalled();
    expect(db.auditLog.create).not.toHaveBeenCalled();
  });
  it('does not overwrite a member changed concurrently', async () => {
    db.user.findFirst.mockResolvedValueOnce({ branchId: 'branch', businessUnitId: 'unit' }).mockResolvedValueOnce({ roleId: null, assignedRoleIds: [], isActive: true, updatedAt: new Date(0) });
    db.user.updateMany.mockResolvedValue({ count: 0 });
    await expect(service.setMemberActive(actor, 'member', false)).rejects.toThrow('Member changed');
    expect(db.auditLog.create).not.toHaveBeenCalled();
  });
});
