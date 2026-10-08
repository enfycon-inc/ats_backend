import { ConflictException } from '@nestjs/common';
import { RecruiterSubmissionsService } from './recruiter-submissions.service';
import type { AuthUser } from '../auth/interfaces/auth-user.interface';

const user = { dbId: 'user-id', permissions: ['submission:view', 'submission:edit'], roles: [], tenantId: 'tenant-id' } as unknown as AuthUser;
function setup() {
  const prisma: any = { submissionEvent: { findFirst: jest.fn().mockResolvedValue(null), create: jest.fn() }, $queryRawUnsafe: jest.fn(), recruiterSubmission: { findFirst: jest.fn(), updateMany: jest.fn() } };
  prisma.$transaction = jest.fn(callback => callback(prisma));
  const notifications = { create: jest.fn() };
  const service = new RecruiterSubmissionsService(prisma as any, notifications as any);
  return { prisma, notifications, service };
}
describe('submission tracker API', () => {
  it('counts all matching records before selecting the page and stage', async () => {
    const { service, prisma } = setup();
    prisma.$queryRawUnsafe.mockResolvedValueOnce([{ count: 2n, all_count: 35n, review_count: 6n, interviews_count: 20n, offers_count: 2n, closed_count: 7n }]).mockResolvedValueOnce([]);
    const result = await service.findAll('tenant-id', user, { bucket: 'offers', page: 2, limit: 10, search: 'Name%' });
    expect(result.counts).toEqual({ all: 35, review: 6, interviews: 20, offers: 2, closed: 7 });
    expect(result.total).toBe(2);
    const [countSql, ...countParams] = prisma.$queryRawUnsafe.mock.calls[0];
    expect(countSql).toContain('s.tenant_id = $1');
    expect(countSql).not.toContain('LIMIT');
    expect(countParams).toEqual(['tenant-id', '%Name\\%%']);
    const [retrieveSql, ...retrieveParams] = prisma.$queryRawUnsafe.mock.calls[1];
    expect(retrieveSql).toContain("AND s.final_status = 'OFFER'");
    expect(retrieveParams.slice(-2)).toEqual([10, 10]);
  });
  it('maps joined client names and stored rate currency without invented relationships', async () => {
    const { service, prisma } = setup();
    prisma.$queryRawUnsafe.mockResolvedValueOnce([{ count: 1n }]).mockResolvedValueOnce([{
      id: 'submission-id', client_name: 'Actual client', end_client_name: 'Actual end client', submitted_rate_amount: 12.5,
      submitted_rate_currency: 'USD', submitted_rate_term: 'HOUR', job_timezone: 'America/New_York',
    }]);
    const result = await service.findAll('tenant-id', user, {});
    expect(result.data[0]).toMatchObject({ clientName: 'Actual client', endClientName: 'Actual end client', submittedRate: '12.5', submittedRateCurrency: 'USD', submittedRateTerm: 'HOUR', timezone: 'America/New_York' });
  });
  it('rejects a stale editor before performing a write or notification', async () => {
    const { service, prisma, notifications } = setup();
    jest.spyOn(service, 'findOne').mockResolvedValue({ id: 'submission-id' } as any);
    prisma.recruiterSubmission.findFirst.mockResolvedValue({ id: 'submission-id', tenantId: 'tenant-id', finalStatus: 'SUBMITTED', updatedAt: new Date('2026-10-08T01:00:00Z') });
    await expect(service.update('submission-id', { recruiterComment: 'Changed', expectedUpdatedAt: '2026-10-07T01:00:00Z' }, 'tenant-id', user)).rejects.toThrow(ConflictException);
    expect(prisma.recruiterSubmission.updateMany).not.toHaveBeenCalled();
    expect(notifications.create).not.toHaveBeenCalled();
  });
  it('a concurrent write fails the atomic version check before notification', async () => {
    const { service, prisma, notifications } = setup();
    jest.spyOn(service, 'findOne').mockResolvedValue({ id: 'submission-id' } as any);
    prisma.recruiterSubmission.findFirst.mockResolvedValue({ id: 'submission-id', tenantId: 'tenant-id', finalStatus: 'SUBMITTED', updatedAt: new Date('2026-10-08T01:00:00Z') });
    prisma.recruiterSubmission.updateMany.mockResolvedValue({ count: 0 });
    await expect(service.update('submission-id', { recruiterComment: 'Changed' }, 'tenant-id', user)).rejects.toThrow(ConflictException);
    expect(prisma.recruiterSubmission.updateMany.mock.calls[0][0].where).toMatchObject({ id: 'submission-id', tenantId: 'tenant-id' });
    expect(notifications.create).not.toHaveBeenCalled();
  });
  it('checks submission visibility before reading any history', async () => {
    const { service, prisma } = setup();
    jest.spyOn(service, 'findOne').mockRejectedValue(new Error('Not visible'));
    await expect(service.history('submission-id', 'tenant-id', user)).rejects.toThrow('Not visible');
    expect(prisma.submissionEvent.findFirst).not.toHaveBeenCalled();
  });
});
