import { JobsService } from './jobs.service';
describe('Job catalog database pagination', () => {
  const actor: any = { dbId: 'manager', branchId:'branch', permissions: ['job:view', 'job:create'], roles: [] };
  const create = () => {
    const query = jest.fn().mockResolvedValueOnce([{ branches: ['Unit'], clients: ['Client'] }]).mockResolvedValueOnce([{ total: 55 }]).mockResolvedValueOnce([]);
    return { query, service: new JobsService({ $queryRawUnsafe: query } as any, {} as any) };
  };
  it('applies filters before count and database paging, with deterministic order', async () => {
    const { query, service } = create();
    const result = await service.findJobPage('tenant', actor, undefined, { page:'2', limit:'25', search:'Java', sort:'title', direction:'asc', client:'Client' });
    expect(result).toMatchObject({ total:55, page:2, limit:25, totalPages:3 });
    const [countSql, ...countParams] = query.mock.calls[1];
    const [pageSql, ...pageParams] = query.mock.calls[2];
    expect(countSql).toContain('POSITION(LOWER(');
    expect(countSql).toContain('cl.client_name =');
    expect(countSql).toContain('j.tenant_id = $1');
    expect(pageSql).toContain('ORDER BY job_title ASC NULLS LAST, id DESC LIMIT');
    expect(pageParams).toEqual([...countParams,25,25]);
    expect(countParams).toContain('Java');
    expect(countParams).toContain('Client');
  });
  it('returns minimal owner and recruiter filter options from jobs in the authorized catalog scope', async () => {
    const { query, service } = create();
    query.mockReset()
      .mockResolvedValueOnce([{
        account_manager_options: [{ id: 'owner-id', label: 'Visible Owner' }],
        recruiter_options: [{ id: 'recruiter-id', label: 'Visible Recruiter' }],
      }])
      .mockResolvedValueOnce([{ total: 1 }])
      .mockResolvedValueOnce([]);

    const result = await service.findJobPage('tenant', actor, undefined, { page: '1', limit: '25' });
    const optionsSql = query.mock.calls[0][0] as string;

    expect(optionsSql).toContain('WITH option_jobs AS');
    expect(optionsSql).toContain('visible_job.account_manager_id');
    expect(optionsSql).toContain('ats.job_recruiters assigned_recruiter');
    expect(optionsSql).toContain('staff.tenant_id = $1::uuid');
    expect(result.options).toMatchObject({
      accountManagerOptions: [{ id: 'owner-id', label: 'Visible Owner' }],
      recruiterOptions: [{ id: 'recruiter-id', label: 'Visible Recruiter' }],
    });
  });
  it.each([{page:'0'}, {limit:'101'}, {page:'1.5'}])('rejects invalid pagination %o', async query => {
    const { service } = create();
    await expect(service.findJobPage('tenant',actor,undefined,query)).rejects.toThrow('Invalid job pagination');
  });
  it('does not interpolate search or sort input into SQL', async () => {
    const { service } = create();
    await expect(service.findJobPage('tenant',actor,undefined,{sort:'created; DROP TABLE ats.jobs'})).rejects.toThrow('Invalid job sorting');
  });
});
