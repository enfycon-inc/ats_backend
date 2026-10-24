import { canActOnJob, canSubmitToJob, jobCapabilities } from './job-action-policy';
import { jobAccessGrants } from '../auth/job-access-grants';

describe('granular job access', () => {
  const job = { tenantId: 'tenant', branchId: 'branch', businessUnitId: 'unit', accountManagerId: 'manager', status: 'Active', approvalStatus: 'APPROVED', directlyAssigned: true, podsEnabled: false };
  const recruiter = { dbId: 'recruiter', tenantId: 'tenant', branchId: 'branch', businessUnitId: 'unit', permissions: ['job:view', 'candidate:view', 'submission:create', 'job:find_matches_assigned'] };
  it('allows assigned matching and submission without granting job or website editing', () => {
    expect(jobCapabilities(recruiter, job)).toEqual({ findMatches: true, submitCandidate: true, edit: false, changeStatus: false, managePublication: false });
  });
  it('rejects unassigned jobs, another tenant or unit, and missing granular capabilities', () => {
    for (const other of [{ ...job, directlyAssigned: false }, { ...job, tenantId: 'other' }, { ...job, businessUnitId: 'other' }]) {
      expect(canActOnJob(recruiter, other, 'find_matches')).toBe(false);
      expect(canSubmitToJob(recruiter, other)).toBe(false);
    }
    expect(canActOnJob({ ...recruiter, permissions: ['job:view', 'candidate:view'] }, job, 'find_matches')).toBe(false);
    expect(canSubmitToJob({ ...recruiter, permissions: ['job:view'] }, job)).toBe(false);
  });
  it.each(['Closed', 'CLOSE', 'Draft', 'On Hold', 'Pending Approval'])('blocks sourcing for %s', status => {
    const scoped = { ...job, status };
    expect(canActOnJob(recruiter, scoped, 'find_matches')).toBe(false);
    expect(canSubmitToJob(recruiter, scoped)).toBe(false);
  });
  it('blocks pending approval even when operational status is active', () => {
    expect(canActOnJob(recruiter, { ...job, approvalStatus: 'PENDING_APPROVAL' }, 'find_matches')).toBe(false);
  });
  it('requires both pod enablement and separate pod-view / pod-submit permissions', () => {
    const podJob = { ...job, directlyAssigned: false, podAssigned: true, podsEnabled: true };
    expect(canActOnJob(recruiter, podJob, 'find_matches')).toBe(false);
    const viewer = { ...recruiter, permissions: [...recruiter.permissions, 'job:view_pod_jobs'] };
    expect(canActOnJob(viewer, podJob, 'find_matches')).toBe(true);
    expect(canSubmitToJob(viewer, podJob)).toBe(false);
    const submitter = { ...viewer, permissions: [...viewer.permissions, 'job:submit_pod_jobs'] };
    expect(canSubmitToJob(submitter, podJob)).toBe(true);
    expect(canActOnJob(submitter, { ...podJob, podsEnabled: false }, 'find_matches')).toBe(false);
    expect(canSubmitToJob(submitter, { ...podJob, podsEnabled: false })).toBe(false);
  });
  it('does not give website access to the account manager, creator or a job editor', () => {
    const manager = { ...recruiter, dbId: 'manager', permissions: ['job:edit', 'job:find_matches'] };
    expect(canActOnJob(manager, job, 'edit')).toBe(true);
    expect(canActOnJob(manager, job, 'manage_publication')).toBe(false);
    expect(canActOnJob({ ...manager, permissions: ['job:manage_publication_tenant'] }, job, 'manage_publication')).toBe(false);
  });
  it.each([
    ['unit_admin:manage', 'job:manage_publication_unit'],
    ['branch_admin:manage', 'job:manage_publication_branch'],
    ['tenant:settings', 'job:manage_publication_tenant'],
  ])('requires administrator capability %s and its publication grant', (admin, permission) => {
    const actor = { ...recruiter, permissions: [admin, permission] };
    expect(canActOnJob(actor, job, 'manage_publication')).toBe(true);
    expect(canActOnJob({ ...actor, permissions: [admin] }, job, 'manage_publication')).toBe(false);
    expect(canActOnJob(actor, { ...job, status: 'Closed' }, 'manage_publication')).toBe(false);
    expect(canActOnJob(actor, { ...job, tenantId: 'other' }, 'manage_publication')).toBe(false);
    if (admin !== 'tenant:settings') expect(canActOnJob(actor, { ...job, branchId: 'other' }, 'manage_publication')).toBe(false);
  });
  it('grants assigned sourcing without editing and grants publication only to administrator bundles', () => {
    expect(jobAccessGrants(recruiter.permissions)).toEqual(['job:find_matches_assigned']);
    expect(jobAccessGrants(['job:edit', 'job:view', 'candidate:view'])).toEqual([]);
    expect(jobAccessGrants(['unit_admin:manage'])).toEqual(['job:manage_publication_unit']);
  });
});
