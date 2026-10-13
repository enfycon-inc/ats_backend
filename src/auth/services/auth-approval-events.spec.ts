import { AuthUserService } from './auth-user.service';

describe('approval event delivery', () => {
  const userId = 'f8bdcd3f-c327-46ea-a277-678e812d5c74';
  const roleId = 'd7746edf-4e8a-4a9a-866b-7d5b90896003';
  const requester: any = { tenantId: 'tenant', roles: [], permissions: ['tenant:manage'], email: 'admin@example.com' };
  function setup(failWrite = false) {
    let committed = false;
    const sendToUser = jest.fn(async () => { expect(committed).toBe(true); });
    const sendRoleApprovalWelcomeEmail = jest.fn(async () => { expect(committed).toBe(true); return { success: true, status: 'accepted' }; });
    const query = jest.fn(async (sql: string) => {
      if (sql.includes('SELECT u.id, u.email, u.full_name')) return { rows: [{ tenant_id: 'tenant', email: 'user@example.com', full_name: 'User', is_active: true, is_approved: false, requested_role: 'Delivery Head', tenant_name: 'Workspace', tenant_domain: 'workspace' }] };
      if (sql.includes('UPDATE users')) { if (failWrite) throw new Error('write failed'); committed = true; return { rows: [{ id: userId }] }; }
      return { rows: [] };
    });
    const service = new AuthUserService(
      { query } as any,
      { checkSeatLimit: jest.fn() } as any,
      { provisionUserInKeycloak: jest.fn().mockResolvedValue(undefined) } as any,
      { sendRoleApprovalWelcomeEmail } as any,
      { sendToUser } as any,
    );
    return { service, sendToUser, sendRoleApprovalWelcomeEmail };
  }
  it('signals only the affected user after approval succeeds, without sending role or permission data', async () => {
    const { service, sendToUser, sendRoleApprovalWelcomeEmail } = setup();
    const result = await service.approveTenantUser(userId, { roleId }, requester);
    expect(sendToUser).toHaveBeenCalledWith(userId, 'account_approved', {});
    expect(sendToUser).toHaveBeenCalledTimes(1);
    expect(sendRoleApprovalWelcomeEmail).toHaveBeenCalledWith({
      tenantId: 'tenant',
      to: 'user@example.com',
      fullName: 'User',
      tenantName: 'Workspace',
      subdomain: 'workspace',
    });
    expect(result.emailNotification).toEqual({ status: 'accepted' });
  });
  it('does not signal an approval when the database write fails', async () => {
    const { service, sendToUser, sendRoleApprovalWelcomeEmail } = setup(true);
    await expect(service.approveTenantUser(userId, { roleId }, requester)).rejects.toThrow('write failed');
    expect(sendToUser).not.toHaveBeenCalled();
    expect(sendRoleApprovalWelcomeEmail).not.toHaveBeenCalled();
  });
  it('does not undo successful approval when notification delivery fails', async () => {
    const { service, sendToUser, sendRoleApprovalWelcomeEmail } = setup();
    sendToUser.mockRejectedValue(new Error('socket unavailable'));
    await expect(service.approveTenantUser(userId, { roleId }, requester)).resolves.toMatchObject({ success: true });
    expect(sendRoleApprovalWelcomeEmail).toHaveBeenCalledTimes(1);
  });
  it('does not send another welcome email if the approval request changed before the write', async () => {
    const { service, sendToUser, sendRoleApprovalWelcomeEmail } = setup();
    const query = (service as any).authQuery.query as jest.Mock;
    query.mockImplementation(async (sql: string) => {
      if (sql.includes('SELECT u.id, u.email, u.full_name')) return { rows: [{ tenant_id: 'tenant', email: 'user@example.com', full_name: 'User', is_active: true, is_approved: false, requested_role: 'Delivery Head', tenant_name: 'Workspace', tenant_domain: 'workspace' }] };
      if (sql.includes('UPDATE users')) return { rows: [] };
      return { rows: [] };
    });
    await expect(service.approveTenantUser(userId, { roleId }, requester)).rejects.toThrow('already changed');
    expect(sendRoleApprovalWelcomeEmail).not.toHaveBeenCalled();
    expect(sendToUser).not.toHaveBeenCalled();
  });
  it('keeps approval successful and returns a delivery warning if the email provider fails', async () => {
    const { service, sendRoleApprovalWelcomeEmail } = setup();
    sendRoleApprovalWelcomeEmail.mockRejectedValue(new Error('provider unavailable'));
    await expect(service.approveTenantUser(userId, { roleId }, requester)).resolves.toMatchObject({
      success: true,
      emailNotification: { status: 'failed' },
    });
  });
});
