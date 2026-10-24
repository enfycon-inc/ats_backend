import { careerPublicationDefaults } from '../jobs/career-publication';
import { PublicJobsService } from './public-jobs.service';

describe('automatic careers publication', () => {
  const key = { id: 'client', tenantId: 'tenant', scope: 'TENANT' as const, branchId: null, businessUnitId: null };
  const user = { dbId: 'admin', tenantId: 'tenant', permissions: ['tenant:settings', 'job:manage_publication_tenant'] };
  const application = { fullName: 'Alex Morgan', email: 'alex@example.com', consent: 'true', totalExperienceYears: '5', relevantExperienceYears: '4', currentCompany: 'Example', currentLocation: 'Bengaluru', preferredLocations: 'Bengaluru', noticePeriodDays: '0', currentCompensation: '12', expectedCompensation: '15', compensationInputUnit: 'LPA', compensationCurrency: 'INR' };
  const resume = { buffer: Buffer.from('%PDF-example'), size: 12, mimetype: 'application/pdf' };
  it('enrolls newly created jobs with unique slugs that fit the existing schema', () => {
    const first = careerPublicationDefaults('Engineer', 'JOB-001');
    expect(first.isPubliclyPublished).toBe(true);
    expect(first.publicSlug).not.toBe(careerPublicationDefaults('Engineer', 'JOB-001').publicSlug);
    expect(careerPublicationDefaults('a'.repeat(500), 'JOB-001').publicSlug.length).toBeLessThanOrEqual(180);
  });
  it('returns closed jobs with status, sanitized existing description, and no application access', async () => {
    const findMany = jest.fn().mockResolvedValue([{ id: 'private-id', status: 'Closed', publicSlug: 'engineer-001', jobDescription: '<p>Existing JD</p><script>alert(1)</script>', createdAt: new Date() }]);
    const service = new PublicJobsService({ job: { findMany } } as any);
    const response = await service.listJobs(key, {});
    expect(response.data[0]).toMatchObject({ status: 'Closed', acceptsApplications: false, slug: 'engineer-001' });
    expect(response.data[0].description).toContain('Existing JD');
    expect(response.data[0].description).not.toContain('<script');
    expect(response.data[0]).not.toHaveProperty('jobDescription');
    expect(response.data[0]).not.toHaveProperty('id');
    expect(findMany.mock.calls[0][0].where).toMatchObject({ tenantId: 'tenant', isPubliclyPublished: true, status: { in: ['ACTIVE', 'CLOSED'] } });
  });
  it.each([true, false])('blocks publication changes on closed jobs (%s)', async publish => {
    const service = new PublicJobsService({ job: { findFirst: jest.fn().mockResolvedValue({ id: 'job', tenantId: 'tenant', status: 'Closed', approvalStatus: 'APPROVED' }) } } as any);
    await expect(service.setPublished(user, 'job', publish)).rejects.toThrow('closed');
  });
  it('does not require a second description when manually publishing an active job', async () => {
    const updateMany = jest.fn().mockResolvedValue({ count: 1 });
    const tx = { job: { updateMany }, auditLog: { create: jest.fn() } };
    const prisma = { job: { findFirst: jest.fn().mockResolvedValue({ id: 'job', tenantId: 'tenant', jobTitle: 'Engineer', jobCode: 'JOB-001', status: 'Active', approvalStatus: 'APPROVED', publicSlug: 'stable-slug' }) }, $transaction: (run: any) => run(tx) };
    expect(await new PublicJobsService(prisma as any).setPublished(user, 'job', true)).toMatchObject({ publicSlug: 'stable-slug', isPubliclyPublished: true });
    expect(updateMany.mock.calls[0][0].data).not.toHaveProperty('publicDescription');
  });
  it('rejects Account Manager website mutations even when they own and can edit the job', async () => {
    const job = { id: 'job', tenantId: 'tenant', accountManagerId: 'manager', branchId: 'branch', businessUnitId: 'unit', status: 'Active', approvalStatus: 'APPROVED' };
    const prisma = { job: { findFirst: jest.fn().mockResolvedValue(job) }, $transaction: jest.fn() };
    const manager = { dbId: 'manager', tenantId: 'tenant', branchId: 'branch', businessUnitId: 'unit', permissions: ['job:edit', 'job:publish_direct'] };
    await expect(new PublicJobsService(prisma as any).setPublished(manager, 'job', false)).rejects.toThrow('permission');
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
  it('uses an active-only query for applications even though the feed includes closed jobs', async () => {
    const findFirst = jest.fn().mockResolvedValue(null);
    await expect(new PublicJobsService({ job: { findFirst } } as any).apply(key, 'slug', application, resume)).rejects.toThrow('no longer accepting');
    expect(findFirst.mock.calls[0][0].where.status).toEqual({ equals: 'ACTIVE', mode: 'insensitive' });
  });
  it('rejects an application if a job closes between its initial lookup and submission transaction', async () => {
    const tx = { $queryRaw: jest.fn().mockResolvedValue([]) };
    const prisma = { job: { findFirst: jest.fn().mockResolvedValue({ id: 'job', jobType: 'Full-Time' }) }, $transaction: (run: any) => run(tx) };
    await expect(new PublicJobsService(prisma as any).apply(key, 'slug', application, resume)).rejects.toThrow('no longer accepting');
    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
  });
});
