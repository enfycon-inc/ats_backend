import { RecruiterSubmissionsService } from './recruiter-submissions.service';
import { RecruiterSubmissionsController } from './recruiter-submissions.controller';

describe('branch remark ownership', () => {
  const user: any = { branchId: 'home', permissions: ['branch_admin:manage'] };
  let prisma: any;
  let service: RecruiterSubmissionsService;
  beforeEach(() => {
    prisma = { branch: { findFirst: jest.fn().mockResolvedValue({ id: 'home' }) }, $queryRawUnsafe: jest.fn().mockResolvedValue([{ id: 1 }]) };
    service = new RecruiterSubmissionsService(prisma, {} as any);
  });
  it('allows adding remarks to the assigned branch', async () => {
    await service.createCustomRemark('tenant', 'review', 'Good fit', 'ACCEPT', 'home', 'member', false, user);
    expect(prisma.branch.findFirst).toHaveBeenCalledWith({ where: { id: 'home', tenantId: 'tenant' }, select: { id: true } });
    expect(prisma.$queryRawUnsafe).toHaveBeenCalled();
  });
  it('rejects adding remarks to a different branch before writing', async () => {
    await expect(service.createCustomRemark('tenant', 'review', 'Good fit', 'ACCEPT', 'other', 'member', false, user)).rejects.toThrow();
    expect(prisma.$queryRawUnsafe).not.toHaveBeenCalled();
  });
  it('rejects deleting another branch remark', async () => {
    prisma.$queryRawUnsafe.mockResolvedValueOnce([{ id: 1, tenant_id: 'tenant', branch_id: 'other', is_global: false }]);
    await expect(service.deleteCustomRemark('tenant', 1, user)).rejects.toThrow();
    expect(prisma.$queryRawUnsafe).toHaveBeenCalledTimes(1);
  });
  it('requires an edit capability even for the assigned branch', async () => {
    await expect(service.createCustomRemark('tenant', 'review', 'Good fit', 'ACCEPT', 'home', 'member', false, { ...user, permissions: [] })).rejects.toThrow();
  });
  it('preserves co-sourced cross-branch template reads within the active tenant', async () => {
    const getCustomRemarks = jest.fn().mockResolvedValue([]);
    const controller = new RecruiterSubmissionsController({ getCustomRemarks } as any);
    await controller.getCustomRemarks('other', 'false', { ...user, tenantId: 'tenant' });
    expect(getCustomRemarks).toHaveBeenCalledWith('tenant', 'other', false);
  });
  it('keeps a cross-branch local template read constrained to tenant and branch', async () => {
    await service.getCustomRemarks('tenant', 'home', false);
    const [query, ...params] = prisma.$queryRawUnsafe.mock.calls[0];
    expect(query).toContain('WHERE tenant_id = $1 AND branch_id = $2');
    expect(params).toEqual(['tenant', 'home']);
  });
  it('defaults an unscoped remarks read to the assigned branch', async () => {
    const getCustomRemarks = jest.fn().mockResolvedValue([]);
    const controller = new RecruiterSubmissionsController({ getCustomRemarks } as any);
    await controller.getCustomRemarks('', 'false', { ...user, tenantId: 'tenant' });
    expect(getCustomRemarks).toHaveBeenCalledWith('tenant', 'home', false);
  });
});
