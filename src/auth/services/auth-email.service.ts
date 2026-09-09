import { Injectable, Logger } from '@nestjs/common';
import * as nodemailer from 'nodemailer';
import axios from 'axios';
import { AuthQueryService } from './auth-query.service';

/**
 * AuthEmailService — handles all transactional email sending for Auth flows.
 * Supports welcome/invitation emails and member credential emails.
 * Tries tenant-connected accounts (Microsoft Graph / custom SMTP) before
 * falling back to platform-level SMTP relay.
 */
@Injectable()
export class AuthEmailService {
  private readonly logger = new Logger(AuthEmailService.name);

  constructor(private readonly authQuery: AuthQueryService) {}

  async sendWelcomeEmail(options: {
    to: string;
    fullName: string;
    tenantName: string;
    subdomain: string;
    invitationToken: string;
    adminEmail?: string;
    roleName?: string;
  }) {
    try {
      const smtpHost = process.env.SMTP_HOST || 'smtp.ethereal.email';
      const smtpUser = process.env.SMTP_USER;
      const smtpPass = process.env.SMTP_PASS;
      const smtpPort = parseInt(process.env.SMTP_PORT || '587', 10);

      const transporter = nodemailer.createTransport({
        host: smtpHost,
        port: smtpPort,
        secure: smtpPort === 465,
        auth: (smtpUser && smtpPass) ? { user: smtpUser, pass: smtpPass } : undefined,
        tls: { rejectUnauthorized: process.env.SMTP_IGNORE_TLS === 'true' ? false : true },
      });

      const appBaseUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
      const baseDomain = process.env.BASE_DOMAIN || (appBaseUrl.includes('localhost') ? 'localhost:3000' : 'enfyjobs.com');
      const workspaceUrl = options.subdomain && options.subdomain !== 'www' && options.subdomain !== baseDomain
        ? (appBaseUrl.includes('localhost') ? `${appBaseUrl}?subdomain=${options.subdomain}` : `https://${options.subdomain}.${baseDomain}`)
        : appBaseUrl;

      const setupPasswordUrl = `${appBaseUrl}/auth/setup-password?token=${options.invitationToken}`;
      const fromAddress = `"${options.tenantName}" <no-reply@${options.subdomain || 'app'}.${baseDomain}>`;
      const replyTo = options.adminEmail || `admin@${options.subdomain || baseDomain.split('.')[0]}.${baseDomain}`;

      const html = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 8px;">
          <h2 style="color: #4f46e5; margin-bottom: 8px;">Welcome to ${options.tenantName}</h2>
          <p style="font-size: 15px; color: #333;">Hi <strong>${options.fullName || 'there'}</strong>,</p>
          <p style="font-size: 14px; color: #555; line-height: 1.5;">
            You have been invited to join the <strong>${options.tenantName}</strong> workspace on Enfycon ATS as a <strong>${options.roleName || 'Team Member'}</strong>.
          </p>
          <div style="background-color: #f8fafc; padding: 15px; border-radius: 6px; margin: 20px 0;">
            <p style="margin: 4px 0; font-size: 14px;"><strong>Workspace URL:</strong> <a href="${workspaceUrl}" style="color: #4f46e5;">${workspaceUrl}</a></p>
            <p style="margin: 4px 0; font-size: 14px;"><strong>Your Login Email:</strong> ${options.to}</p>
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

      if (process.env.SMTP_HOST) {
        await transporter.sendMail({
          from: process.env.SMTP_FROM || fromAddress,
          replyTo: replyTo,
          to: options.to,
          subject: `You've been invited to join ${options.tenantName} on Enfycon ATS`,
          html,
        });
        this.logger.log(`[MAILER] Welcome invitation email dispatched to ${options.to}`);
      } else {
        this.logger.log(`[MAILER] Welcome invitation email generated for ${options.to} (SMTP_HOST not set, logging only)`);
      }
    } catch (err: any) {
      this.logger.warn(`[MAILER] Could not dispatch welcome email to ${options.to}: ${err.message}`);
    }
  }

