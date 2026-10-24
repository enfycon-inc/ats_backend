import { assertJobSubmissionAccess } from './job-submission-access';
describe('pod-first submission authorization', () => {
  const actor: any = { dbId: 'recruiter', tenantId: 'tenant', permissions: ['submission:create'] };
  function setup(direct = false, pod = true) {
    return { user: { findFirst: jest.fn().mockResolvedValue({ branchId: 'branch', businessUnitId: 'unit', podId: 'pod' }) }, tenant: { findUnique: jest.fn().mockResolvedValue({ podSystemEnabled: true }) }, businessUnit: { findFirst: jest.fn().mockResolvedValue({ allowPods: true }) }, job: { findFirst: jest.fn().mockResolvedValue({ id: 'job', status: 'Active', approvalStatus: 'APPROVED' }) }, jobRecruiter: { findUnique: jest.fn().mockResolvedValue(direct ? { jobId: 'job' } : null) }, jobPod: { findUnique: jest.fn().mockResolvedValue(pod ? { jobId: 'job' } : null) } } as any;
  }
  it('allows an individually assigned recruiter', async () => { await expect(assertJobSubmissionAccess(setup(true), actor, 'tenant', 'job', 'recruiter')).resolves.toBeUndefined(); });
  it('does not grant submission rights merely through pod membership', async () => { await expect(assertJobSubmissionAccess(setup(), actor, 'tenant', 'job', 'recruiter')).rejects.toThrow('assign this job'); });
  it('allows whole-pod submissions only when explicitly enabled', async () => { await expect(assertJobSubmissionAccess(setup(), { ...actor, permissions: ['submission:create', 'job:submit_pod_jobs'] }, 'tenant', 'job', 'recruiter')).resolves.toBeUndefined(); });
  it('does not treat view-pod permission as submit permission', async () => { await expect(assertJobSubmissionAccess(setup(), { ...actor, permissions: ['submission:create', 'job:view_pod_jobs'] }, 'tenant', 'job', 'recruiter')).rejects.toThrow(); });
  it('blocks pod sourcing when tenant or unit disables pods but keeps direct assignment working', async () => {
    const podActor = { ...actor, permissions: ['submission:create', 'job:submit_pod_jobs'] };
    const db = setup(); db.tenant.findUnique.mockResolvedValue({ podSystemEnabled: false });
    await expect(assertJobSubmissionAccess(db, podActor, 'tenant', 'job', 'recruiter')).rejects.toThrow('disabled');
    db.tenant.findUnique.mockResolvedValue({ podSystemEnabled: true }); db.businessUnit.findFirst.mockResolvedValue({ allowPods: false });
    await expect(assertJobSubmissionAccess(db, podActor, 'tenant', 'job', 'recruiter')).rejects.toThrow('disabled');
    db.jobRecruiter.findUnique.mockResolvedValue({ jobId: 'job' });
    await expect(assertJobSubmissionAccess(db, podActor, 'tenant', 'job', 'recruiter')).resolves.toBeUndefined();
  });
  it('blocks closed, pending, and foreign-tenant submissions even with an assignment', async () => {
    const db = setup(true); db.job.findFirst.mockResolvedValue({ id: 'job', status: 'Closed', approvalStatus: 'APPROVED' });
    await expect(assertJobSubmissionAccess(db, actor, 'tenant', 'job', 'recruiter')).rejects.toThrow('active, approved');
    db.job.findFirst.mockResolvedValue({ id: 'job', status: 'Active', approvalStatus: 'PENDING_APPROVAL' });
    await expect(assertJobSubmissionAccess(db, actor, 'tenant', 'job', 'recruiter')).rejects.toThrow('active, approved');
    await expect(assertJobSubmissionAccess(db, actor, 'other', 'job', 'recruiter')).rejects.toThrow('another workspace');
  });
  it('rejects spoofed recruiters and missing create capability', async () => {
    await expect(assertJobSubmissionAccess(setup(true), actor, 'tenant', 'job', 'other')).rejects.toThrow('own recruiter');
    await expect(assertJobSubmissionAccess(setup(true), { ...actor, permissions: [] }, 'tenant', 'job', 'recruiter')).rejects.toThrow('submission:create');
  });
  it('rejects foreign-unit jobs and missing assignments', async () => {
    const db = setup(true); db.job.findFirst.mockResolvedValue(null);
    await expect(assertJobSubmissionAccess(db, actor, 'tenant', 'job', 'recruiter')).rejects.toThrow('current unit');
    db.user.findFirst.mockResolvedValue(null);
    await expect(assertJobSubmissionAccess(db, actor, 'tenant', 'job', 'recruiter')).rejects.toThrow('assignment');
  });
});
