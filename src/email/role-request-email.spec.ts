import { AuthEmailService } from '../auth/services/auth-email.service';
import { renderSystemEmail } from './system-email-template';

describe('role-request email actions', () => {
  const env = { ...process.env };
  beforeEach(() => {
    process.env.FRONTEND_URL = 'https://enfyjobs.com';
    process.env.BASE_DOMAIN = 'enfyjobs.com';
  });
  afterEach(() => {
    process.env = { ...env };
  });
  const input = {
    event: 'role_requested' as const,
    workspace: 'Workspace',
    recipient: 'reviewer@example.com',
    fullName: 'Reviewer',
    requesterName: '<script>Requester</script>',
    requesterEmail: 'requester@example.com',
    role: 'Recruiter',
    branch: 'Bengaluru',
    unit: 'IT Staffing',
    reviewUrl:
      'https://workspace.enfyjobs.com/auth/role-request?requestId=user&requestVersion=version',
    approveUrl:
      'https://workspace.enfyjobs.com/auth/role-request?requestId=user&requestVersion=version&action=approve',
    rejectUrl:
      'https://workspace.enfyjobs.com/auth/role-request?requestId=user&requestVersion=version&action=reject',
  };
  it('renders both buttons, request details, plain text links and confirmation instructions', () => {
    const result = renderSystemEmail(input);
    expect(result.html).toContain('Approve request');
    expect(result.html).toContain('Reject request');
    expect(result.html).toContain('Bengaluru');
    expect(result.html).toContain('IT Staffing');
    expect(result.html).toContain('Pending approval');
    expect(result.html).toContain('confirm your decision');
    expect(result.text).toContain(input.approveUrl);
    expect(result.text).toContain(input.rejectUrl);
    expect(result.subject).toContain('Role request:');
    expect(result.html).not.toContain('<script>Requester</script>');
    expect(result.html).toContain('&lt;script&gt;Requester&lt;/script&gt;');
    expect(result.html).not.toMatch(/<form|<script|onclick=/);
  });
  it('refuses external action URLs instead of creating unsafe buttons', () => {
    expect(() =>
      renderSystemEmail({
        ...input,
        approveUrl: 'https://attacker.example/approve',
      }),
    ).toThrow('Invalid application email link');
  });
  it('uses the tenant dispatcher and workspace URL for both actions', async () => {
    const send = jest
      .fn()
      .mockResolvedValue({ success: true, status: 'accepted' });
    const mail = new AuthEmailService(
      { send } as any,
      {
        query: jest
          .fn()
          .mockResolvedValue({ rows: [{ name: 'Tenant Brand' }] }),
      } as any,
    );
    await mail.sendRoleRequestEmail({
      tenantId: 'tenant',
      to: input.recipient,
      fullName: 'Reviewer',
      requesterName: 'Requester',
      requesterEmail: input.requesterEmail,
      roleName: 'Recruiter',
      tenantName: 'Workspace',
      subdomain: 'workspace',
      reviewPath:
        '/auth/role-request?requestId=user&requestVersion=version&reviewRoleId=assigned-role',
    });
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 'tenant',
        to: input.recipient,
        systemGenerated: true,
      }),
    );
    const message = send.mock.calls[0][0];
    expect(message.text).toContain(
      'https://workspace.enfyjobs.com/auth/role-request?',
    );
    expect(message.text).toContain('reviewRoleId=assigned-role&action=approve');
    expect(message.text).toContain('reviewRoleId=assigned-role&action=reject');
    expect(message.html).toContain('Tenant Brand');
  });
});
