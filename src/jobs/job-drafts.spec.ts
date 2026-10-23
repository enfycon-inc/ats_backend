import { JobsService } from './jobs.service';

const draftId = '11111111-1111-4111-8111-111111111111';
const branchId = '22222222-2222-4222-8222-222222222222';
const unitId = '33333333-3333-4333-8333-333333333333';
const ownerId = '44444444-4444-4444-8444-444444444444';
const clientId = '55555555-5555-4555-8555-555555555555';
const actor: any = { dbId: ownerId, tenantId: 'tenant', branchId, businessUnitId: unitId, permissions: ['job:create', 'client:view'] };
const draft = { id: draftId, tenantId: 'tenant', branchId, businessUnitId: unitId, status: 'Draft', accountManagerId: ownerId, deletedAt: null };

function setup(existing: any = null) {
  const prisma: any = {
    job: { findFirst: jest.fn().mockResolvedValue(existing) },
    tenant: { findUnique: jest.fn().mockResolvedValue({ clientsVisibleAcrossUnits: true }) },
    client: { findFirst: jest.fn().mockResolvedValue({ id: clientId, clientName: 'Shared Client' }), findMany: jest.fn().mockResolvedValue([{ status: 'Active', approvalStatus: 'APPROVED' }]) },
    user: { findUnique: jest.fn().mockResolvedValue({ jobReviewerId: 'reviewer' }) },
  };
  const service = new JobsService(prisma, {} as any);
  const create = jest.spyOn(service, 'createJob').mockResolvedValue({ id: draftId, jobStatus: 'Draft' } as any);
  const update = jest.spyOn(service, 'updateJob').mockResolvedValue({ id: draftId, jobStatus: 'Draft' } as any);
  return { prisma, service, create, update };
}

