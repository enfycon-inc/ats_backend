import { Injectable, Optional } from '@nestjs/common';
import { SystemMailService } from '../../email/system-mail.service';
import { AuthQueryService } from './auth-query.service';
import {
  applicationEmailUrl,
  renderSystemEmail,
  workspaceEmailLogin,
} from '../../email/system-email-template';

@Injectable()
export class AuthEmailService {
  constructor(
    private readonly systemMail: SystemMailService,
    @Optional() private readonly authQuery?: AuthQueryService,
  ) {}

  private async getTenantBranding(tenantId: string, fallbackName: string) {
    const result = await this.authQuery?.query(
      `SELECT id, name, site_title, logo_url FROM tenants WHERE id = $1::uuid LIMIT 1`,
      [tenantId],
    ).catch(() => undefined);
    const row = result?.rows?.[0] as any;
    return {
      tenantId,
      tenantName: row?.name || fallbackName,
      siteTitle: row?.site_title || null,
      logoUrl: row?.logo_url || null,
    };
  }

  async sendRoleRequestEmail(options: {
    tenantId: string; to: string; fullName: string; requesterName: string; requesterEmail: string;
    roleName: string; branch?: string; unit?: string; tenantName: string; subdomain: string; reviewPath: string;
  }) {
    const review = new URL(options.reviewPath, workspaceEmailLogin(options.subdomain));
    const localTenant = new URL(workspaceEmailLogin(options.subdomain)).searchParams.get('subdomain');
    if (localTenant) review.searchParams.set('subdomain', localTenant);
    const approve = new URL(review); approve.searchParams.set('action', 'approve');
    const reject = new URL(review); reject.searchParams.set('action', 'reject');
    return this.systemMail.send({
      tenantId: options.tenantId, to: options.to,
      ...renderSystemEmail({
        event: 'role_requested', workspace: options.tenantName, recipient: options.to, fullName: options.fullName,
        tenantBranding: await this.getTenantBranding(options.tenantId, options.tenantName),
        requesterName: options.requesterName, requesterEmail: options.requesterEmail, role: options.roleName,
        branch: options.branch, unit: options.unit, reviewUrl: applicationEmailUrl(review.toString()),
        approveUrl: applicationEmailUrl(approve.toString()), rejectUrl: applicationEmailUrl(reject.toString()),
      }),
    });
  }

  async sendAccountWelcomeEmail(options: {
    tenantId: string;
    to: string;
    fullName: string;
    tenantName: string;
    subdomain: string;
    roleName?: string;
    message?: string;
    invitationToken?: string;
    temporaryPassword?: string;
    adminEmail?: string;
  }) {
    const accountContextPromise = this.authQuery
      ? this.authQuery.query(
          `SELECT bu.name AS unit_name, b.name AS branch_name,
                  COALESCE(
                    (SELECT string_agg(cr.name, ', ')
                     FROM custom_roles cr
                     WHERE cr.id = ANY(ARRAY[u.role_id] || COALESCE(u.assigned_role_ids, ARRAY[]::uuid[]))),
                    (SELECT cr.name FROM custom_roles cr WHERE cr.id = u.role_id),
                    u.requested_role
                  ) AS role_name
           FROM users u
           LEFT JOIN business_units bu ON bu.id = u.business_unit_id
           LEFT JOIN branches b ON b.id = u.branch_id
           WHERE u.tenant_id = $1::uuid AND LOWER(u.email) = LOWER($2)
           LIMIT 1`,
          [options.tenantId, options.to],
        ).catch(() => undefined)
      : Promise.resolve(undefined);
    const [policyResult, accountContextResult, tenantBranding] = await Promise.all([
      this.authQuery?.query(
        `SELECT allow_password_login, allow_microsoft_sso, allow_google_sso
         FROM tenant_auth_settings WHERE tenant_id = $1::uuid LIMIT 1`,
        [options.tenantId],
      ),
      accountContextPromise,
      this.getTenantBranding(options.tenantId, options.tenantName),
    ]);
    // Match the tenant policy service's defaults when a tenant has no settings row.
    const policy = policyResult?.rows[0] as any;
    const accountContext = accountContextResult?.rows[0] as any;
    const loginOptions = {
      allowPasswordLogin: policy?.allow_password_login ?? true,
      allowMicrosoftSso: policy?.allow_microsoft_sso ?? true,
      allowGoogleSso: policy?.allow_google_sso ?? true,
    };
    let passwordSetupUrl: string | undefined;
    if (loginOptions.allowPasswordLogin && options.invitationToken) {
      const setup = new URL(workspaceEmailLogin(options.subdomain));
      const localTenant = setup.searchParams.get('subdomain');
      setup.pathname = '/auth/setup-password';
      setup.search = '';
      if (localTenant) setup.searchParams.set('subdomain', localTenant);
      setup.searchParams.set('token', options.invitationToken);
      passwordSetupUrl = applicationEmailUrl(setup.toString());
    }
    return this.systemMail.send({
      tenantId: options.tenantId,
      to: options.to,
      ...renderSystemEmail({
        event: 'account_welcome',
        workspace: options.tenantName,
        tenantBranding,
        recipient: options.to,
        fullName: options.fullName,
        role: options.roleName || accountContext?.role_name,
        unit: accountContext?.unit_name,
        branch: accountContext?.branch_name,
        message: options.message,
        loginUrl: workspaceEmailLogin(options.subdomain),
        loginOptions,
        passwordSetupUrl,
        temporaryPassword: loginOptions.allowPasswordLogin ? options.temporaryPassword : undefined,
      }),
      ...(options.adminEmail ? { replyTo: options.adminEmail } : {}),
    });
  }

