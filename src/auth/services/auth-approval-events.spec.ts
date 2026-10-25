import { AuthUserService } from './auth-user.service';

describe('atomic approval and queued email events', () => {
  const userId = 'f8bdcd3f-c327-46ea-a277-678e812d5c74';
  const roleId = 'd7746edf-4e8a-4a9a-866b-7d5b90896003';
  const requester: any = { dbId: 'admin', tenantId: 'tenant', fullName: 'Administrator', roles: [], permissions: ['tenant:manage'], email: 'admin@example.com' };
  function setup(writeCount = 1, failQueue = false) {
    let committed = false;
    const target = { id: userId, tenant_id: 'tenant', email: 'user@example.com', full_name: 'User', is_active: true, is_approved: false, requested_role: roleId, tenant_name: 'Workspace', tenant_domain: 'workspace' };
    const query = jest.fn(async (sql: string) => {
      if (sql.includes('SELECT u.id, u.email, u.full_name')) return { rows: [target] };
      if (sql.includes('cr.permissions')) return { rows: [{ id: roleId, name: 'Delivery Head', permissions: [], branch_id: null, business_unit_id: null }] };
      return { rows: [] };
    });
    const tx = { $queryRawUnsafe: jest.fn().mockResolvedValue(writeCount ? [{ id: userId }] : []) };
    const prisma = { $transaction: jest.fn(async fn => { const result = await fn(tx); committed = true; return result; }) };
    const enqueueApproval = jest.fn(async () => { expect(committed).toBe(false); if (failQueue) throw new Error('queue failed'); });
    const sendToUser = jest.fn(async () => { expect(committed).toBe(true); });
    const mail = { sendRoleApprovalWelcomeEmail: jest.fn() };
    const service = new AuthUserService({ query, prisma } as any, { checkSeatLimit: jest.fn() } as any, { provisionUserInKeycloak: jest.fn().mockResolvedValue(undefined) } as any, mail as any, { sendToUser } as any, { enqueueApproval } as any);
    return { service, enqueueApproval, sendToUser, tx, target, mail, committed: () => committed };
  }
  it('queues recipients before commit and signals the affected account only after commit', async () => {
    const f = setup();
    expect(await f.service.approveTenantUser(userId, { roleId }, requester)).toMatchObject({ success: true, emailNotification: { status: 'queued' } });
    expect(f.enqueueApproval).toHaveBeenCalledWith(f.tx, expect.objectContaining({ id: userId }), expect.any(Array), requester, null, null);
    expect(f.sendToUser).toHaveBeenCalledWith(userId, 'account_approved', {});
    expect(f.mail.sendRoleApprovalWelcomeEmail).not.toHaveBeenCalled();
  });
  it('rolls back approval when durable email enqueueing fails', async () => {
    const f = setup(1, true);
    await expect(f.service.approveTenantUser(userId, { roleId }, requester)).rejects.toThrow('queue failed');
    expect(f.committed()).toBe(false); expect(f.sendToUser).not.toHaveBeenCalled();
  });
  it('does not enqueue or signal a concurrent duplicate approval', async () => {
    const f = setup(0);
    await expect(f.service.approveTenantUser(userId, { roleId }, requester)).rejects.toThrow('already changed');
    expect(f.enqueueApproval).not.toHaveBeenCalled(); expect(f.sendToUser).not.toHaveBeenCalled();
  });
  it('notification signal failure does not undo a committed approval', async () => {
    const f = setup(); f.sendToUser.mockRejectedValue(new Error('socket failed'));
    await expect(f.service.approveTenantUser(userId, { roleId }, requester)).resolves.toMatchObject({ success: true, emailNotification: { status: 'queued' } });
  });
});
