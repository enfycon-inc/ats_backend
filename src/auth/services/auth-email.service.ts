import { Injectable, Logger } from '@nestjs/common';
import { SystemMailService } from '../../email/system-mail.service';

/**
 * AuthEmailService — handles all transactional email sending for Auth flows.
 * Supports welcome/invitation emails and member credential emails.
 * Uses the tenant-selected strategy through the shared system mail dispatcher.
 */
@Injectable()
export class AuthEmailService {
  private readonly logger = new Logger(AuthEmailService.name);

  constructor(private readonly systemMail: SystemMailService) {}

  private escape(value: string): string {
    return value.replace(
      /[&<>"']/g,
      (ch) =>
        ({
          '&': '&amp;',
          '<': '&lt;',
          '>': '&gt;',
          '"': '&quot;',
          "'": '&#39;',
        })[ch]!,
    );
  }

  async sendTenantStatusEmail(options: {
    tenantId: string;
    to: string;
    fullName: string;
    tenantName: string;
    subdomain: string;
    pending: boolean;
  }) {
    const appUrl = process.env.FRONTEND_URL;
    if (!appUrl)
      throw new Error('Frontend URL must be configured for onboarding email.');
    const baseDomain = process.env.BASE_DOMAIN;
    const login = new URL('/auth/login', appUrl);
    if (login.hostname === 'localhost' || login.hostname === '127.0.0.1')
      login.searchParams.set('subdomain', options.subdomain);
    else {
      if (!baseDomain || !/^[a-z0-9-]+$/.test(options.subdomain))
        throw new Error('Workspace URL configuration is incomplete.');
      login.hostname = `${options.subdomain}.${baseDomain}`;
    }
    const status = options.pending
      ? 'Your workspace registration is pending administrator approval.'
      : 'Your workspace is active. You can sign in with your existing credentials.';
    return this.systemMail.send({
      tenantId: options.tenantId,
      to: options.to,
      subject: options.pending
        ? 'EnfySync — Workspace registration received'
        : 'EnfySync — Your workspace is ready',
      html: `<div style="font-family:Arial,sans-serif"><h2>${this.escape(options.tenantName)}</h2><p>Hi ${this.escape(options.fullName)},</p><p>${status}</p>${options.pending ? '' : `<p><a href="${this.escape(login.toString())}">Sign in to your workspace</a></p>`}</div>`,
    });
  }

  async sendWelcomeEmail(options: {
    to: string;
    fullName: string;
    tenantName: string;
    subdomain: string;
    invitationToken: string;
    tenantId: string;
    adminEmail?: string;
    roleName?: string;
  }) {
    try {
      const appBaseUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
      const baseDomain =
        process.env.BASE_DOMAIN ||
        (appBaseUrl.includes('localhost') ? 'localhost:3000' : 'enfyjobs.com');
      const workspaceUrl =
        options.subdomain &&
        options.subdomain !== 'www' &&
        options.subdomain !== baseDomain
          ? appBaseUrl.includes('localhost')
            ? `${appBaseUrl}?subdomain=${options.subdomain}`
            : `https://${options.subdomain}.${baseDomain}`
          : appBaseUrl;

      const setupPasswordUrl = `${appBaseUrl}/auth/setup-password?token=${encodeURIComponent(options.invitationToken)}`;

      const html = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 8px;">
          <h2 style="color: #4f46e5; margin-bottom: 8px;">Welcome to ${this.escape(options.tenantName)}</h2>
          <p style="font-size: 15px; color: #333;">Hi <strong>${this.escape(options.fullName || 'there')}</strong>,</p>
          <p style="font-size: 14px; color: #555; line-height: 1.5;">
            You have been invited to join the <strong>${this.escape(options.tenantName)}</strong> workspace on Enfycon ATS as a <strong>${this.escape(options.roleName || 'Team Member')}</strong>.
          </p>
          <div style="background-color: #f8fafc; padding: 15px; border-radius: 6px; margin: 20px 0;">
            <p style="margin: 4px 0; font-size: 14px;"><strong>Workspace URL:</strong> <a href="${workspaceUrl}" style="color: #4f46e5;">${workspaceUrl}</a></p>
            <p style="margin: 4px 0; font-size: 14px;"><strong>Your Login Email:</strong> ${this.escape(options.to)}</p>
          </div>
          <h3 style="font-size: 15px; color: #333; margin-top: 20px;">Choose How to Log In:</h3>
          <div style="margin: 15px 0;">
            <a href="${workspaceUrl}" style="display: inline-block; background-color: #4f46e5; color: #ffffff; padding: 10px 20px; text-decoration: none; border-radius: 5px; font-weight: bold; margin-right: 10px;">Sign in with Google / Microsoft</a>
          </div>
          <p style="font-size: 13px; color: #666;">Or, if you prefer to use a password, click below to set your password (valid for 24 hours):</p>
          <p><a href="${setupPasswordUrl}" style="color: #4f46e5; font-size: 14px; text-decoration: underline;">Set My Password</a></p>
          <hr style="border: none; border-top: 1px solid #eee; margin: 25px 0;" />
          <p style="font-size: 12px; color: #999;">If you were not expecting this invitation, please contact your administrator.</p>
        </div>
      `;

      return await this.systemMail.send({
        tenantId: options.tenantId,
        to: options.to,
        subject: `You've been invited to join ${options.tenantName} on EnfySync ATS`,
        html,
        ...(options.adminEmail ? { replyTo: options.adminEmail } : {}),
      });
    } catch (err: any) {
      this.logger.warn(
        'Welcome email was not accepted by the configured sender.',
      );
      throw err;
    }
  }

  async sendMemberCredentialsEmail(options: {
    to: string;
    fullName: string;
    tenantName: string;
    subdomain: string;
    tenantId: string;
    temporaryPassword?: string;
    roleName?: string;
  }) {
    try {
      const appBaseUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
      const baseDomain =
        process.env.BASE_DOMAIN ||
        (appBaseUrl.includes('localhost') ? 'localhost:3000' : 'enfyjobs.com');
      const isSubdomainTenant =
        options.subdomain &&
        options.subdomain !== 'www' &&
        options.subdomain !== 'enfy' &&
        options.subdomain !== baseDomain;
      const workspaceLoginUrl = isSubdomainTenant
        ? appBaseUrl.includes('localhost')
          ? `${appBaseUrl}?subdomain=${options.subdomain}`
          : `https://${options.subdomain}.${baseDomain}/auth/login`
        : appBaseUrl.includes('localhost')
          ? `${appBaseUrl}/auth/login`
          : `https://${baseDomain}/auth/login`;

      const subject = `Welcome to ${options.tenantName} — Your Account Credentials & Login Guide`;

      const html = `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; border: 1px solid #e2e8f0; border-radius: 12px; background-color: #ffffff;">
          <div style="text-align: center; margin-bottom: 24px;">
            <h2 style="color: #4f46e5; margin: 0 0 6px 0; font-size: 24px;">Welcome to ${this.escape(options.tenantName)}</h2>
            <p style="color: #64748b; font-size: 14px; margin: 0;">Your EnfySync ATS Workspace Account is Ready</p>
          </div>
          <p style="font-size: 15px; color: #1e293b;">Hi <strong>${this.escape(options.fullName || 'there')}</strong>,</p>
          <p style="font-size: 14px; color: #475569; line-height: 1.6;">
            Your account has been created for the <strong>${this.escape(options.tenantName)}</strong> ATS workspace as a <strong>${this.escape(options.roleName || 'Team Member')}</strong>.
          </p>
          <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 18px; margin: 20px 0;">
            <h4 style="margin: 0 0 12px 0; color: #334155; font-size: 14px; text-transform: uppercase; letter-spacing: 0.5px;">🔐 Your Login Credentials</h4>
            <p style="margin: 6px 0; font-size: 14px; color: #334155;"><strong>Workspace URL:</strong> <a href="${workspaceLoginUrl}" style="color: #4f46e5; font-weight: 600;">${workspaceLoginUrl}</a></p>
            <p style="margin: 6px 0; font-size: 14px; color: #334155;"><strong>Username / Email:</strong> <span style="font-family: monospace; background: #e2e8f0; padding: 2px 6px; border-radius: 4px;">${this.escape(options.to)}</span></p>
            ${options.temporaryPassword ? `<p style="margin: 6px 0; font-size: 14px; color: #334155;"><strong>Password:</strong> <span style="font-family: monospace; background: #e2e8f0; padding: 2px 6px; border-radius: 4px; font-weight: bold; color: #0f172a;">${this.escape(options.temporaryPassword)}</span></p>` : ''}
          </div>
          <div style="text-align: center; margin: 28px 0;">
            <a href="${workspaceLoginUrl}" style="display: inline-block; background-color: #4f46e5; color: #ffffff; padding: 12px 28px; text-decoration: none; border-radius: 8px; font-weight: bold; font-size: 15px;">
              Sign In to Your Workspace &rarr;
            </a>
          </div>
          <hr style="border: none; border-top: 1px solid #f1f5f9; margin: 24px 0 16px 0;" />
          <p style="font-size: 11px; color: #94a3b8; text-align: center; margin: 0;">
            EnfySync AI Recruitment Platform &bull; ${this.escape(options.tenantName)}
          </p>
        </div>
      `;

      return await this.systemMail.send({
        tenantId: options.tenantId,
        to: options.to,
        subject,
        html,
      });
    } catch (err: any) {
      this.logger.warn(
        'Account email was not accepted by the configured sender.',
      );
      throw err;
    }
  }
}