  async sendMemberCredentialsEmail(options: {
    to: string;
    fullName: string;
    tenantName: string;
    subdomain: string;
    tenantId?: string;
    temporaryPassword?: string;
    roleName?: string;
  }) {
    try {
      const appBaseUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
      const baseDomain = process.env.BASE_DOMAIN || (appBaseUrl.includes('localhost') ? 'localhost:3000' : 'enfyjobs.com');
      const isSubdomainTenant = options.subdomain && options.subdomain !== 'www' && options.subdomain !== 'enfy' && options.subdomain !== baseDomain;
      const workspaceLoginUrl = isSubdomainTenant
        ? (appBaseUrl.includes('localhost') ? `${appBaseUrl}?subdomain=${options.subdomain}` : `https://${options.subdomain}.${baseDomain}/auth/login`)
        : (appBaseUrl.includes('localhost') ? `${appBaseUrl}/auth/login` : `https://${baseDomain}/auth/login`);

      const fromAddress = `"${options.tenantName}" <no-reply@${options.subdomain || 'app'}.${baseDomain}>`;
      const replyTo = `admin@${options.subdomain || baseDomain.split('.')[0]}.${baseDomain}`;
      const subject = `Welcome to ${options.tenantName} — Your Account Credentials & Login Guide`;

      const html = `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; border: 1px solid #e2e8f0; border-radius: 12px; background-color: #ffffff;">
          <div style="text-align: center; margin-bottom: 24px;">
            <h2 style="color: #4f46e5; margin: 0 0 6px 0; font-size: 24px;">Welcome to ${options.tenantName}</h2>
            <p style="color: #64748b; font-size: 14px; margin: 0;">Your EnfySync ATS Workspace Account is Ready</p>
          </div>
          <p style="font-size: 15px; color: #1e293b;">Hi <strong>${options.fullName || 'there'}</strong>,</p>
          <p style="font-size: 14px; color: #475569; line-height: 1.6;">
            Your account has been created for the <strong>${options.tenantName}</strong> ATS workspace as a <strong>${options.roleName || 'Team Member'}</strong>.
          </p>
          <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 18px; margin: 20px 0;">
            <h4 style="margin: 0 0 12px 0; color: #334155; font-size: 14px; text-transform: uppercase; letter-spacing: 0.5px;">🔐 Your Login Credentials</h4>
            <p style="margin: 6px 0; font-size: 14px; color: #334155;"><strong>Workspace URL:</strong> <a href="${workspaceLoginUrl}" style="color: #4f46e5; font-weight: 600;">${workspaceLoginUrl}</a></p>
            <p style="margin: 6px 0; font-size: 14px; color: #334155;"><strong>Username / Email:</strong> <span style="font-family: monospace; background: #e2e8f0; padding: 2px 6px; border-radius: 4px;">${options.to}</span></p>
            ${options.temporaryPassword ? `<p style="margin: 6px 0; font-size: 14px; color: #334155;"><strong>Password:</strong> <span style="font-family: monospace; background: #e2e8f0; padding: 2px 6px; border-radius: 4px; font-weight: bold; color: #0f172a;">${options.temporaryPassword}</span></p>` : ''}
          </div>
          <div style="text-align: center; margin: 28px 0;">
            <a href="${workspaceLoginUrl}" style="display: inline-block; background-color: #4f46e5; color: #ffffff; padding: 12px 28px; text-decoration: none; border-radius: 8px; font-weight: bold; font-size: 15px;">
              Sign In to Your Workspace &rarr;
            </a>
          </div>
          <hr style="border: none; border-top: 1px solid #f1f5f9; margin: 24px 0 16px 0;" />
          <p style="font-size: 11px; color: #94a3b8; text-align: center; margin: 0;">
            EnfySync AI Recruitment Platform &bull; ${options.tenantName}
          </p>
        </div>
      `;

      // Try tenant-connected email account first (Microsoft Graph or custom SMTP)
      if (options.tenantId) {
        const accRes = await this.authQuery.query(
          `SELECT id, provider, email_address, access_token, refresh_token, smtp_host, smtp_port, password, require_ssl
           FROM mass_mail.email_accounts 
           WHERE tenant_id = $1 AND is_active = true 
           ORDER BY is_default DESC, created_at DESC LIMIT 1`,
          [options.tenantId]
        );

        if (accRes.rows.length > 0) {
          const acc: any = accRes.rows[0];
          if (acc.provider === 'microsoft' && acc.access_token) {
            try {
              const payload = {
                message: {
                  subject,
                  body: { contentType: 'HTML', content: html },
                  toRecipients: [{ emailAddress: { address: options.to } }],
                },
                saveToSentItems: 'true',
              };
              await axios.post('https://graph.microsoft.com/v1.0/me/sendMail', payload, {
                headers: { Authorization: `Bearer ${acc.access_token}`, 'Content-Type': 'application/json' },
              });
              this.logger.log(`[AUTH_MAILER] Dispatched credentials email via Tenant Microsoft 365 (${acc.email_address}) to ${options.to}`);
              return;
            } catch (graphErr: any) {
              this.logger.warn(`[AUTH_MAILER] Direct Microsoft dispatch failed (${graphErr.message}), falling back to SMTP.`);
            }
          } else if (acc.provider === 'smtp' && acc.smtp_host) {
            try {
              const customTransporter = nodemailer.createTransport({
                host: acc.smtp_host,
                port: acc.smtp_port || 587,
                secure: acc.require_ssl || acc.smtp_port === 465,
                auth: { user: acc.email_address, pass: acc.password },
                tls: { rejectUnauthorized: process.env.SMTP_IGNORE_TLS === 'true' ? false : true },
              });
              await customTransporter.sendMail({
                from: `"${options.tenantName}" <${acc.email_address}>`,
                to: options.to,
                subject,
                html,
              });
              this.logger.log(`[AUTH_MAILER] Dispatched credentials email via Tenant SMTP (${acc.email_address}) to ${options.to}`);
              return;
            } catch (smtpErr: any) {
              this.logger.warn(`[AUTH_MAILER] Direct SMTP dispatch failed (${smtpErr.message}), falling back to default relay.`);
            }
          }
        }
      }

      // Default / Fallback: Platform SMTP Relay
      const smtpHost = process.env.SMTP_HOST || 'smtp.ethereal.email';
      const smtpUser = process.env.SMTP_USER;
      const smtpPass = process.env.SMTP_PASS;
      const smtpPort = parseInt(process.env.SMTP_PORT || '587', 10);

      const transporter = nodemailer.createTransport({
        host: smtpHost,
        port: smtpPort,
        secure: smtpPort === 465,
        auth: (smtpUser && smtpPass) ? { user: smtpUser, pass: smtpPass } : undefined,
        tls: { rejectUnauthorized: process.env.SMTP_IGNORE_TLS === 'true' ? false : true },
      });

      if (process.env.SMTP_HOST) {
        await transporter.sendMail({
          from: process.env.SMTP_FROM || fromAddress,
          replyTo: replyTo,
          to: options.to,
          subject,
          html,
        });
        this.logger.log(`[AUTH_MAILER] Member credentials email dispatched to ${options.to}`);
      } else {
        this.logger.log(`[AUTH_MAILER] Member credentials email generated for ${options.to} (SMTP_HOST not set, logging only)`);
      }
    } catch (err: any) {
      this.logger.warn(`[AUTH_MAILER] Could not dispatch member credentials email to ${options.to}: ${err.message}`);
    }
  }
}
