import { JobsService } from './jobs.service';

describe('permanent job deletion', () => {
  const actor: any = { tenantId: 'tenant', permissions: ['tenant:settings'] };
  const tx = {
    recruiterSubmission: { findMany: jest.fn() }, auditLog: { deleteMany: jest.fn() },
    job: { deleteMany: jest.fn() }, $queryRawUnsafe: jest.fn(),
  };
  const service: any = { prisma: { $transaction: jest.fn(async callback => callback(tx)) } };
  beforeEach(() => { jest.clearAllMocks(); tx.recruiterSubmission.findMany.mockResolvedValue([{ id: 'submission' }]); });
  it('authorizes only the job submissions for history deletion and scopes the job delete to the tenant', async () => {
    await JobsService.prototype.permanentlyDeleteJob.call(service, 'job', 'tenant', actor);
    expect(tx.recruiterSubmission.findMany).toHaveBeenCalledWith({ where: { tenantId: 'tenant', jobId: 'job' }, select: { id: true } });
    expect(tx.$queryRawUnsafe).toHaveBeenCalledWith(expect.stringContaining('set_config'), 'tenant', 'submission');
    expect(tx.job.deleteMany).toHaveBeenCalledWith({ where: { id: 'job', tenantId: 'tenant' } });
  });
  it('denies a foreign tenant before touching any records', async () => {
    await expect(JobsService.prototype.permanentlyDeleteJob.call(service, 'job', 'other', actor)).rejects.toThrow();
    expect(service.prisma.$transaction).not.toHaveBeenCalled();
  });
});
