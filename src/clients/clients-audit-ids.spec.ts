import { ClientsService } from './clients.service';
import { ClientsController } from './clients.controller';

describe('client audit user IDs', () => {
  const actorId = 'f8bdcd3f-c327-46ea-a277-678e812d5c74';
  const tenantId = '154fbda6-0a8f-4fa5-9c12-93727235798e';
  const clientId = '737f666b-916a-4e9c-91bd-b2bd37e475d1';
  const uuid = /^[0-9a-f-]{36}$/i;
  function setup(direct = true) {
    const prisma = {
      user: { findFirst: jest.fn().mockResolvedValue({ id: actorId, fullName: 'developer enfycon', email: 'developer@enfycon.com', roleId: actorId, assignedRoleIds: [], jobReviewerId: actorId }) },
      tenant: { findUnique: jest.fn().mockResolvedValue({ prefixCode: 'ENFY', name: 'Enfycon' }) },
      tenantCounters: { upsert: jest.fn().mockResolvedValue({ currentValue: 1 }) },
      customRole: { findMany: jest.fn().mockResolvedValue([{ permissions: direct ? ['client:direct_add'] : ['client:create'] }]) },
      systemRole: { findMany: jest.fn().mockResolvedValue([]) },
      client: {
        findFirst: jest.fn().mockResolvedValue({ id: clientId }),
        create: jest.fn(async ({ data }) => {
          for (const field of ['createdBy', 'approvedBy', 'assignedApproverId']) {
            if (data[field] != null && !uuid.test(data[field])) throw new Error(`Prisma UUID failure: ${field}`);
          }
          return { id: clientId, ...data };
        }),
        update: jest.fn(async ({ data }) => ({ id: clientId, ...data })),
      },
    };
    return { prisma, service: new ClientsService(prisma as any) };
  }
  it('stores the creator UUID instead of their display name on direct creation', async () => {
    const { service, prisma } = setup();
    await service.createClient({ client_name: 'Google', email_id: 'jobs@google.com' }, tenantId, actorId);
    expect(prisma.client.create.mock.calls[0][0].data).toMatchObject({ createdBy: actorId, approvedBy: actorId, approvalStatus: 'APPROVED' });
  });
  it('keeps approval audit fields empty while a client waits for review', async () => {
    const { service, prisma } = setup(false);
    await service.createClient({ client_name: 'Google' }, tenantId, actorId);
    expect(prisma.client.create.mock.calls[0][0].data).toMatchObject({ createdBy: actorId, approvedBy: null, approvedAt: null, approvalStatus: 'PENDING_APPROVAL', assignedApproverId: actorId });
  });
  it.each(['System', 'developer enfycon', 'developer@enfycon.com'])('rejects non-UUID actor %s before allocating a code', async actor => {
    const { service, prisma } = setup();
    await expect(service.createClient({ client_name: 'Google' }, tenantId, actor)).rejects.toThrow('authenticated user ID');
    expect(prisma.tenantCounters.upsert).not.toHaveBeenCalled();
    expect(prisma.client.create).not.toHaveBeenCalled();
  });
  it('rejects actors outside the target workspace before allocating a code', async () => {
    const { service, prisma } = setup();
    prisma.user.findFirst.mockResolvedValue(null as any);
    await expect(service.createClient({ client_name: 'Google' }, tenantId, actorId)).rejects.toThrow('workspace');
    expect(prisma.tenantCounters.upsert).not.toHaveBeenCalled();
  });
  it('passes database IDs through create, approve and reject controllers', async () => {
    const calls = { createClient: jest.fn(), approveClient: jest.fn(), rejectClient: jest.fn() };
    const controller = new ClientsController(calls as any);
    const user: any = { dbId: actorId, tenantId, fullName: 'developer enfycon', email: 'developer@enfycon.com', permissions: ['client:approve', 'client:reject'] };
    await controller.create({ client_name: 'Google' }, user);
    await controller.approve(clientId, user);
    await controller.reject(clientId, { reason: 'Review failed' }, user);
    expect(calls.createClient).toHaveBeenCalledWith({ client_name: 'Google' }, tenantId, actorId);
    expect(calls.approveClient).toHaveBeenCalledWith(clientId, tenantId, actorId);
    expect(calls.rejectClient).toHaveBeenCalledWith(clientId, tenantId, actorId, 'Review failed');
  });
  it('keeps approval permission checks in place', async () => {
    const calls = { approveClient: jest.fn() };
    const controller = new ClientsController(calls as any);
    await expect(controller.approve(clientId, { dbId: actorId, tenantId, permissions: [] } as any)).rejects.toThrow();
    expect(calls.approveClient).not.toHaveBeenCalled();
  });
});
