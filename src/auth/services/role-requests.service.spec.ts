import { RoleRequestsService } from './role-requests.service';
import { AuthUserService } from './auth-user.service';

describe('durable role request notifications', () => {
  const id = '11111111-1111-4111-8111-111111111111';
  const roleId = '22222222-2222-4222-8222-222222222222';
  const recipientId = '33333333-3333-4333-8333-333333333333';
  const version = '44444444-4444-4444-8444-444444444444';
  const branch = '55555555-5555-4555-8555-555555555555';
  const tenant = '66666666-6666-4666-8666-666666666666';
  const unit = '77777777-7777-4777-8777-777777777777';
  const user = {
    id,
    tenant_id: tenant,
    branch_id: branch,
    business_unit_id: unit,
    email: 'requester@example.com',
    full_name: 'Requester',
    is_approved: false,
    requested_role: roleId,
    role_request_version: version,
    city: null,
  };
  const role = {
    id: roleId,
    name: 'Recruiter',
    permissions: ['candidate:view'],
    branch_id: branch,
    business_unit_id: unit,
    system_key: null,
  };
  const reviewer = {
    id: recipientId,
    email: 'reviewer@example.com',
    full_name: 'Reviewer',
    branch_id: branch,
    business_unit_id: unit,
    role_id: roleId,
    permissions: ['user:manage', 'candidate:view'],
  };
  const job = {
    id: '88888888-8888-4888-8888-888888888888',
    tenant_id: tenant,
    requester_id: id,
    recipient_id: recipientId,
    request_version: version,
    channel: 'email',
    attempts: 1,
    lease_id: 'lease',
  };

  function setup(
    options: { user?: any; reviewers?: any[]; jobs?: any[] } = {},
  ) {
    const query = jest.fn(async (sql: string) => {
      if (sql.startsWith('WITH ready')) return options.jobs || [];
      if (sql.includes('FROM ats.users u JOIN ats.custom_roles'))
        return options.reviewers || [reviewer];
      if (sql.includes('FROM ats.custom_roles cr LEFT')) return [role];
      if (
        sql.includes('FROM ats.branches') ||
        sql.includes('FROM ats.business_units')
      )
        return [{ id: branch }];
      if (sql.includes('FROM ats.users')) return [options.user || user];
      return [];
    });
    const execute = jest.fn().mockResolvedValue(1);
    const prisma = {
      $queryRawUnsafe: query,
      $executeRawUnsafe: execute,
      $transaction: jest.fn(async (cb) => cb(prisma)),
    };
    const mail = {
      sendRoleRequestEmail: jest
        .fn()
        .mockResolvedValue({ success: true, status: 'accepted' }),
    };
    const notifications = {
      create: jest.fn().mockResolvedValue({ id: 'notification' }),
    };
    const service = new RoleRequestsService(
      prisma as any,
      mail as any,
      notifications as any,
    );
    return { service, prisma, query, execute, mail, notifications };
  }

  it('routes the existing request endpoint into the email-capable service', async () => {
    const submit = jest.fn().mockResolvedValue({ success: true });
    const auth = new AuthUserService(
      {} as any,
      {} as any,
      {} as any,
      undefined,
      undefined,
      { submit } as any,
    );
    await auth.requestRole(id, roleId, branch, unit, null);
    expect(submit).toHaveBeenCalledWith(id, roleId, branch, unit, null);
  });
  it('saves the request and both delivery channels in one transaction without sending mail inline', async () => {
    const { service, prisma, execute, mail } = setup();
    await expect(
      service.submit(id, roleId, branch, unit),
    ).resolves.toMatchObject({
      requestVersion: version,
      notification: { status: 'queued', recipientCount: 1 },
    });
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(execute.mock.calls[0][0]).toContain('UPDATE ats.users');
    expect(execute.mock.calls[1][0]).toContain("ARRAY['email', 'in_app']");
    expect(execute.mock.calls[1][0]).toContain('ON CONFLICT');
    expect(mail.sendRoleRequestEmail).not.toHaveBeenCalled();
  });
  it('deduplicates recipients and excludes reviewers who cannot grant access', async () => {
    const { service, execute } = setup({
      reviewers: [
        reviewer,
        { ...reviewer, role_id: 'second' },
        { ...reviewer, id: 'denied', permissions: ['user:manage'] },
      ],
    });
    await service.submit(id, roleId, branch, unit);
    expect(execute.mock.calls[1][4]).toEqual([recipientId]);
  });
  it('preserves the request and reports an explicit no-reviewers condition', async () => {
    const { service, execute } = setup({ reviewers: [] });
    await expect(
      service.submit(id, roleId, branch, unit),
    ).resolves.toMatchObject({
      notification: { status: 'no_reviewers', recipientCount: 0 },
    });
    expect(execute).toHaveBeenCalledTimes(1);
  });
  it('generates a new version when replacing a request and retains it for identical resubmissions', async () => {
    const { service } = setup({
      user: { ...user, requested_role: 'other-role' },
    });
    const result = await service.submit(id, roleId, branch, unit);
    expect(result.requestVersion).not.toBe(version);
  });
  it('rejects invalid office ownership before saving or enqueuing', async () => {
    const { service, query, execute } = setup();
    query.mockImplementation(async (sql) =>
      sql.includes('FROM ats.branches') ? [] : [user],
    );
    await expect(service.submit(id, roleId, branch, unit)).rejects.toThrow(
      'branch in your workspace',
    );
    expect(execute).not.toHaveBeenCalled();
  });
  it('does not dispatch any email when the transaction cannot save its outbox', async () => {
    const { service, execute, mail } = setup();
    execute
      .mockResolvedValueOnce(1)
      .mockRejectedValueOnce(new Error('database unavailable'));
    await expect(service.submit(id, roleId, branch, unit)).rejects.toThrow(
      'database unavailable',
    );
    expect(mail.sendRoleRequestEmail).not.toHaveBeenCalled();
  });
  it('delivers email with the exact request version and eligible assigned role', async () => {
    const { service, mail, execute, query } = setup({ jobs: [job] });
    await service.dispatchPending();
    expect(query.mock.calls[0][0]).toContain('FOR UPDATE SKIP LOCKED');
    expect(mail.sendRoleRequestEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: reviewer.email,
        reviewPath: expect.stringContaining(`requestVersion=${version}`),
      }),
    );
    expect(mail.sendRoleRequestEmail.mock.calls[0][0].reviewPath).toContain(
      `reviewRoleId=${roleId}`,
    );
    expect(execute.mock.calls.at(-1)?.[1]).toBe('accepted');
  });
  it('retries provider failures and stops after the configured attempt limit', async () => {
    const { service, mail, execute } = setup({ jobs: [job] });
    mail.sendRoleRequestEmail.mockRejectedValue(new Error('provider timeout'));
    await service.dispatchPending();
    expect(execute.mock.calls.at(-1)?.slice(1, 3)).toEqual(['pending', 2]);
    const failed = setup({ jobs: [{ ...job, attempts: 5 }] });
    failed.mail.sendRoleRequestEmail.mockRejectedValue(
      new Error('provider timeout'),
    );
    await failed.service.dispatchPending();
    expect(failed.execute.mock.calls.at(-1)?.[1]).toBe('failed');
  });
  it.each([
    { ...user, role_request_version: 'replacement' },
    { ...user, is_approved: true },
  ])('cancels outdated delivery work', async (pending) => {
    const { service, mail, execute } = setup({ user: pending, jobs: [job] });
    await service.dispatchPending();
    expect(mail.sendRoleRequestEmail).not.toHaveBeenCalled();
    expect(execute.mock.calls.at(-1)?.[1]).toBe('cancelled');
  });
  it('rechecks reviewer eligibility before delivery', async () => {
    const { service, mail, execute } = setup({ jobs: [job], reviewers: [] });
    await service.dispatchPending();
    expect(mail.sendRoleRequestEmail).not.toHaveBeenCalled();
    expect(execute.mock.calls.at(-1)?.[1]).toBe('cancelled');
  });
  it('uses the durable delivery ID for idempotent in-app notifications', async () => {
    const { service, notifications } = setup({
      jobs: [{ ...job, channel: 'in_app' }],
    });
    await service.dispatchPending();
    expect(notifications.create).toHaveBeenCalledWith(
      tenant,
      recipientId,
      expect.objectContaining({
        type: 'ROLE_REQUEST',
        data: expect.objectContaining({ requestVersion: version }),
      }),
      job.id,
      true,
    );
  });
  it('rejects an old email link before exposing the request details', async () => {
    const { service } = setup();
    const actor: any = {
      dbId: recipientId,
      tenantId: tenant,
      branchId: branch,
      businessUnitId: unit,
      permissions: reviewer.permissions,
    };
    await expect(service.review(id, 'old-version', actor)).rejects.toThrow(
      'handled or replaced',
    );
    await expect(
      service.review(id, version, { ...actor, tenantId: 'other' }),
    ).rejects.toThrow('unavailable');
  });
});
