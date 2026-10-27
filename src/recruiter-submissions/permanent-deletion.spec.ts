import { RecruiterSubmissionsService } from './recruiter-submissions.service';

describe('permanent submission deletion', () => {
  const actor: any = { tenantId: 'tenant', permissions: ['tenant:settings'] };
  const tx = {
    $queryRawUnsafe: jest.fn(), $executeRawUnsafe: jest.fn(),
    auditLog: { deleteMany: jest.fn() }, recruiterSubmission: { delete: jest.fn() },
  };
  const service: any = { prisma: { $transaction: jest.fn(async callback => callback(tx)) } };
  beforeEach(() => { jest.clearAllMocks(); });
  it('locks the tenant-scoped submission and deletes it without the history restriction', async () => {
    tx.$queryRawUnsafe.mockResolvedValue([{ job_id: 'job' }]);
    await RecruiterSubmissionsService.prototype.permanentlyRemove.call(service, 'submission', 'tenant', actor);
    expect(tx.$queryRawUnsafe).toHaveBeenCalledWith(expect.stringContaining('FOR UPDATE'), 'submission', 'tenant');
    expect(tx.recruiterSubmission.delete).toHaveBeenCalledWith({ where: { id: 'submission' } });
    expect(tx.auditLog.deleteMany).toHaveBeenCalledWith({ where: { tenantId: 'tenant', targetType: { in: ['submission', 'recruiter_submission'] }, targetId: 'submission' } });
    expect(tx.$executeRawUnsafe).toHaveBeenCalledWith(expect.stringContaining('GREATEST(0,submission_done-1)'), 'job', 'tenant');
  });
  it('does not decrement counters again when the row has already been deleted', async () => {
    tx.$queryRawUnsafe.mockResolvedValue([]);
    await RecruiterSubmissionsService.prototype.permanentlyRemove.call(service, 'submission', 'tenant', actor);
    expect(tx.recruiterSubmission.delete).not.toHaveBeenCalled();
    expect(tx.$executeRawUnsafe).not.toHaveBeenCalled();
  });
  it('denies foreign-tenant deletion before opening a transaction', async () => {
    await expect(RecruiterSubmissionsService.prototype.permanentlyRemove.call(service, 'submission', 'other', actor)).rejects.toThrow();
    expect(service.prisma.$transaction).not.toHaveBeenCalled();
  });
});
