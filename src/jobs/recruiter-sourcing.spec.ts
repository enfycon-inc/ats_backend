import { JobsService } from './jobs.service';

describe('Recruiter sourcing scope', () => {
  const query = jest.fn().mockResolvedValue([]);
  const service = new JobsService({ $queryRawUnsafe: query } as any, {} as any);
  const user = { dbId: 'recruiter-a', branchId: 'branch-a', permissions: ['job:view'], roles: [] };
  beforeEach(() => query.mockClear());

  it('requires explicit pod access while preserving direct assignments and scope', async () => {
    await service.findAllJobs('tenant-a', user, undefined, 'sourcing');
    const [sql, ...params] = query.mock.calls[0];
    expect(sql).toContain('j.tenant_id = $1 AND j.deleted_at IS NULL');
    expect(sql).toContain('j.branch_id = $3');
    expect(sql).toContain("UPPER(j.status) = 'ACTIVE'");
    expect(sql).toContain('jr_s.recruiter_id = $6::uuid');
    expect(sql).toContain('OR EXISTS (');
    expect(sql).toContain('u_s.pod_id = p_s.id AND u_s.tenant_id = $1');
    expect(sql).toContain('p_s.tenant_id = $1');
    expect(sql).toContain('u_s.id = $6::uuid AND u_s.is_active = true');
    expect(sql).toContain('FALSE OR p_s.pod_head_id = u_s.id');
    // EXISTS preserves one row when the same job has both assignment paths.
    expect(sql).not.toContain('JOIN ats.job_recruiters jr_s ON');
    expect(params).toEqual(['tenant-a', 'recruiter-a', 'branch-a', 'recruiter-a', 'recruiter-a', 'recruiter-a']);
  });

  it('fails closed without an authenticated database identity', async () => {
    expect(await service.findAllJobs('tenant-a', { ...user, dbId: undefined }, undefined, 'sourcing')).toEqual([]);
    expect(query).not.toHaveBeenCalled();
  });

  it('keeps personal sourcing restricted even with broader job permissions', async () => {
    await service.findAllJobs('tenant-a', { ...user, permissions: ['job:view', 'job:view_all_branches'] }, undefined, 'sourcing');
    const [sql, ...params] = query.mock.calls[0];
    expect(sql).toContain('jr_s.recruiter_id = $3::uuid');
    expect(sql).toContain('u_s.id = $3::uuid');
    expect(params).toEqual(['tenant-a', 'recruiter-a', 'recruiter-a']);
  });

  it('leaves general job catalog requests unchanged', async () => {
    await service.findAllJobs('tenant-a', user);
    expect(query.mock.calls[0][0]).not.toContain('jr_s.recruiter_id');
  });
});
