import { JobsService } from './jobs.service';
import { loadJobActor } from './job-access-context';
jest.mock('./job-access-context', () => ({ loadJobActor: jest.fn() }));

describe('job export authorization', () => {
  const id = '11111111-1111-4111-8111-111111111111';
  let service: JobsService;
  let db: any;
  beforeEach(() => {
    db = { $queryRawUnsafe: jest.fn().mockResolvedValue([]), recruiterSubmission: { findMany: jest.fn() } };
    service = Object.create(JobsService.prototype);
    (service as any).prisma = db;
    (service as any).buildJobListQuery = jest.fn().mockReturnValue({ sql: 'SELECT j.id FROM ats.jobs j WHERE j.tenant_id = $1 AND j.branch_id = $2', params: ['tenant', 'branch'] });
  });
  it('denies a caller without export permission before reading export data', async () => {
    jest.mocked(loadJobActor).mockResolvedValue({ actor: { permissions: ['job:view'] }, podsEnabled: false } as any);
    await expect(service.exportJobs('tenant', {} as any, [id])).rejects.toThrow('Job export permission');
    expect(db.$queryRawUnsafe).not.toHaveBeenCalled();
  });
  it('rejects inaccessible selections and never fetches their submissions', async () => {
    jest.mocked(loadJobActor).mockResolvedValue({ actor: { permissions: ['job:export'] }, podsEnabled: false } as any);
    await expect(service.exportJobs('tenant', {} as any, [id])).rejects.toThrow('selected jobs are unavailable');
    expect(db.$queryRawUnsafe).toHaveBeenCalledWith(expect.stringContaining('j.branch_id = $2'), 'tenant', 'branch', [id]);
    expect(db.recruiterSubmission.findMany).not.toHaveBeenCalled();
  });
});
