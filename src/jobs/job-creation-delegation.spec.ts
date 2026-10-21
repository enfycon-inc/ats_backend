import { ForbiddenException } from '@nestjs/common';
import { JobsService } from './jobs.service';

describe('job creation delegation', () => {
  const ownerId = '11111111-1111-4111-8111-111111111111';
  const delegateId = '22222222-2222-4222-8222-222222222222';
  const tenantId = '33333333-3333-4333-8333-333333333333';
  let service: JobsService;
  let prisma: any;

  beforeEach(() => {
    prisma = {
      user: { findFirst: jest.fn().mockResolvedValue({ id: ownerId, roleId: 'owner-role', assignedRoleIds: [] }), findMany: jest.fn() },
      customRole: { findMany: jest.fn().mockResolvedValue([{ permissions: ['job:create'] }]) },
      jobCreationGrant: { findFirst: jest.fn().mockResolvedValue({ id: 'grant-id' }) },
    };
    service = new JobsService(prisma, {} as any);
  });

  it('allows a user with job:create to create for their own account', async () => {
    await expect((service as any).assertCanCreateFor(
      { dbId: ownerId, tenantId, permissions: ['job:create'] }, tenantId, ownerId,
    )).resolves.toBeUndefined();
    expect(prisma.jobCreationGrant.findFirst).not.toHaveBeenCalled();
  });

  it('allows creation for another owner only when a live tenant grant exists', async () => {
    await expect((service as any).assertCanCreateFor(
      { dbId: delegateId, tenantId, permissions: ['job:view'] }, tenantId, ownerId,
    )).resolves.toEqual(expect.objectContaining({ id: 'grant-id' }));
    expect(prisma.jobCreationGrant.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { tenantId, accountManagerId: ownerId, delegateUserId: delegateId, revokedAt: null },
    }));
  });

  it('denies delegated creation after the grant is revoked', async () => {
    prisma.jobCreationGrant.findFirst.mockResolvedValue(null);
    await expect((service as any).assertCanCreateFor(
      { dbId: delegateId, tenantId, permissions: ['job:view'] }, tenantId, ownerId,
    )).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('denies delegated creation after the grant expires', async () => {
    prisma.jobCreationGrant.findFirst.mockResolvedValue({ id: 'grant-id', expiresAt: new Date(Date.now() - 60_000), maxJobs: null, jobsUsed: 0 });
    await expect((service as any).assertCanCreateFor(
      { dbId: delegateId, tenantId, permissions: ['job:view'] }, tenantId, ownerId,
    )).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('denies delegated creation after its job limit is used', async () => {
    prisma.jobCreationGrant.findFirst.mockResolvedValue({ id: 'grant-id', expiresAt: null, maxJobs: 2, jobsUsed: 2 });
    await expect((service as any).assertCanCreateFor(
      { dbId: delegateId, tenantId, permissions: ['job:view'] }, tenantId, ownerId,
    )).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('allows an existing delegated draft to be worked on after its job quota is used', async () => {
    prisma.jobCreationGrant.findFirst.mockResolvedValue({ id: 'grant-id', expiresAt: null, maxJobs: 1, jobsUsed: 1 });
    await expect((service as any).assertCanCreateFor(
      { dbId: delegateId, tenantId, permissions: ['job:view'] }, tenantId, ownerId, true,
    )).resolves.toEqual(expect.objectContaining({ id: 'grant-id' }));
  });

  it('rejects a request whose tenant does not match the authenticated user', async () => {
    await expect((service as any).assertCanCreateFor(
      { dbId: delegateId, tenantId, permissions: ['job:view'] }, 'other-tenant', ownerId,
    )).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.user.findFirst).not.toHaveBeenCalled();
  });

  it('does not let a generic job creator grant colleague access', async () => {
    await expect(service.listJobCreationGrantPeople({
      dbId: ownerId, tenantId, permissions: ['job:create'],
    } as any)).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.user.findMany).not.toHaveBeenCalled();
  });

  it('does not let generic user-management permission grant job access', async () => {
    await expect(service.listJobCreationGrantPeople({
      dbId: ownerId, tenantId, permissions: ['user:manage'],
    } as any)).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.user.findMany).not.toHaveBeenCalled();
  });

  it('limits branch admins to job owners in their branch', () => {
    const actor = { branchId: 'branch-a', businessUnitId: 'unit-a', permissions: ['job:manage_creation_access', 'branch_admin:manage'] };
    expect((service as any).canManageJobOwnerScope(actor, { branchId: 'branch-a', businessUnitId: 'unit-b' })).toBe(true);
    expect((service as any).canManageJobOwnerScope(actor, { branchId: 'branch-b', businessUnitId: 'unit-a' })).toBe(false);
  });

  it.each([
    ['Unit Admin', ['job:manage_creation_access', 'unit_admin:manage']],
    ['Delivery Head', ['job:manage_creation_access', 'unit_admin:manage']],
  ])('%s can manage job access only in the assigned unit', (_role, permissions) => {
    const actor = { branchId: 'branch-a', businessUnitId: 'unit-a', permissions };
    expect((service as any).canManageJobOwnerScope(actor, { branchId: 'branch-a', businessUnitId: 'unit-a' })).toBe(true);
    expect((service as any).canManageJobOwnerScope(actor, { branchId: 'branch-a', businessUnitId: 'unit-b' })).toBe(false);
    expect((service as any).canManageJobOwnerScope(actor, { branchId: 'branch-b', businessUnitId: 'unit-a' })).toBe(false);
  });

  it('lets an account manager grant same-unit access and records the issuer', async () => {
    const branchId = '44444444-4444-4444-8444-444444444444';
    const businessUnitId = '55555555-5555-4555-8555-555555555555';
    prisma.user.findFirst.mockImplementation(({ where }: any) => Promise.resolve({
      id: where.id,
      branchId,
      businessUnitId,
      roleId: 'owner-role',
      assignedRoleIds: [],
    }));
    prisma.jobCreationGrant.upsert = jest.fn().mockResolvedValue({ id: 'grant-id', accountManagerId: ownerId, delegateUserId: delegateId, revokedAt: null });
    prisma.auditLog = { create: jest.fn().mockResolvedValue({}) };

    await service.createJobCreationGrant({
      dbId: ownerId, tenantId, branchId, businessUnitId, email: 'owner@example.test', permissions: ['job:grant_creation_delegate'],
    } as any, ownerId, delegateId);

    expect(prisma.jobCreationGrant.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({ tenantId, accountManagerId: ownerId, delegateUserId: delegateId, grantedByUserId: ownerId, expiresAt: null, maxJobs: null, jobsUsed: 0 }),
      update: expect.objectContaining({ expiresAt: null, maxJobs: null, jobsUsed: 0, revokedAt: null }),
    }));
    expect(prisma.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ action: 'JOB_CREATION_ACCESS_GRANTED', actorId: ownerId }),
    }));
  });

  it('prevents an administrator from granting access across business units', async () => {
    const branchId = '44444444-4444-4444-8444-444444444444';
    prisma.user.findFirst.mockImplementation(({ where }: any) => Promise.resolve({
      id: where.id,
      branchId,
      businessUnitId: where.id === ownerId ? 'owner-unit' : 'delegate-unit',
      roleId: 'owner-role',
      assignedRoleIds: [],
    }));
    prisma.jobCreationGrant.upsert = jest.fn();

    await expect(service.createJobCreationGrant({
      dbId: 'admin-id', tenantId, branchId, businessUnitId: 'owner-unit', permissions: ['job:manage_creation_access', 'branch_admin:manage'],
    } as any, ownerId, delegateId)).rejects.toThrow('same business unit');
    expect(prisma.jobCreationGrant.upsert).not.toHaveBeenCalled();
  });
});
