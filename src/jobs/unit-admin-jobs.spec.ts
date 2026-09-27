import { JobsService } from './jobs.service';
describe('Unit Admin job scope', () => {
  const query = jest.fn().mockResolvedValue([]);
  const service = new JobsService({ $queryRawUnsafe: query } as any, {} as any);
  const user = { dbId: 'user', email: 'unit@example.test', branchId: 'home', businessUnitId: 'unit', roles: ['TENANT_ADMIN'], permissions: ['unit_admin:manage', 'job:view', 'job:create'] };
  beforeEach(() => query.mockClear());
  it('applies branch and unit filters even with an admin label and foreign branch input', async () => {
    await service.findAllJobs('tenant', user, 'foreign');
    const [sql, ...params] = query.mock.calls[0];
    expect(sql).toContain('j.business_unit_id = $2');
    expect(sql).toContain('j.branch_id = $3');
    expect(params).toEqual(['tenant', 'unit', 'home']);
    expect(sql).not.toContain('j.recruitment_manager_id =');
  });
  it('fails closed if the unit assignment is missing', async () => {
    expect(await service.findAllJobs('tenant', { ...user, businessUnitId: null })).toEqual([]);
    expect(query).not.toHaveBeenCalled();
  });
});
