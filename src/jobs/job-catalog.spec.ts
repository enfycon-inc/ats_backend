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
  it.each([{page:'0'}, {limit:'101'}, {page:'1.5'}])('rejects invalid pagination %o', async query => {
    const { service } = create();
    await expect(service.findJobPage('tenant',actor,undefined,query)).rejects.toThrow('Invalid job pagination');
  });
  it('does not interpolate search or sort input into SQL', async () => {
    const { service } = create();
    await expect(service.findJobPage('tenant',actor,undefined,{sort:'created; DROP TABLE ats.jobs'})).rejects.toThrow('Invalid job sorting');
  });
});
