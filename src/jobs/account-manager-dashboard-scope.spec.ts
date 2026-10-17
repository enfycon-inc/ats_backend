import { JobsService } from './jobs.service';

describe('Account manager dashboard job scope', () => {
  const query = jest.fn().mockResolvedValue([]);
  const service = new JobsService({ $queryRawUnsafe: query } as any, {} as any);
  const user = {
    dbId: 'account-manager-a',
    branchId: 'branch-a',
    businessUnitId: 'unit-a',
    roles: ['ACCOUNT_MANAGER'],
    permissions: ['job:view', 'job:create'],
  };

  beforeEach(() => query.mockClear());

  it('returns only jobs owned by the signed-in account manager for dashboard requests', async () => {
    await service.findAllJobs('tenant-a', user, undefined, 'dashboard');

    const [sql, ...params] = query.mock.calls[0];
    expect(sql).toContain('j.business_unit_id =');
    expect(sql).toMatch(/AND j\.account_manager_id = \$\d+::uuid/);
    expect(sql).not.toContain('OR j.recruitment_manager_id =');
    expect(params).toContain('account-manager-a');
    expect(params).toContain('unit-a');
  });

  it('fails closed when the authenticated database user ID is missing', async () => {
    await expect(service.findAllJobs('tenant-a', { ...user, dbId: undefined }, undefined, 'dashboard')).resolves.toEqual([]);
    expect(query).not.toHaveBeenCalled();
  });

  it('leaves unfiltered job catalog requests available within the existing unit scope', async () => {
    await service.findAllJobs('tenant-a', user);

    const [sql] = query.mock.calls[0];
    expect(sql).toContain('j.business_unit_id =');
    expect(sql).not.toContain('j.account_manager_id =');
  });
});
