import { RecruiterSubmissionsService } from './recruiter-submissions.service';

describe('submission visibility and statistics', () => {
  const user: any = { dbId: 'recruiter-a', permissions: ['submission:view', 'pod:view'], roles: [] };
  let query: jest.Mock;
  let service: RecruiterSubmissionsService;
  beforeEach(() => {
    query = jest.fn(async (sql: string, ...params: any[]) => {
      // Catch the original syntax defect and missing/unbound parameters.
      expect(sql).not.toContain('{paramIndex}');
      const placeholders = [...sql.matchAll(/\$(\d+)/g)].map(match => Number(match[1]));
      expect(Math.max(...placeholders)).toBe(params.length);
      if (sql.startsWith('SELECT COUNT')) return [{ count: 1n, l1_pending: 1n, l2_pending: 0n, l3_pending: 0n }];
      return [{ id: 'submission-a', recruiter_id: 'recruiter-a' }];
    });
    service = new RecruiterSubmissionsService({ $queryRawUnsafe: query } as any, {} as any);
  });

  it('binds the authenticated owner for My even with broad viewing permissions', async () => {
    const result = await service.findAll('tenant-a', user, { view: 'my' });
    expect(query.mock.calls[0][0]).toContain('s.recruiter_id = $2');
    expect(query.mock.calls[0].slice(1)).toEqual(['tenant-a', 'recruiter-a']);
    expect(result.data[0].recruiterId).toBe('recruiter-a');
    expect(result.stats).toEqual({ total: 1, l1Pending: 1, l2Pending: 0, l3Pending: 0 });
  });

  it('binds a different authenticated recruiter rather than a prior owner', async () => {
    await service.findAll('tenant-b', { ...user, dbId: 'recruiter-b' }, { view: 'my' });
    expect(query.mock.calls[0].slice(1)).toEqual(['tenant-b', 'recruiter-b']);
  });

  it('preserves All access granted by submission:view without requiring a named role', async () => {
    await service.findAll('tenant-a', user, { view: 'all' });
    expect(query.mock.calls[0][0]).not.toContain('s.recruiter_id = $2');
    expect(query.mock.calls[0].slice(1)).toEqual(['tenant-a']);
  });

  it('limits create-only access to personal submissions', async () => {
    await service.findAll('tenant-a', { ...user, permissions: ['submission:create'] }, {});
    expect(query.mock.calls[0][0]).toContain('s.recruiter_id = $2');
  });

  it('binds filters and pagination after the owner consistently for count and list', async () => {
    await service.findAll('tenant-a', user, { view: 'my', jobId: 'job-a', finalStatus: 'OFFER', page: 2, limit: 10 });
    expect(query.mock.calls[0].slice(1)).toEqual(['tenant-a', 'recruiter-a', 'job-a', 'OFFER']);
    expect(query.mock.calls[1].slice(1)).toEqual(['tenant-a', 'recruiter-a', 'job-a', 'OFFER', 10, 10]);
    expect(query.mock.calls[0][0]).toContain("COUNT(*) FILTER (WHERE l1_status = 'PENDING')");
  });

  it('tenant-scopes both Pod membership lookups', async () => {
    await service.findAll('tenant-a', user, { view: 'pod' });
    expect(query.mock.calls[0][0]).toContain('WHERE tenant_id = $1 AND pod_id');
    expect(query.mock.calls[0][0]).toContain('id = $2::uuid AND tenant_id = $1');
  });

  it('rejects unauthorized or invalid views before querying', async () => {
    await expect(service.findAll('tenant-a', { ...user, permissions: [] }, {})).rejects.toThrow();
    await expect(service.findAll('tenant-a', { ...user, permissions: ['submission:view'] }, { view: 'pod' })).rejects.toThrow();
    await expect(service.findAll('tenant-a', user, { view: 'invalid' })).rejects.toThrow();
    expect(query).not.toHaveBeenCalled();
  });

  it('uses the same visibility and branch filters for the stats endpoint', async () => {
    const stats = await service.getTrackerStats('tenant-a', user, { view: 'my', branchId: 'branch-a' });
    expect(query.mock.calls[0].slice(1)).toEqual(['tenant-a', 'recruiter-a', 'branch-a']);
    expect(stats.total).toBe(1);
  });

  it('propagates query failures instead of reporting zero statistics', async () => {
    query.mockRejectedValue(new Error('database unavailable'));
    await expect(service.getTrackerStats('tenant-a', user)).rejects.toThrow('database unavailable');
  });
});
