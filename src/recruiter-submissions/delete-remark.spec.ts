import { BadRequestException, ForbiddenException, NotFoundException, ParseIntPipe } from '@nestjs/common';
import { ROUTE_ARGS_METADATA } from '@nestjs/common/constants';
import { RecruiterSubmissionsController } from './recruiter-submissions.controller';
import { RecruiterSubmissionsService } from './recruiter-submissions.service';

describe('template deletion', () => {
  const branchUser: any = { branchId: 'home', permissions: ['branch_admin:manage'] };
  const globalUser: any = { permissions: ['platform:manage'] };
  let prisma: any;
  let service: RecruiterSubmissionsService;
  beforeEach(() => {
    prisma = { $queryRawUnsafe: jest.fn().mockResolvedValueOnce([{ id: 19, tenant_id: 'tenant', branch_id: 'home', is_global: false }]).mockResolvedValue([]) };
    service = new RecruiterSubmissionsService(prisma, {} as any);
  });
  it('wires an integer parser to the actual template route', async () => {
    const metadata = Reflect.getMetadata(ROUTE_ARGS_METADATA, RecruiterSubmissionsController, 'deleteCustomRemark');
    const argument: any = Object.values(metadata).find((value: any) => value.index === 0);
    expect(argument.pipes).toContain(ParseIntPipe);
    expect(await new ParseIntPipe().transform('19', { type: 'param' })).toBe(19);
    await expect(new ParseIntPipe().transform('not-an-id', { type: 'param' })).rejects.toThrow(BadRequestException);
  });
  it('allows the authorized branch owner to delete a numeric template', async () => {
    expect(await service.deleteCustomRemark('tenant', 19, branchUser)).toMatchObject({ id: 19 });
    expect(prisma.$queryRawUnsafe.mock.calls[1]).toEqual(['DELETE FROM ats.tenant_stage_remarks WHERE id = $1', 19]);
  });
  it.each([0, -1, 1.5, 2147483648, NaN])('rejects invalid ID %s without querying', async id => {
    await expect(service.deleteCustomRemark('tenant', id, globalUser)).rejects.toThrow(BadRequestException);
    expect(prisma.$queryRawUnsafe).not.toHaveBeenCalled();
  });
  it.each([
    ['other-tenant', branchUser],
    ['tenant', { ...branchUser, branchId: 'other' }],
    ['tenant', { ...branchUser, permissions: [] }],
  ])('denies guessed IDs outside the caller ownership or permissions', async (tenant, user) => {
    await expect(service.deleteCustomRemark(tenant, 19, user)).rejects.toThrow(ForbiddenException);
    expect(prisma.$queryRawUnsafe).toHaveBeenCalledTimes(1);
  });
  it('denies a tenant admin deletion of a global template', async () => {
    prisma.$queryRawUnsafe.mockReset().mockResolvedValue([{ id: 19, tenant_id: 'tenant', branch_id: null, is_global: true }]);
    await expect(service.deleteCustomRemark('tenant', 19, { permissions: ['tenant:manage'] } as any)).rejects.toThrow(ForbiddenException);
    expect(prisma.$queryRawUnsafe).toHaveBeenCalledTimes(1);
  });
  it('allows a global administrator deletion of a universal template', async () => {
    prisma.$queryRawUnsafe.mockReset().mockResolvedValueOnce([{ id: 19, tenant_id: 'origin', branch_id: null, is_global: true }]).mockResolvedValue([]);
    await service.deleteCustomRemark('tenant', 19, globalUser);
    expect(prisma.$queryRawUnsafe).toHaveBeenCalledTimes(2);
  });
  it('returns not found without a deletion for an absent ID', async () => {
    prisma.$queryRawUnsafe.mockReset().mockResolvedValue([]);
    await expect(service.deleteCustomRemark('tenant', 19, globalUser)).rejects.toThrow(NotFoundException);
    expect(prisma.$queryRawUnsafe).toHaveBeenCalledTimes(1);
  });
});
