import { candidateMarket, candidateAdminScope, candidateProfileGrants, resolveCandidateWorkspace } from './candidate-workspace';
import { CandidatesService } from './candidates.service';

describe('candidate staffing context and profile permissions', () => {
  const actor: any = { dbId: 'staff', tenantId: 'tenant', branchId: 'branch', businessUnitId: 'unit', permissions: ['candidate:create'] };
  const database = (code = 'IND') => ({
    user: { findFirst: jest.fn().mockResolvedValue({ branchId: 'branch', businessUnitId: 'unit', fullName: 'Uploader' }) },
    branch: { findFirst: jest.fn().mockResolvedValue({ id: 'branch' }) },
    businessUnit: { findFirst: jest.fn().mockResolvedValue({ marketSegment: { code, isActive: true } }) },
    tenant: { findUnique: jest.fn().mockResolvedValue({ defaultMarket: 'US' }) },
  }) as any;
  it.each(['IN', 'IND', 'INDIA'])('saves India staffing %s as IN, even when tenant default is US', async code => {
    const db = database(code);
    expect(await resolveCandidateWorkspace(db, actor, 'tenant')).toMatchObject({ market: 'IN', branchId: 'branch', uploadedByUserId: 'staff', uploadedByName: 'Uploader' });
    expect(db.tenant.findUnique).not.toHaveBeenCalled();
  });
  it('keeps US IT uploads in US', async () => {
    expect((await resolveCandidateWorkspace(database('USIT'), actor, 'tenant')).market).toBe('US');
  });
  it('includes canonical IN uploads in legacy INDIA candidate searches', async () => {
    const db: any = { tenant: { findUnique: jest.fn().mockResolvedValue({ candidatePoolMode: 'COMBINED_MARKET' }) }, candidate: { findMany: jest.fn().mockResolvedValue([]) } };
    const service = new CandidatesService(db, {} as any);
    await service.findAll({ market: 'INDIA' }, 'tenant');
    expect(db.candidate.findMany.mock.calls[0][0].where.OR).toEqual(['IN', 'IND', 'INDIA'].map(market => ({ market: { equals: market, mode: 'insensitive' } })));
  });
  it('fails closed for missing unit market instead of defaulting to US', async () => {
    const db = database(); db.businessUnit.findFirst.mockResolvedValue({ marketSegment: null });
    await expect(resolveCandidateWorkspace(db, actor, 'tenant')).rejects.toThrow('active staffing market');
  });
  it('rejects forged tenant and branch selections', async () => {
    await expect(resolveCandidateWorkspace(database(), actor, 'foreign')).rejects.toThrow('workspace');
    await expect(resolveCandidateWorkspace(database(), actor, 'tenant', 'foreign')).rejects.toThrow('assigned branch');
  });
  it('derives authorized job uploads from the job market', async () => {
    const db = database('USIT');
    db.job = { findFirst: jest.fn().mockResolvedValue({ id: 'job', market: 'IND', branchId: 'branch', status: 'Active', approvalStatus: 'APPROVED' }) };
    db.jobRecruiter = { findUnique: jest.fn().mockResolvedValue({ jobId: 'job' }) };
    expect((await resolveCandidateWorkspace(db, { ...actor, permissions: ['submission:create'] }, 'tenant', null, 'job')).market).toBe('IN');
    db.jobRecruiter.findUnique.mockResolvedValue(null);
    await expect(resolveCandidateWorkspace(db, { ...actor, permissions: ['submission:create'] }, 'tenant', null, 'job')).rejects.toThrow('assign');
  });
  it('uses explicit grants and branch scope, never role names', () => {
    const admin = { ...actor, permissions: ['unit_admin:manage', 'candidate:edit', 'candidate:change_market'] };
    expect(candidateAdminScope(admin, { branchId: 'branch' }, 'candidate:edit')).toBe(true);
    expect(candidateAdminScope(admin, { branchId: 'foreign' }, 'candidate:edit')).toBe(false);
    expect(candidateAdminScope({ ...actor, roles: ['DELIVERY_HEAD'], permissions: ['candidate:edit'] }, {}, 'candidate:edit')).toBe(false);
    expect(candidateProfileGrants(['submission:create'])).toEqual([]);
    expect(candidateProfileGrants(['unit_admin:manage'])).toEqual(['candidate:edit', 'candidate:change_market']);
    expect(() => candidateMarket('')).toThrow('market');
  });
  it('audits manual market edits atomically and blocks recruiter mutations', async () => {
    const db: any = { candidate: { findFirst: jest.fn().mockResolvedValue({ id: 'candidate', market: 'US', branchId: 'branch', updatedAt: new Date() }), updateMany: jest.fn().mockResolvedValue({ count: 1 }) }, marketSegment: { findFirst: jest.fn().mockResolvedValue({ id: 'india' }) }, auditLog: { create: jest.fn() } };
    db.$transaction = async (fn: any) => fn(db);
    const service = new CandidatesService(db, {} as any);
    jest.spyOn(service, 'findOne').mockResolvedValue({} as any);
    await expect(service.updateCandidate('candidate', { market: 'IN' }, 'tenant', actor)).rejects.toThrow('administration');
    expect(db.candidate.updateMany).not.toHaveBeenCalled();
    const admin = { ...actor, permissions: ['unit_admin:manage', 'candidate:edit', 'candidate:change_market'] };
    await service.updateCandidate('candidate', { market: 'IND' }, 'tenant', admin);
    expect(db.candidate.updateMany.mock.calls[0][0].data.market).toBe('IN');
    expect(db.auditLog.create.mock.calls[0][0].data.details).toMatchObject({ previousMarket: 'US', market: 'IN' });
    await expect(service.updateCandidate('candidate', { market: 'IN' }, 'tenant', { ...admin, permissions: ['unit_admin:manage', 'candidate:edit'] })).rejects.toThrow('change_market');
  });
  it('persists bulk upload market and attribution without using resume location as the market', async () => {
    let saved: any;
    const db: any = { candidate: { findFirst: jest.fn().mockResolvedValue(null), create: jest.fn(async ({ data }) => (saved = { ...data, id: 'candidate' })), update: jest.fn(async () => saved) }, resume: { create: jest.fn().mockResolvedValue({ id: 'resume' }) } };
    db.$transaction = async (fn: any) => fn(db);
    const service = new CandidatesService(db, {} as any);
    jest.spyOn(service, 'findByHash').mockResolvedValue(null);
    jest.spyOn(service, 'parseResumeFile').mockResolvedValue({ candidate_name: 'Example', contact: { emails: ['example@example.invalid'], phones: [] }, location: 'New York', skills: ['Python'] });
    jest.spyOn(service as any, 'mapCandidateToProfile').mockImplementation(value => value);
    await service.saveUploadedCv({ originalname: 'example.txt', mimetype: 'text/plain', buffer: Buffer.from('example') }, 'tenant', { source: 'Bulk Upload', market: 'IN', branchId: 'branch', uploadedByUserId: 'uploader', uploadedByName: 'Uploader' });
    expect(saved).toMatchObject({ market: 'IN', branchId: 'branch', uploadedByUserId: 'uploader', uploadedByName: 'Uploader', rawCurrentLocation: 'New York' });
  });
});
