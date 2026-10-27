import { JobsService } from './jobs.service';
import { loadJobActor } from './job-access-context';
import { parseJobExportRequest } from './job-export-contract';
jest.mock('./job-access-context', () => ({ loadJobActor: jest.fn() }));

describe('job export authorization', () => {
  const id = '11111111-1111-4111-8111-111111111111';
  const filter = { from: '2026-09-30T18:30:00.000Z', to: '2026-10-31T18:30:00.000Z', includeSubmissions: false };
  let service: JobsService;
  let db: any;
  beforeEach(() => {
    db = { $queryRawUnsafe: jest.fn().mockResolvedValue([]), recruiterSubmission: { findMany: jest.fn().mockResolvedValue([]), groupBy: jest.fn().mockResolvedValue([{ jobId: id, _count: { _all: 2 } }]) },
      user: { findMany: jest.fn().mockResolvedValue([]) }, auditLog: { create: jest.fn() } };
    service = Object.create(JobsService.prototype);
    (service as any).prisma = db;
    (service as any).buildJobListQuery = jest.fn().mockReturnValue({ sql: 'SELECT j.id FROM ats.jobs j WHERE j.tenant_id = $1 AND j.branch_id = $2', params: ['tenant', 'branch'] });
    jest.mocked(loadJobActor).mockResolvedValue({ actor: { permissions: ['job:export'] }, podsEnabled: false } as any);
  });
  it('denies a caller without export permission before reading export data', async () => {
    jest.mocked(loadJobActor).mockResolvedValue({ actor: { permissions: ['job:view'] }, podsEnabled: false } as any);
    await expect(service.exportJobs('tenant', {} as any, filter)).rejects.toThrow('Job export permission');
    expect(db.$queryRawUnsafe).not.toHaveBeenCalled();
  });
  it('retains branch scope, applies inclusive/exclusive creation dates, and stops on empty results', async () => {
    await expect(service.exportJobs('tenant', {} as any, filter)).rejects.toThrow('No jobs match');
    expect(db.$queryRawUnsafe).toHaveBeenCalledWith(expect.stringContaining('j.branch_id = $2'), 'tenant', 'branch', new Date(filter.from), new Date(filter.to));
    expect(db.$queryRawUnsafe.mock.calls[0][0]).toContain('j.created_at >= $3::timestamptz AND j.created_at < $4::timestamptz');
    expect(db.recruiterSubmission.findMany).not.toHaveBeenCalled();
  });
  it('exports only the summary and aggregate counts when submissions are off', async () => {
    db.$queryRawUnsafe.mockResolvedValue([{ id, job_code: 'JOB-1', job_title: 'Developer', created_at: new Date('2026-10-01'), skills_required: ['Java'] }]);
    const report = await service.exportJobs('tenant', { dbId: 'actor' } as any, { ...filter, accountManagerId: id });
    const workbook = Buffer.from(report.content, 'base64').toString();
    expect(workbook).toContain('name="Jobs Summary"');
    expect(workbook).not.toContain('name="Job Submissions"');
    expect(workbook).not.toContain('Candidate name');
    expect(workbook).toContain('<c><v>2</v></c>');
    expect(db.recruiterSubmission.findMany).not.toHaveBeenCalled();
    expect(db.user.findMany).not.toHaveBeenCalled();
    expect(db.$queryRawUnsafe.mock.calls[0][0]).toContain('j.account_manager_id = $5::uuid');
    expect(db.$queryRawUnsafe.mock.calls[0][5]).toBe(id);
    expect(db.recruiterSubmission.groupBy).toHaveBeenCalledWith(expect.objectContaining({ where: { tenantId: 'tenant', jobId: { in: [id] }, candidate: { tenantId: 'tenant' } } }));
  });
  it('includes submission details without client contact fields when enabled', async () => {
    db.$queryRawUnsafe.mockResolvedValue([{ id, job_code: 'JOB-1', job_title: 'Developer', created_at: new Date('2026-10-01') }]);
    db.recruiterSubmission.findMany.mockResolvedValue([{ id: 'submission', jobId: id, recruiterId: 'WEBSITE_APPLICANT', createdAt: new Date('2026-11-15'),
      candidate: { id: 'candidate', fullName: 'Example Candidate', rawCurrentLocation: 'Kolkata' }, candidateCurrentCtc: 0, candidateExpectedCtc: 10 }]);
    const result = await service.exportJobs('tenant', {} as any, { ...filter, includeSubmissions: true });
    const workbook = Buffer.from(result.content, 'base64').toString();
    expect(workbook).toContain('name="Job Submissions"');
    expect(workbook).toContain('Example Candidate');
    expect(workbook).toContain('2026-11-15T00:00:00.000Z');
    expect(workbook).toContain('Website Applicant');
    expect(workbook).not.toContain('POC');
    expect(db.recruiterSubmission.groupBy).not.toHaveBeenCalled();
    expect(db.recruiterSubmission.findMany.mock.calls[0][0].where).not.toHaveProperty('createdAt');
  });
  it('rejects oversized exports before reading candidate data', async () => {
    db.$queryRawUnsafe.mockResolvedValue(Array.from({ length: 501 }, () => ({ id })));
    await expect(service.exportJobs('tenant', {} as any, filter)).rejects.toThrow('exceeds 500 jobs');
    expect(db.recruiterSubmission.findMany).not.toHaveBeenCalled();
  });
  it('limits manager options to catalog scope and only returns IDs and names', async () => {
    await service.exportManagers('tenant', {} as any);
    expect(db.$queryRawUnsafe).toHaveBeenCalledWith(expect.stringContaining('j.branch_id = $2'), 'tenant', 'branch');
    expect(db.$queryRawUnsafe.mock.calls[0][0]).toContain('u.tenant_id = j.tenant_id');
    expect(db.$queryRawUnsafe.mock.calls[0][0]).not.toContain('email');
  });
  it.each([
    { ...filter, from: '2026-02-30T00:00:00.000Z' },
    { ...filter, to: filter.from },
    { ...filter, from: filter.to },
    { ...filter, includeSubmissions: 'false' },
    { ...filter, accountManagerId: 'not-a-uuid' },
    { jobIds: [id] },
  ])('rejects malformed report filters before querying jobs: %j', async invalid => {
    expect(() => parseJobExportRequest(invalid)).toThrow();
    await expect(service.exportJobs('tenant', {} as any, invalid)).rejects.toThrow();
    expect(db.$queryRawUnsafe).not.toHaveBeenCalled();
  });
});
