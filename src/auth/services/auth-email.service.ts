import { Injectable } from '@nestjs/common';
import { SystemMailService } from '../../email/system-mail.service';
import {
  applicationEmailUrl,
  renderSystemEmail,
  workspaceEmailLogin,
} from '../../email/system-email-template';

@Injectable()
export class AuthEmailService {
  constructor(private readonly systemMail: SystemMailService) {}

  async sendTenantStatusEmail(options: {
    tenantId: string;
    to: string;
    fullName: string;
    tenantName: string;
    subdomain: string;
    pending: boolean;
  }) {
    const context = {
      workspace: options.tenantName,
      recipient: options.to,
      fullName: options.fullName,
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
    const setup = new URL(
      '/auth/setup-password',
      process.env.FRONTEND_URL || '',
    );
    setup.searchParams.set('token', options.invitationToken);
    return this.systemMail.send({
      tenantId: options.tenantId,
      to: options.to,
      ...renderSystemEmail({
        event: 'team_invitation',
        workspace: options.tenantName,
        recipient: options.to,
        fullName: options.fullName,
        role: options.roleName,
        setupUrl: applicationEmailUrl(setup.toString()),
      }),
      ...(options.adminEmail ? { replyTo: options.adminEmail } : {}),
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
    return this.systemMail.send({
      tenantId: options.tenantId,
      to: options.to,
      ...renderSystemEmail({
        event: 'account_created',
        workspace: options.tenantName,
        recipient: options.to,
        fullName: options.fullName,
        role: options.roleName,
        temporaryPassword: options.temporaryPassword,
        loginUrl: workspaceEmailLogin(options.subdomain),
      }),
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
    const resetUrl = new URL(
      '/auth/create-password',
      process.env.FRONTEND_URL || '',
    );
    resetUrl.searchParams.set('token', options.resetToken);
    return this.systemMail.send({
      tenantId: options.tenantId,
      to: options.to,
      ...renderSystemEmail({
        event: 'password_reset_request',
        workspace: options.tenantName,
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
    return this.systemMail.send({
      tenantId: options.tenantId,
      to: options.to,
      ...renderSystemEmail({
        event: 'password_changed_alert',
        workspace: options.tenantName,
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
    return this.systemMail.send({
      tenantId: options.tenantId,
      to: options.to,
      ...renderSystemEmail({
        event: 'admin_temp_password_notice',
        workspace: options.tenantName,
        recipient: options.to,
        fullName: options.fullName,
        temporaryPassword: options.temporaryPassword,
        loginUrl: workspaceEmailLogin(options.subdomain),
      }),
    });
  }
}
