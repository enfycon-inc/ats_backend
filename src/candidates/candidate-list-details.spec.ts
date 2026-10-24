import { CandidatesService } from './candidates.service';
import { JobsService } from '../jobs/jobs.service';
import type { AuthUser } from '../auth/interfaces/auth-user.interface';

const user = { dbId: 'reviewer', tenantId: 'tenant', branchId: 'branch', permissions: ['job:view'], roles: [] } as unknown as AuthUser;

describe('candidate list details', () => {
  function setup() {
    const prisma = {
      tenant: { findUnique: jest.fn().mockResolvedValue({ candidatePoolMode: 'COMBINED_MARKET' }) },
      candidate: { findMany: jest.fn().mockResolvedValue([
        { id: 'c1', tenantId: 'tenant', market: 'IN', fullName: 'Candidate One', uploadedByUserId: 'u1', uploadedByName: 'Saved Name', currentCtc: 0, rawCurrentLocation: 'Hyderabad, Telangana', currentCompany: 'Example Co', updatedAt: new Date('2026-10-24T02:00:00Z') },
        { id: 'c2', tenantId: 'tenant', market: 'IN', fullName: 'Candidate Two', uploadedByUserId: 'u1', currentCtc: null },
        { id: 'c3', tenantId: 'tenant', fullName: 'Candidate Three', uploadedByUserId: 'deleted-user', uploadedByName: 'Former User' },
      ]) },
      user: { findMany: jest.fn().mockResolvedValue([{ id: 'u1', fullName: 'Current Name', email: 'u@example.test', profilePicture: '/avatar.png' }]) },
    };
    const jobs = { candidateJobLinks: jest.fn().mockResolvedValue([
      { candidateId: 'c1', id: 'j1', jobCode: 'JOB-1', jobTitle: 'Engineer' },
      { candidateId: 'c1', id: 'j2', jobCode: 'JOB-2', jobTitle: 'Analyst' },
    ]) };
    return { prisma, jobs, service: new CandidatesService(prisma as any, jobs as any) };
  }

  it('loads job links and uploader identities in batches, preserving zero CTC and missing values', async () => {
    const { service, prisma, jobs } = setup();
    const rows = await service.findAll({ branchId: 'branch' } as any, 'tenant', user);
    expect(prisma.user.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.user.findMany).toHaveBeenCalledWith({ where: { tenantId: 'tenant', id: { in: ['u1', 'deleted-user'] } }, select: { id: true, fullName: true, email: true, profilePicture: true } });
    expect(jobs.candidateJobLinks).toHaveBeenCalledWith('tenant', user, ['c1', 'c2', 'c3'], 'branch');
    expect(rows[0]).toMatchObject({ assignedJobCount: 2, currentCTC: 0, currentLocation: 'Hyderabad, Telangana', currentCompany: 'Example Co', updatedAt: '2026-10-24T02:00:00.000Z', uploadedByName: 'Current Name', uploadedByEmail: 'u@example.test', uploadedByAvatar: '/avatar.png' });
    expect(rows[1]).toMatchObject({ assignedJobs: [], assignedJobCount: 0, currentCTC: null, currentLocation: null, currentCompany: null, updatedAt: null });
    expect(rows[2]).toMatchObject({ uploadedByName: 'Former User', uploadedByEmail: null, uploadedByAvatar: null });
  });

  it('reports enrichment failure without presenting candidates as unassigned or leaking database errors', async () => {
    const { service, jobs } = setup();
    jobs.candidateJobLinks.mockRejectedValue(new Error('private database error'));
    await expect(service.findAll({} as any, 'tenant', user)).rejects.toThrow('Unable to load candidates. Please try again.');
  });
});

describe('candidate job visibility', () => {
  const setup = () => {
    const prisma = { $queryRawUnsafe: jest.fn().mockResolvedValue([]) };
    return { prisma, jobs: new JobsService(prisma as any, {} as any) };
  };
  it('returns no links without job permission or a required branch assignment', async () => {
    const { prisma, jobs } = setup();
    await expect(jobs.candidateJobLinks('tenant', { ...user, permissions: [] }, ['c1'])).resolves.toEqual([]);
    await expect(jobs.candidateJobLinks('tenant', { ...user, branchId: undefined }, ['c1'])).resolves.toEqual([]);
    expect(prisma.$queryRawUnsafe).not.toHaveBeenCalled();
  });
  it.each([
    ['recruiter', user],
    ['unit manager', { ...user, businessUnitId: 'unit', permissions: ['unit_admin:manage'] }],
    ['tenant manager', { ...user, permissions: ['tenant:manage'] }],
    ['account manager', { ...user, roles: ['ACCOUNT_MANAGER'], permissions: ['job:create'], businessUnitId: 'unit' }],
  ])('uses catalog visibility for %s and selects distinct links scoped to the requested candidates', async (_name, actor) => {
    const { prisma, jobs } = setup();
    await jobs.findAllJobs('tenant', actor, 'branch');
    const [catalogSql, ...catalogParams] = prisma.$queryRawUnsafe.mock.calls[0] as unknown as [string, ...unknown[]];
    prisma.$queryRawUnsafe.mockClear();
    await jobs.candidateJobLinks('tenant', actor as AuthUser, ['c1', 'c2'], 'branch');
    const [linkSql, ...linkParams] = prisma.$queryRawUnsafe.mock.calls[0] as unknown as [string, ...unknown[]];
    const predicates = catalogSql.slice(catalogSql.indexOf('WHERE j.tenant_id'), catalogSql.indexOf(' ORDER BY j.created_at'));
    expect(linkSql).toContain(predicates);
    expect(linkSql).toContain('SELECT DISTINCT');
    expect(linkSql).toContain('s.tenant_id = j.tenant_id');
    expect(linkSql).toContain(`s.candidate_id = ANY($${catalogParams.length + 1}::uuid[])`);
    expect(linkSql).not.toContain('j.*');
    expect(linkParams).toEqual([...catalogParams, ['c1', 'c2']]);
  });
});
