import { RoleRequestsService } from './role-requests.service';
import { renderSystemEmail } from '../../email/system-email-template';

describe('approval email recipients and retries', () => {
  const target: any = { id: 'requester', tenant_id: 'tenant', branch_id: 'branch', business_unit_id: 'unit', requested_role: 'role', role_request_version: 'version', full_name: 'Applicant', email: 'applicant@example.com', is_approved: false };
  const role = { id: 'role', name: 'Recruiter', permissions: ['candidate:view'], branch_id: null, business_unit_id: null };
  const reviewer = { id: 'reviewer', branch_id: 'branch', business_unit_id: 'unit', permissions: ['user:manage', 'candidate:view'], email: 'reviewer@example.com', full_name: 'Reviewer' };
  const approver: any = { dbId: 'reviewer', fullName: 'Priya Shah', email: 'priya@example.com', tenantId: 'tenant' };
  function fixture() {
    const db: any = { $queryRawUnsafe: jest.fn(async sql => {
      if (sql.includes('FROM ats.custom_roles cr LEFT')) return [role];
      if (sql.includes('FROM ats.users u JOIN ats.custom_roles')) return [reviewer, reviewer];
      if (sql.includes('FROM ats.tenants t')) return [{ tenant_name: 'Example', domain: 'example', role_names: 'Recruiter', branch_name: 'Kolkata', unit_name: 'India Staffing' }];
      return [];
    }), $executeRawUnsafe: jest.fn(), user: { findFirst: jest.fn().mockResolvedValue({ email: reviewer.email, fullName: reviewer.full_name }) } };
    const mail: any = { sendRoleApprovalReviewerEmail: jest.fn().mockResolvedValue({ status: 'accepted' }), sendRoleApprovalWelcomeEmail: jest.fn().mockResolvedValue({ status: 'accepted' }) };
    return { db, mail, service: new RoleRequestsService(db, mail, {} as any) };
  }
  it('deduplicates reviewers across assigned roles and persists approver identity with the event', async () => {
    const f = fixture();
    await f.service.enqueueApproval(f.db, target, ['role'], approver, 'branch', 'unit');
    expect(f.db.$executeRawUnsafe).toHaveBeenCalledTimes(2); // requester + one reviewer
    const calls = f.db.$executeRawUnsafe.mock.calls;
    expect(calls.map(call => call[2])).toEqual(['requester', 'reviewer']);
    expect(JSON.parse(calls[1][5])).toMatchObject({ approverName: 'Priya Shah', approverEmail: 'priya@example.com', roleName: 'Recruiter' });
    expect(calls[1][0]).toContain('ON CONFLICT (event_id, recipient_id, category) DO NOTHING');
  });
  it.each(['accepted', 'disabled'])('records %s without retrying a suppressed email', async status => {
    const f = fixture();
    f.mail.sendRoleApprovalReviewerEmail.mockResolvedValue({ status });
    const payload = { target, requestedRoleId: 'role', tenantName: 'Example', approverName: 'Priya', approverEmail: 'priya@example.com' };
    const read = f.db.$queryRawUnsafe.getMockImplementation();
    f.db.$queryRawUnsafe.mockImplementation(async sql => sql.startsWith('WITH ready') ? [{ id: 'delivery', tenant_id: 'tenant', recipient_id: 'reviewer', category: 'roleApprovals', attempts: 1, payload }] : read(sql));
    await (f.service as any).dispatchApprovalEmails();
    expect(f.db.$executeRawUnsafe).toHaveBeenLastCalledWith(expect.any(String), status, 'delivery', expect.any(String));
  });
  it('cancels delivery when reviewer authorization is revoked', async () => {
    const f = fixture();
    f.db.$queryRawUnsafe.mockImplementation(async sql => {
      if (sql.startsWith('WITH ready')) return [{ id: 'delivery', tenant_id: 'tenant', recipient_id: 'reviewer', category: 'roleApprovals', attempts: 1, payload: { target, requestedRoleId: 'role' } }];
      if (sql.includes('FROM ats.custom_roles cr LEFT')) return [role];
      return [];
    });
    await (f.service as any).dispatchApprovalEmails();
    expect(f.mail.sendRoleApprovalReviewerEmail).not.toHaveBeenCalled();
    expect(f.db.$executeRawUnsafe).toHaveBeenLastCalledWith(expect.any(String), 'cancelled', 'delivery', expect.any(String));
  });
  it('retries provider failures without changing the approved account', async () => {
    const f = fixture(); f.mail.sendRoleApprovalReviewerEmail.mockRejectedValue(new Error('provider unavailable'));
    const read = f.db.$queryRawUnsafe.getMockImplementation();
    f.db.$queryRawUnsafe.mockImplementation(async sql => sql.startsWith('WITH ready') ? [{ id: 'delivery', tenant_id: 'tenant', recipient_id: 'reviewer', category: 'roleApprovals', attempts: 1, payload: { target, requestedRoleId: 'role' } }] : read(sql));
    await (f.service as any).dispatchApprovalEmails();
    expect(f.db.$executeRawUnsafe).toHaveBeenLastCalledWith(expect.stringContaining('available_at'), 'pending', 2, 'delivery', expect.any(String));
  });
  it('escapes approver content and includes name, email, approved role and time', () => {
    const result = renderSystemEmail({ event: 'role_approval_update', workspace: 'Example', recipient: 'reviewer@example.com', requesterName: 'Applicant', requesterEmail: 'applicant@example.com', role: 'Recruiter', approverName: '<script>Priya</script>', approverEmail: 'priya@example.com', approvedAt: '2026-10-25T07:00:00.000Z', branch: 'Kolkata', unit: 'India Staffing' });
    expect(result.html).toContain('&lt;script&gt;Priya&lt;/script&gt;');
    expect(result.html).not.toContain('<script>');
    expect(result.text).toContain('priya@example.com');
    expect(result.text).toContain('2026-10-25T07:00:00.000Z');
  });
});
