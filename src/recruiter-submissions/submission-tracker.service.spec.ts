import { ConflictException } from '@nestjs/common';
import { assessCandidate } from '../jobs/candidate-assessment';
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
  it('checks workspace visibility and review capability before loading assessment sources', async () => {
    const { service, prisma } = setup();
    prisma.job = { findFirst: jest.fn() }; prisma.candidate = { findFirst: jest.fn() };
    jest.spyOn(service, 'findOne').mockRejectedValueOnce(new Error('Not visible')).mockResolvedValueOnce({ capabilities: { review: false } } as any);
    await expect(service.assessment('submission-id', 'tenant-id', user)).rejects.toThrow('Not visible');
    await expect(service.assessment('submission-id', 'tenant-id', user)).rejects.toThrow('Internal review permission');
    expect(prisma.job.findFirst).not.toHaveBeenCalled();
  });
  it('scores the exact submitted candidate with tenant-scoped sources', async () => {
    const { service, prisma } = setup();
    prisma.job = { findFirst: jest.fn().mockResolvedValue({ skillsRequired: ['Python'] }) };
    prisma.candidate = { findFirst: jest.fn().mockResolvedValue({ skills: ['Python'] }) };
    jest.spyOn(service, 'findOne').mockResolvedValue({ jobId: 'job-id', candidateId: 'candidate-id', capabilities: { review: true } } as any);
    const result = await service.assessment('submission-id', 'tenant-id', user);
    expect(result.assessment.score).toBe(100);
    expect(prisma.job.findFirst.mock.calls[0][0].where).toEqual({ id: 'job-id', tenantId: 'tenant-id' });
    expect(prisma.candidate.findFirst.mock.calls[0][0].where).toEqual({ id: 'candidate-id', tenantId: 'tenant-id', deletedAt: null });
  });
  it('rejects changed assessment sources before writing the decision or its history', async () => {
    const { service, prisma } = setup();
    jest.spyOn(service, 'findOne').mockResolvedValue({ id: 'submission-id' } as any);
    prisma.recruiterSubmission.findFirst.mockResolvedValue({ jobId: 'job-id', candidateId: 'candidate-id', finalStatus: 'PENDING_APPROVAL', updatedAt: new Date() });
    prisma.job = { findFirst: jest.fn().mockResolvedValue({ skillsRequired: ['Python'] }) };
    prisma.candidate = { findFirst: jest.fn().mockResolvedValue({ skills: ['Python'] }) };
    const reviewer = { ...user, permissions: ['submission:internal_screening'] };
    await expect(service.update('submission-id', { finalStatus: 'SUBMITTED', assessmentVersion: '0'.repeat(64) }, 'tenant-id', reviewer)).rejects.toThrow('evidence changed');
    const version = assessCandidate({ skillsRequired: ['Python'] }, { skills: ['Python'] }).version;
    await expect(service.update('submission-id', { finalStatus: 'SUBMITTED', assessmentVersion: version, reviewOverrides: { 'unknown:requirement': 'Meets' } }, 'tenant-id', reviewer)).rejects.toThrow('unknown requirement');
    expect(prisma.recruiterSubmission.updateMany).not.toHaveBeenCalled(); expect(prisma.submissionEvent.create).not.toHaveBeenCalled();
  });
  it('persists a server-built evidence snapshot and separate overrides atomically with the decision', async () => {
    const { service, prisma } = setup();
    jest.spyOn(service, 'findOne').mockResolvedValue({ id: 'submission-id' } as any);
    const job = { skillsRequired: ['Python'] }; const candidate = { skills: ['Python'] };
    prisma.job = { findFirst: jest.fn().mockResolvedValue(job) }; prisma.candidate = { findFirst: jest.fn().mockResolvedValue(candidate) };
    prisma.recruiterSubmission.findFirst.mockResolvedValue({ id: 'submission-id', jobId: 'job-id', candidateId: 'candidate-id', finalStatus: 'PENDING_APPROVAL', updatedAt: new Date() });
    prisma.recruiterSubmission.updateMany.mockResolvedValue({ count: 1 });
    const assessment = assessCandidate(job, candidate);
    await service.update('submission-id', { finalStatus: 'SUBMITTED', assessmentVersion: assessment.version, reviewOverrides: { 'primary:python': 'Needs clarification' } }, 'tenant-id', { ...user, permissions: ['submission:internal_screening'] });
    const event = prisma.submissionEvent.create.mock.calls.at(-1)[0].data;
    expect(event.details.assessment).toMatchObject({ score: 100, version: assessment.version });
    expect(event.details.reviewOverrides).toEqual({ 'primary:python': 'Needs clarification' });
    candidate.skills[0] = 'Java';
    expect(event.details.assessment.criteria[0].requirement).toBe('Python');
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });
  it('loads review requirements through the authorized detail query and preserves zero-day notice', async () => {
    const { service, prisma } = setup();
    prisma.$queryRawUnsafe.mockResolvedValueOnce([{ count: 1n }]).mockResolvedValueOnce([{
      id: 'submission-id', submission_number: 12n, job_description: 'Real job description', job_experience_min: 0,
      job_experience_max: 5, job_location: 'Actual location', job_degree: 'Actual degree', candidate_notice_period: 0,
    }]);
    const result = await service.findOne('submission-id', 'tenant-id', user);
    expect(result).toMatchObject({ submissionNumber: 12, jobDescription: 'Real job description', jobExperienceMin: 0, jobExperienceMax: 5, candidateNoticePeriod: 0 });
    const [sql, ...params] = prisma.$queryRawUnsafe.mock.calls[1];
    expect(sql).toContain('j.job_description');
    expect(sql).toContain('PARTITION BY rs.job_id ORDER BY rs.created_at ASC, rs.id ASC');
    expect(sql).toContain('FROM ats.recruiter_submissions rs WHERE rs.tenant_id = $1');
    expect(sql).toContain('s.tenant_id = $1');
    expect(params).toContain('submission-id');
  });
  it('counts all matching records before selecting the page and stage', async () => {
    const { service, prisma } = setup();
    prisma.$queryRawUnsafe.mockResolvedValueOnce([{ count: 2n, all_count: 35n, review_count: 6n, interviews_count: 20n, offers_count: 2n, closed_count: 7n }]).mockResolvedValueOnce([]);
    const result = await service.findAll('tenant-id', user, { bucket: 'offers', page: 2, limit: 10, search: 'Name%' });
    expect(result.counts).toEqual({ all: 35, review: 6, interviews: 20, offers: 2, closed: 7 });
    expect(result.total).toBe(2);
    const [countSql, ...countParams] = prisma.$queryRawUnsafe.mock.calls[0];
    expect(countSql).toContain('s.tenant_id = $1');
    // The history projection may limit its latest event; record counts must not use page limits.
    expect(countSql).not.toMatch(/LIMIT\s+\$\d+/);
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
  it.each(['asc', 'desc'] as const)('paginates history in %s sequence order within the tenant', async order => {
    const { service, prisma } = setup();
    jest.spyOn(service, 'findOne').mockResolvedValue({ id: 'submission-id' } as any);
    prisma.submissionEvent.count = jest.fn().mockResolvedValue(60);
    prisma.submissionEvent.findMany = jest.fn().mockResolvedValue([]);
    const result = await service.history('submission-id', 'tenant-id', user, null, 2, order);
    expect(prisma.submissionEvent.findMany).toHaveBeenCalledWith({ where: { submissionId: 'submission-id', tenantId: 'tenant-id' }, orderBy: { sequence: order }, skip: 25, take: 25 });
    expect(result.totalPages).toBe(3);
  });
  it('rejects invalid history ordering before querying events', async () => {
    const { service, prisma } = setup();
    jest.spyOn(service, 'findOne').mockResolvedValue({ id: 'submission-id' } as any);
    prisma.submissionEvent.count = jest.fn();
    await expect(service.history('submission-id', 'tenant-id', user, null, 1, 'invalid' as any)).rejects.toThrow('Invalid history order');
    expect(prisma.submissionEvent.count).not.toHaveBeenCalled();
  });
});