  async sendRoleApprovalWelcomeEmail(options: {
    tenantId: string;
    to: string;
    fullName: string;
    tenantName: string;
    subdomain: string;
    roleName?: string;
  }) {
    return this.sendAccountWelcomeEmail({
      ...options,
      message: 'Your access request was approved. Your account is ready to use.',
    });
  }

  async sendTenantStatusEmail(options: {
    tenantId: string;
    to: string;
    fullName: string;
    tenantName: string;
    subdomain: string;
    pending: boolean;
  }) {
    const tenantBranding = await this.getTenantBranding(options.tenantId, options.tenantName);
    const context = {
      workspace: options.tenantName,
      recipient: options.to,
      fullName: options.fullName,
      tenantBranding,
    };
    const content = options.pending
      ? renderSystemEmail({ ...context, event: 'registration_received' })
      : renderSystemEmail({
          ...context,
          event: 'workspace_activated',
          loginUrl: workspaceEmailLogin(options.subdomain),
        });
    return this.systemMail.send({
      tenantId: options.tenantId,
      to: options.to,
      ...content,
    });
  }

  async sendWelcomeEmail(options: {
    tenantId: string;
    to: string;
    fullName: string;
    tenantName: string;
    subdomain: string;
    invitationToken: string;
    adminEmail?: string;
    roleName?: string;
  }) {
    return this.sendAccountWelcomeEmail({
      ...options,
      message: `You have been invited to join ${options.tenantName}. Your account is ready.`,
    });
  }

  async sendMemberCredentialsEmail(options: {
    tenantId: string;
    to: string;
    fullName: string;
    tenantName: string;
    subdomain: string;
    temporaryPassword?: string;
    roleName?: string;
  }) {
    return this.sendAccountWelcomeEmail({
      ...options,
      message: 'Your account has been created and is ready to use.',
    });
  }

  async sendPasswordResetEmail(options: {
    tenantId: string;
    to: string;
    fullName: string;
    tenantName: string;
    subdomain: string;
    resetToken: string;
  }) {
    const tenantBranding = await this.getTenantBranding(options.tenantId, options.tenantName);
    const resetUrl = new URL(workspaceEmailLogin(options.subdomain));
    const localTenant = resetUrl.searchParams.get('subdomain');
    resetUrl.pathname = '/auth/create-password';
    resetUrl.search = '';
    if (localTenant) resetUrl.searchParams.set('subdomain', localTenant);
    resetUrl.searchParams.set('token', options.resetToken);
    return this.systemMail.send({
      tenantId: options.tenantId,
      to: options.to,
      ...renderSystemEmail({
        event: 'password_reset_request',
        workspace: options.tenantName,
        tenantBranding,
        recipient: options.to,
        fullName: options.fullName,
        resetUrl: applicationEmailUrl(resetUrl.toString()),
      }),
    });
  }

  async sendPasswordChangedAlert(options: {
    tenantId: string;
    to: string;
    fullName: string;
    tenantName: string;
    subdomain: string;
  }) {
    const tenantBranding = await this.getTenantBranding(options.tenantId, options.tenantName);
    return this.systemMail.send({
      tenantId: options.tenantId,
      to: options.to,
      ...renderSystemEmail({
        event: 'password_changed_alert',
        workspace: options.tenantName,
        tenantBranding,
        recipient: options.to,
        fullName: options.fullName,
        loginUrl: workspaceEmailLogin(options.subdomain),
      }),
    });
  }

  async sendAdminPasswordResetNotice(options: {
    tenantId: string;
    to: string;
    fullName: string;
    tenantName: string;
    subdomain: string;
    temporaryPassword: string;
  }) {
    const tenantBranding = await this.getTenantBranding(options.tenantId, options.tenantName);
    return this.systemMail.send({
      tenantId: options.tenantId,
      to: options.to,
      ...renderSystemEmail({
        event: 'admin_temp_password_notice',
        workspace: options.tenantName,
        tenantBranding,
        recipient: options.to,
        fullName: options.fullName,
        temporaryPassword: options.temporaryPassword,
        loginUrl: workspaceEmailLogin(options.subdomain),
      }),
    });
  }

  async sendPodLeadAssignedEmail(options: {
    tenantId: string;
    to: string;
    fullName: string;
    tenantName: string;
    subdomain: string;
    podName: string;
    branchName?: string;
    unitName?: string;
  }) {
    const tenantBranding = await this.getTenantBranding(options.tenantId, options.tenantName);
    return this.systemMail.send({
      tenantId: options.tenantId,
      to: options.to,
      ...renderSystemEmail({
        event: 'pod_lead_assigned',
        workspace: options.tenantName,
        tenantBranding,
        recipient: options.to,
        fullName: options.fullName,
        podName: options.podName,
        branch: options.branchName,
        unit: options.unitName,
        loginUrl: workspaceEmailLogin(options.subdomain),
      }),
    });
  }

  async sendRoleChangedAlert(options: {
    tenantId: string;
    to: string;
    fullName: string;
    tenantName: string;
    subdomain: string;
    newRoles: string;
    previousRoles?: string;
    branchName?: string;
    unitName?: string;
  }) {
    const tenantBranding = await this.getTenantBranding(options.tenantId, options.tenantName);
    return this.systemMail.send({
      tenantId: options.tenantId,
      to: options.to,
      ...renderSystemEmail({
        event: 'role_changed_alert',
        workspace: options.tenantName,
        tenantBranding,
        recipient: options.to,
        fullName: options.fullName,
        newRoles: options.newRoles,
        previousRoles: options.previousRoles,
        branch: options.branchName,
        unit: options.unitName,
        loginUrl: workspaceEmailLogin(options.subdomain),
      }),
    });
  }
}
