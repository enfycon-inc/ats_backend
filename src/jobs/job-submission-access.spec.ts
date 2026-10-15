import { assertJobSubmissionAccess } from './job-submission-access';
describe('pod-first submission authorization', () => {
  const actor: any = { dbId: 'recruiter', permissions: ['submission:create'] };
  function setup(direct = false, pod = true) {
    return { user: { findFirst: jest.fn().mockResolvedValue({ branchId: 'branch', businessUnitId: 'unit', podId: 'pod' }) }, job: { findFirst: jest.fn().mockResolvedValue({ id: 'job' }) }, jobRecruiter: { findUnique: jest.fn().mockResolvedValue(direct ? { jobId: 'job' } : null) }, jobPod: { findUnique: jest.fn().mockResolvedValue(pod ? { jobId: 'job' } : null) } } as any;
  }
  it('allows an individually assigned recruiter', async () => { await expect(assertJobSubmissionAccess(setup(true), actor, 'tenant', 'job', 'recruiter')).resolves.toBeUndefined(); });
  it('does not grant submission rights merely through pod membership', async () => { await expect(assertJobSubmissionAccess(setup(), actor, 'tenant', 'job', 'recruiter')).rejects.toThrow('assign this job'); });
  it('allows whole-pod submissions only when explicitly enabled', async () => { await expect(assertJobSubmissionAccess(setup(), { ...actor, permissions: ['submission:create', 'job:submit_pod_jobs'] }, 'tenant', 'job', 'recruiter')).resolves.toBeUndefined(); });
  it('does not treat view-pod permission as submit permission', async () => { await expect(assertJobSubmissionAccess(setup(), { ...actor, permissions: ['submission:create', 'job:view_pod_jobs'] }, 'tenant', 'job', 'recruiter')).rejects.toThrow(); });
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
