import { JobsService } from './jobs.service';
import { resolveJobStaffingScope } from './job-staffing';

describe('explicit emergency assignment controls', () => {
  const actor: any = { dbId: 'manager', tenantId: 'tenant', branchId: 'branch', businessUnitId: 'unit', permissions: ['job:assign_recruiter', 'job:override_assignment', 'job:edit'] };
  const job = { id: 'job', branchId: 'branch', businessUnitId: 'unit' };
  it('requires an emergency reason before assignment writes', async () => {
    const db: any = { job: { findFirst: jest.fn().mockResolvedValue(job), update: jest.fn() } };
    await expect(new JobsService(db, {} as any).updateJob('job', { recruiterIds: ['person'] }, 'tenant', actor)).rejects.toThrow('assignment reason');
    expect(db.job.update).not.toHaveBeenCalled();
  });
  it('never lets an override cross unit boundaries', async () => {
    const db: any = { job: { findFirst: jest.fn().mockResolvedValue({ ...job, businessUnitId: 'foreign' }), update: jest.fn() } };
    await expect(new JobsService(db, {} as any).updateJob('job', { recruiterIds: ['person'], assignmentReason: 'Urgent' }, 'tenant', actor)).rejects.toThrow('current unit');
    expect(db.job.update).not.toHaveBeenCalled();
  });
  it('does not grant lead allocation through a role label without permission', async () => {
    await expect(resolveJobStaffingScope({} as any, { ...actor, roles: ['POD_LEAD'], permissions: [] }, 'tenant')).rejects.toThrow('permission');
  });
  it('requires actual lead ownership even when assignment permission is enabled', async () => {
    const id = '11111111-1111-4111-8111-111111111111';
    const db: any = { tenant: { findUnique: jest.fn().mockResolvedValue({ podSystemEnabled: true }) }, businessUnit: { findFirst: jest.fn().mockResolvedValue({ allowPods: true }) }, pod: { findFirst: jest.fn().mockResolvedValue(null) } };
    await expect(resolveJobStaffingScope(db, { ...actor, roles: ['POD_LEAD'], permissions: ['job:assign_recruiter'] }, 'tenant', undefined, undefined, 'job:assign_recruiter', id)).rejects.toThrow('not assigned as a Pod Lead');
  });
});
