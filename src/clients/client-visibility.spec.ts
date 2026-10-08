import { clientReadWhere, clientJobReadWhere } from './client-visibility';
import { ClientsService } from './clients.service';
import { ClientContactsService } from '../client-contacts/client-contacts.service';

describe('tenant client visibility policy', () => {
  const actor: any = { tenantId: 'tenant', dbId: 'am', email: 'am@example.test', branchId: 'branch', businessUnitId: 'unit', permissions: ['client:view', 'job:view'] };
  const prisma: any = { tenant: { findUnique: jest.fn() }, user: { findMany: jest.fn() } };
  beforeEach(() => {
    jest.clearAllMocks();
    prisma.tenant.findUnique.mockResolvedValue({ clientsVisibleAcrossUnits: false });
    prisma.user.findMany.mockResolvedValue([{ id: actor.dbId, email: actor.email }]);
  });
  it('disabled restricts Account Manager to own clients and branch', async () => {
    const scope = await clientReadWhere(prisma, actor.tenantId, actor);
    expect(scope).toMatchObject({ tenantId: actor.tenantId, AND: [expect.anything(), { OR: [{ primaryOwner: { in: [actor.dbId, actor.email] } }, { AND: [expect.anything(), { createdBy: { in: [actor.dbId, actor.email] } }] }] }] });
    expect(JSON.stringify(scope)).toContain('branch');
    expect(prisma.user.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { tenantId: 'tenant', branchId: 'branch', businessUnitId: 'unit' } }));
  });
  it('enabled allows tenant client reads but never other tenants', async () => {
    prisma.tenant.findUnique.mockResolvedValue({ clientsVisibleAcrossUnits: true });
    expect(await clientReadWhere(prisma, 'tenant', actor)).toEqual({ tenantId: 'tenant' });
    await expect(clientReadWhere(prisma, 'foreign', actor)).rejects.toThrow('workspace');
    expect(prisma.user.findMany).not.toHaveBeenCalled();
  });
  it('enabled still requires the switched role client viewing permission', async () => {
    prisma.tenant.findUnique.mockResolvedValue({ clientsVisibleAcrossUnits: true });
    await expect(clientReadWhere(prisma, 'tenant', { ...actor, permissions: [], roles: ['TENANT_ADMIN'] })).rejects.toThrow('permission');
  });
  it('tenant administration retains tenant access when disabled', async () => {
    expect(await clientReadWhere(prisma, 'tenant', { ...actor, permissions: ['client:view', 'tenant:settings'] })).toEqual({ tenantId: 'tenant' });
  });
  it('branch administration does not use another unit to widen its branch', async () => {
    const scope = await clientReadWhere(prisma, 'tenant', { ...actor, permissions: ['client:view', 'branch_admin:manage'] });
    expect(scope.AND).toHaveLength(1);
    expect(prisma.user.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { tenantId: 'tenant', branchId: 'branch' } }));
  });
  it('unit administration only receives owners from its own unit', async () => {
    const scope = await clientReadWhere(prisma, 'tenant', { ...actor, permissions: ['client:view', 'unit_admin:manage'] });
    expect(scope.AND).toHaveLength(2);
    expect(prisma.user.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { tenantId: 'tenant', branchId: 'branch', businessUnitId: 'unit' } }));
  });
  it('does not guess a global scope for unassigned staff', async () => {
    await expect(clientReadWhere(prisma, 'tenant', { ...actor, branchId: undefined })).rejects.toThrow('branch');
    await expect(clientReadWhere(prisma, 'tenant', { ...actor, businessUnitId: undefined })).rejects.toThrow('unit');
  });
  it('global client viewing does not change job visibility', () => {
    expect(clientJobReadWhere('tenant', actor)).toEqual({ tenantId: 'tenant', branchId: 'branch', businessUnitId: 'unit' });
    expect(clientJobReadWhere('tenant', { ...actor, permissions: ['client:view'] })).toMatchObject({ id: { in: [] } });
  });
  it('checks client access before querying contacts', async () => {
    prisma.client = { findFirst: jest.fn().mockResolvedValue(null) };
    prisma.clientContact = { findMany: jest.fn() };
    await expect(new ClientContactsService(prisma).findAllForClient('client', 'tenant', actor.dbId, actor)).rejects.toThrow('not found');
    expect(prisma.client.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ id: 'client', tenantId: 'tenant', AND: expect.any(Array) }) }));
    expect(prisma.clientContact.findMany).not.toHaveBeenCalled();
  });
  it('only a switched role with tenant settings permission may change the policy', async () => {
    await expect(new ClientsService(prisma).setVisibilityPolicy(actor, true)).rejects.toThrow('Tenant settings permission');
  });
  it('validates booleans and audits updates in the same transaction', async () => {
    const admin = { ...actor, permissions: ['tenant:settings'] };
    await expect(new ClientsService(prisma).setVisibilityPolicy(admin, 'true')).rejects.toThrow('enabled or disabled');
    const tx: any = { tenant: { findUnique: jest.fn().mockResolvedValue({ clientsVisibleAcrossUnits: false }), update: jest.fn().mockResolvedValue({ clientsVisibleAcrossUnits: true }) }, auditLog: { create: jest.fn() } };
    prisma.$transaction = jest.fn(callback => callback(tx));
    expect(await new ClientsService(prisma).setVisibilityPolicy(admin, true)).toEqual({ clientsVisibleAcrossUnits: true });
    expect(tx.tenant.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'tenant' } }));
    expect(tx.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ actorId: 'am', tenantId: 'tenant', details: { previous: false, enabled: true } }) }));
  });
});
