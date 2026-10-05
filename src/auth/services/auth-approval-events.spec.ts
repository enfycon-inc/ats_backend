import { AuthUserService } from './auth-user.service';

describe('approval event delivery', () => {
  const userId = 'f8bdcd3f-c327-46ea-a277-678e812d5c74';
  const roleId = 'd7746edf-4e8a-4a9a-866b-7d5b90896003';
  const requester: any = { tenantId: 'tenant', roles: [], permissions: ['tenant:manage'], email: 'admin@example.com' };
  function setup(failWrite = false) {
    let committed = false;
    const sendToUser = jest.fn(async () => { expect(committed).toBe(true); });
    const query = jest.fn(async (sql: string) => {
      if (sql.includes('SELECT id, email, full_name')) return { rows: [{ tenant_id: 'tenant', email: 'user@example.com', full_name: 'User', is_active: true, is_approved: false, requested_role: 'Delivery Head' }] };
      if (sql.includes('UPDATE users')) { if (failWrite) throw new Error('write failed'); committed = true; }
      return { rows: [] };
    });
    const service = new AuthUserService({ query } as any, { checkSeatLimit: jest.fn() } as any, { provisionUserInKeycloak: jest.fn().mockResolvedValue(undefined) } as any, { sendToUser } as any);
    return { service, sendToUser };
  }
  it('signals only the affected user after approval succeeds, without sending role or permission data', async () => {
    const { service, sendToUser } = setup();
    await service.approveTenantUser(userId, { roleId }, requester);
    expect(sendToUser).toHaveBeenCalledWith(userId, 'account_approved', {});
    expect(sendToUser).toHaveBeenCalledTimes(1);
  });
  it('does not signal an approval when the database write fails', async () => {
    const { service, sendToUser } = setup(true);
    await expect(service.approveTenantUser(userId, { roleId }, requester)).rejects.toThrow('write failed');
    expect(sendToUser).not.toHaveBeenCalled();
  });
  it('does not undo successful approval when notification delivery fails', async () => {
    const { service, sendToUser } = setup();
    sendToUser.mockRejectedValue(new Error('socket unavailable'));
    await expect(service.approveTenantUser(userId, { roleId }, requester)).resolves.toMatchObject({ success: true });
  });
});