describe('job drafts', () => {
  it('writes a real draft with separate numeric bounds, default one, and no notifications', async () => {
    const notifications: any = { create: jest.fn(), createMany: jest.fn() };
    const prisma: any = {
      tenant: { findUnique: jest.fn().mockResolvedValue({ name: 'Workspace' }) },
      branch: { findFirst: jest.fn().mockResolvedValue({ id: branchId, code: 'BBS', managers: [] }), findUnique: jest.fn().mockResolvedValue(null) },
      businessUnit: { findFirst: jest.fn().mockResolvedValue({ id: unitId, marketSegment: { code: 'IN' }, allowUnassigned: false }) },
      user: { findFirst: jest.fn().mockResolvedValue({ id: ownerId }) },
      $queryRawUnsafe: jest.fn().mockResolvedValue([]),
      job: { findUnique: jest.fn().mockResolvedValue(null), upsert: jest.fn().mockImplementation(({ create }) => Promise.resolve(create)) },
      client: { create: jest.fn() },
    };
    prisma.$transaction = jest.fn(async (work: any) => work(prisma));
    const service = new JobsService(prisma, notifications);
    jest.spyOn(service, 'findOneJob').mockResolvedValue({ id: draftId, jobStatus: 'Draft', type: 'Contract' } as any);
    await service.createJob({ draftId, jobCode: 'BBS-IND-001', branchId, businessUnitId: unitId, title: 'Java Developer', type: 'Contract', description: '<h2>Skills</h2><script>alert(1)</script>', skillsRequired: [], payRate: 'INR - 50,000 to 60,000 /mo', clientBillRate: '' } as any, 'tenant', ownerId, branchId, actor, true);
    expect(prisma.job.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: draftId }, update: {},
      create: expect.objectContaining({ id: draftId, status: 'Draft', jobType: 'Contract', payRateMin: 50000, payRateMax: 60000, payCurrency: 'INR', payTerm: 'Monthly', submissionRequired: 1, market: 'IND', accountManagerId: ownerId, createdByUserId: ownerId }),
    }));
    expect(prisma.client.create).not.toHaveBeenCalled();
    expect(prisma.job.upsert.mock.calls[0][0].create.jobDescription).toBe('<h2>Skills</h2>');
    expect(notifications.create).not.toHaveBeenCalled();
    expect(notifications.createMany).not.toHaveBeenCalled();
  });

  it('updates a draft atomically and rejects a concurrent publication', async () => {
    const existing = { ...draft, market: 'IND', updatedAt: new Date('2026-10-11T00:00:00Z') };
    const prisma: any = {
      job: { findFirst: jest.fn().mockResolvedValue(existing), updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
      jobPod: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const service = new JobsService(prisma, {} as any);
    await expect(service.updateJob(draftId, { status: 'Draft', type: 'Contract', description: '<p onclick="alert(1)">Updated</p>', payRate: 'INR - 50000 to 60000 /mo' }, 'tenant', actor, 'draft')).rejects.toThrow('draft changed');
    expect(prisma.job.updateMany).toHaveBeenCalledWith({
      where: { id: draftId, tenantId: 'tenant', status: 'Draft', updatedAt: existing.updatedAt },
      data: expect.objectContaining({ status: 'Draft', jobType: 'Contract', jobDescription: '<p>Updated</p>', payRateMin: 50000, payRateMax: 60000 }),
    });
  });
  it('saves an incomplete contract without publishing or creating a placeholder client', async () => {
    const { service, create, prisma } = setup();
    await service.saveDraft({ draftId, branchId, businessUnitId: unitId, type: 'Contract' } as any, 'tenant', actor);
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ title: '', type: 'Contract', description: '', status: 'Draft' }), 'tenant', ownerId, undefined, actor, true);
    expect(prisma.client.findFirst).not.toHaveBeenCalled();
  });
  it('reuses the draft identifier on repeated saves', async () => {
    const { service, update, create } = setup(draft);
    await service.saveDraft({ draftId, type: 'Contract', payRate: 'INR - 50000 to 60000 /mo' } as any, 'tenant', actor);
    expect(update).toHaveBeenCalledWith(draftId, expect.objectContaining({ type: 'Contract', status: 'Draft' }), 'tenant', actor, 'draft');
    expect(create).not.toHaveBeenCalled();
  });
  it.each([
    { ...draft, tenantId: 'other' },
    { ...draft, branchId: 'other' },
    { ...draft, businessUnitId: 'other' },
    { ...draft, accountManagerId: 'other' },
    { ...draft, status: 'Active' },
    { ...draft, deletedAt: new Date() },
  ])('rejects inaccessible or non-draft records', async record => {
    const { service, update, create } = setup(record);
    await expect(service.saveDraft({ draftId } as any, 'tenant', actor)).rejects.toThrow();
    expect(update).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });
  it('rejects a unit change outside the active workspace before writing', async () => {
    const { service, update } = setup(draft);
    await expect(service.saveDraft({ draftId, businessUnitId: 'other' } as any, 'tenant', actor)).rejects.toThrow('workspace');
    expect(update).not.toHaveBeenCalled();
  });
  it('rejects unavailable clients instead of implicitly creating them', async () => {
    const { service, prisma, create } = setup();
    prisma.client.findFirst.mockResolvedValue(null);
    await expect(service.saveDraft({ draftId, branchId, businessUnitId: unitId, client: 'Unknown' } as any, 'tenant', actor)).rejects.toThrow('unavailable');
    expect(create).not.toHaveBeenCalled();
  });
  it('uses the same existing client for permanent and contractual drafts', async () => {
    const { service, create } = setup();
    for (const type of ['Full Time', 'Contract']) {
      await service.saveDraft({ draftId, branchId, businessUnitId: unitId, client: 'Shared Client', clientId, type } as any, 'tenant', actor);
    }
    expect(create.mock.calls.map(call => call[0].clientId)).toEqual([clientId, clientId]);
  });
  it('computes publication approval on the server, ignoring forged approval', async () => {
    const { service, update } = setup(draft);
    await service.publishDraft(draftId, { title: 'Java Developer', description: 'Complete job description', type: 'Contract', client: 'Shared Client', clientId, payRate: 'INR - 50000 to 60000 /mo', clientBillRate: 'INR - 70000 /mo', status: 'Active', approvalStatus: 'APPROVED' } as any, 'tenant', actor);
    expect(update).toHaveBeenCalledWith(draftId, expect.objectContaining({ status: 'Pending Approval', approvalStatus: 'PENDING_APPROVAL', assignedApproverId: 'reviewer' }), 'tenant', actor, 'publish');
  });
});
