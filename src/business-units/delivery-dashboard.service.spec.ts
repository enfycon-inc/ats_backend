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
  it('guards job popups and keeps fresh scope and filters in parameterized SQL', async () => {
    await expect(service.jobDrilldown({ ...actor, permissions: ['unit_admin:manage'] }, {})).rejects.toThrow('Job view permission');
    await expect(service.jobDrilldown({ ...actor, permissions: ['unit_admin:manage','job:view'] }, {cities:'VIZAG'})).rejects.toThrow('User management permission');
    const page = { items: [], total: 0, page: 2 };
    db.$queryRaw.mockResolvedValue([{result:{jobResults:page}}]);
    expect(await service.jobDrilldown(actor, {jobPage:'2',jobStatus:'ACTIVE',cities:'VIZAG'})).toEqual(page);
    const sql = db.$queryRaw.mock.calls[0][0];
    expect(sql.values).toEqual(expect.arrayContaining(['tenant','branch','unit','ACTIVE','VIZAG',10]));
    expect(sql.text).toContain('matched_jobs');
    expect(sql.text).toContain('j.poster_city');
    expect(sql.text).not.toContain('stale-unit');
  });
  it('returns poster email and original submitter email instead of a reassigned recruiter', async () => {
    const timestamp = new Date('2026-11-03T10:00:00Z');
    db.recruiterSubmission.findMany.mockImplementation(async query => query.select.recruiterId ? [{
      id: 'submission', recruiterId: 'replacement', submissionOrigin: 'RECRUITER', events: [{ actorId: 'original', actorName: 'Original' }],
      createdAt: timestamp, updatedAt: timestamp, finalStatus: 'SUBMITTED', l1Status: 'SCHEDULED', l2Status: null, l3Status: null, l1Date: timestamp,
      candidate: { fullName: 'Candidate', email: 'candidate@example.com', tenantId: 'tenant' },
      job: { id: 'job', jobTitle: 'Engineer', jobCode: 'JOB-1', createdAt: timestamp, createdByUser: { fullName: 'Poster', email: 'poster@example.com', tenantId: 'tenant' }, clientRef: { clientName: 'Client', tenantId: 'tenant' } },
    }] : []);
    db.user.findMany.mockImplementation(async query => query.where.id ? [{ id: 'original', fullName: 'Original', email: 'original@example.com' }] : []);
    const result = await service.dashboard(actor, 'l1');
    expect(result.submissions?.[0]).toMatchObject({ postedBy: { name: 'Poster', email: 'poster@example.com' }, submittedBy: { name: 'Original', email: 'original@example.com' }, stageStatus: 'SCHEDULED', jobCode: 'JOB-1' });
    expect(db.user.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { tenantId: 'tenant', id: { in: ['original'] } } }));
  });
  it('searches paginated options inside the current tenant branch and unit', async () => {
    db.$queryRaw.mockResolvedValue(Array.from({ length: 26 }, (_, index) => ({ id: `client-${index}`, name: `Client ${index}`, email: null })));
    const result = await service.filterOptions(actor, 'client', "Acme' OR true", 2);
    const [sql] = db.$queryRaw.mock.calls[0];
    expect(sql.sql).toContain('j.branch_id=');
    expect(sql.sql).toContain('j.business_unit_id=');
    expect(sql.sql).not.toContain("Acme' OR true");
    expect(sql.values).toEqual(expect.arrayContaining(['tenant', 'branch', 'unit', "Acme' OR true", 25]));
    expect(result.items).toHaveLength(25);
    expect(result.nextPage).toBe(3);
  });
  it('rejects option access without submission permission and invalid option requests', async () => {
    await expect(service.filterOptions({ ...actor, permissions: ['unit_admin:manage'] }, 'client')).rejects.toThrow('permission');
    await expect(service.filterOptions(actor, 'invalid')).rejects.toThrow('Invalid');
    await expect(service.filterOptions(actor, 'client', '', 0)).rejects.toThrow('Invalid');
    expect(db.$queryRaw).not.toHaveBeenCalled();
  });
  it('filters identities by selected IDs and handles website applicants separately', async () => {
    const id = '11111111-1111-4111-8111-111111111111';
    await service.dashboard(actor, 'l1', 1, 1, { postedBy: id, client: id, submittedBy: 'website' });
    const query = db.recruiterSubmission.count.mock.calls[0][0];
    expect(query.where.AND).toEqual(expect.arrayContaining([{ job: { createdByUser: { tenantId: 'tenant', id: { in: [id] } } } }, { job: { clientRef: { tenantId: 'tenant', id: { in: [id] } } } }, { OR: [{ submissionOrigin: 'WEBSITE' }] }]));
  });
  it('combines multiple identities within each filter and preserves the scoped intersection', async () => {
    const first = '11111111-1111-4111-8111-111111111111', second = '22222222-2222-4222-8222-222222222222';
    await service.dashboard(actor, 'l1', 1, 1, { client: `${first},${second}`, postedBy: `${first},${second}`, submittedBy: `${first},website` });
    const clauses = db.recruiterSubmission.count.mock.calls[0][0].where.AND;
    expect(clauses).toEqual(expect.arrayContaining([{ tenantId: 'tenant', job: { ...where, deletedAt: null } }, { job: { clientRef: { tenantId: 'tenant', id: { in: [first, second] } } } }, { job: { createdByUser: { tenantId: 'tenant', id: { in: [first, second] } } } }]));
    expect(clauses[4].OR).toEqual(expect.arrayContaining([{ submissionOrigin: 'WEBSITE' }, expect.objectContaining({ submissionOrigin: { not: 'WEBSITE' } })]));
  });
  it.each(['invalid', 'website', '11111111-1111-4111-8111-111111111111,invalid'])('rejects invalid client selections %s', async client => {
    await expect(service.dashboard(actor, 'l1', 1, 1, { client })).rejects.toThrow('valid filter');
    expect(db.recruiterSubmission.count).not.toHaveBeenCalled();
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
      if (query.select.recruiterId || !query.select.l1Date) return [];
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
