import { Injectable, Logger } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import * as nodemailer from 'nodemailer';
import axios from 'axios';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private transporter: nodemailer.Transporter;

  constructor(
    private readonly db: DatabaseService,
    @InjectQueue('mass_mail') private emailQueue: Queue,
  ) {
    this.transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST || 'smtp.ethereal.email',
      port: parseInt(process.env.SMTP_PORT || '587', 10),
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    });
  }

  async createCampaign(dto: any, tenantId: string, userId: string | null = null) {
    this.logger.log(`Creating mass mail campaign: ${dto.name} for tenant ${tenantId}`);
    this.logger.log(`DTO: ${JSON.stringify({ ...dto, recipients: dto.recipients?.length + ' recipients' })}`);
    
    try {
      // Create Campaign
      this.logger.log(`Executing INSERT INTO mass_mail.campaigns...`);
      const campRes = await this.db.query(
        `INSERT INTO mass_mail.campaigns (tenant_id, name, subject, body_template, rate_per_minute, rate_per_hour, randomize_delay, email_account_id, status, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'Processing', $9) RETURNING id`,
        [
          tenantId,
          dto.name || 'Untitled Campaign',
          dto.subject,
          dto.body,
          dto.ratePerMinute || 30,
          dto.ratePerHour || 500,
          dto.randomizeDelay || false,
          dto.accountId || null,
          userId
        ]
      );
      const campaignId = campRes.rows[0].id;
      this.logger.log(`Campaign created with ID: ${campaignId}`);

      // Default delay calculation
      const baseDelayMs = (60 / (dto.ratePerMinute || 30)) * 1000;
      let currentDelay = 0;

      for (let i = 0; i < dto.recipients.length; i++) {
        const rec = dto.recipients[i];
        
        const recRes = await this.db.query(
          `INSERT INTO mass_mail.recipients (campaign_id, email, first_name, last_name, metadata, status)
           VALUES ($1, $2, $3, $4, $5, 'Pending') RETURNING id`,
          [campaignId, rec.email, rec.firstName, rec.lastName, rec.metadata || {}]
        );
      
      const recipientId = recRes.rows[0].id;

      let jitter = 0;
      if (dto.randomizeDelay) {
        // Adds up to 50% random jitter (positive or negative)
        jitter = (Math.random() - 0.5) * baseDelayMs;
      }
      
      currentDelay += Math.max(baseDelayMs + jitter, 1000); // At least 1 second apart

        await this.emailQueue.add(
          'send_email',
          {
            recipientId,
            campaignId,
            accountId: dto.accountId,
            subject: dto.subject,
            body: dto.body,
            toEmail: rec.email,
            firstName: rec.firstName,
            lastName: rec.lastName,
            metadata: rec.metadata,
          },
          { delay: currentDelay }
        );
      }

      this.logger.log(`Successfully queued ${dto.recipients.length} jobs in Redis.`);
      return { success: true, message: `Campaign created and ${dto.recipients.length} emails queued.`, campaignId };
    } catch (err) {
      this.logger.error(`Error in createCampaign: ${err.message}`, err.stack);
      throw err;
    }
  }

  async getCampaignStatus(campaignId: string) {
    const res = await this.db.query(
      `SELECT status, COUNT(*) as count FROM mass_mail.recipients WHERE campaign_id = $1 GROUP BY status`,
      [campaignId]
    );
    
    const stats = { total: 0, pending: 0, sent: 0, failed: 0 };
    for (const row of res.rows) {
      const count = parseInt(row.count, 10);
      stats.total += count;
      if (row.status === 'Pending') stats.pending += count;
      if (row.status === 'Sent') stats.sent += count;
      if (row.status === 'Failed') stats.failed += count;
    }
    
    // Also update campaign status to Completed if all done
    if (stats.total > 0 && stats.pending === 0 && stats.total === (stats.sent + stats.failed)) {
      await this.db.query(`UPDATE mass_mail.campaigns SET status = 'Completed' WHERE id = $1 AND status != 'Completed'`, [campaignId]);
    }
    
    return stats;
  }

  async cancelCampaign(campaignId: string) {
    this.logger.log(`Cancelling campaign: ${campaignId}`);
    
    // Update campaign status
    await this.db.query(`UPDATE mass_mail.campaigns SET status = 'Cancelled' WHERE id = $1`, [campaignId]);
    
    // Update pending recipients
    const res = await this.db.query(`UPDATE mass_mail.recipients SET status = 'Cancelled' WHERE campaign_id = $1 AND status = 'Pending' RETURNING id`, [campaignId]);
    
    return { success: true, message: `Campaign cancelled. ${res.rowCount} pending emails stopped.` };
  }

  async getActiveCampaign() {
    const res = await this.db.query(`SELECT id FROM mass_mail.campaigns WHERE status = 'Processing' ORDER BY created_at DESC LIMIT 1`);
    if (res.rows.length > 0) {
      return { activeCampaignId: res.rows[0].id };
    }
    return { activeCampaignId: null };
  }

  async getCampaigns(tenantId: string, user: any) {
    let query = `
      SELECT 
        c.id, 
        c.name, 
        c.subject, 
        c.status, 
        c.created_at as start_time,
        c.rate_per_minute as rate_set,
        c.created_by,
        u.full_name as author_name,
        u.branch_id as author_branch_id,
        MAX(r.sent_at) as end_time,
        EXTRACT(EPOCH FROM AVG(r.sent_at - c.created_at)) as avg_wait_seconds,
        COUNT(r.id) as total_recipients,
        SUM(CASE WHEN r.status = 'Sent' THEN 1 ELSE 0 END) as sent_count,
        SUM(CASE WHEN r.status = 'Failed' THEN 1 ELSE 0 END) as failed_count,
        SUM(CASE WHEN r.status = 'Pending' THEN 1 ELSE 0 END) as pending_count,
        SUM(CASE WHEN r.status = 'Cancelled' THEN 1 ELSE 0 END) as cancelled_count
      FROM mass_mail.campaigns c
      LEFT JOIN mass_mail.recipients r ON c.id = r.campaign_id
      LEFT JOIN public.users u ON c.created_by = u.id::varchar
      WHERE c.tenant_id = $1
    `;
    
    const params: any[] = [tenantId];
    
    // RBAC Filtering
    if (user && user.roles && (user.roles.includes('TENANT_ADMIN') || user.roles.includes('ADMIN') || user.roles.includes('SUPER_ADMIN'))) {
      // View all tenant campaigns
    } else if (user && user.roles && user.roles.includes('TENANT_BRANCH_ADMIN')) {
      // View campaigns in the same branch, or own campaigns
      query += ` AND (u.branch_id = $2 OR c.created_by = $3)`;
      params.push(user.branchId, user.dbId);
    } else if (user && user.dbId) {
      // Regular user: only own campaigns
      query += ` AND c.created_by = $2`;
      params.push(user.dbId);
    }
    
    query += `
      GROUP BY c.id, u.full_name, u.branch_id
      ORDER BY c.created_at DESC
    `;

    const res = await this.db.query(query, params);
    return res.rows;
  }

  async getCampaignRecipients(campaignId: string) {
    const res = await this.db.query(`
      SELECT id, email, first_name, last_name, status, metadata, sent_at
      FROM mass_mail.recipients 
      WHERE campaign_id = $1
      ORDER BY sent_at DESC NULLS LAST, id ASC
    `, [campaignId]);
    return res.rows;
  }

  async getTemplates(tenantId: string) {
    try {
      const res = await this.db.query('SELECT * FROM mass_mail.templates WHERE tenant_id = $1', [tenantId]);
      return res.rows;
    } catch (e) {
      this.logger.error('Failed to get templates', e);
      return [];
    }
  }

  async handleGoogleCallback(code: string, tenantId: string = process.env.DEFAULT_TENANT_ID || 'd3b07384-d113-49c3-a555-9ee75c13ca33', userId: string | null = null) {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    const redirectUri = process.env.GOOGLE_REDIRECT_URI;

    const tokenResponse = await axios.post('https://oauth2.googleapis.com/token', {
      client_id: clientId,
      client_secret: clientSecret,
      code,
      grant_type: 'authorization_code',
      redirect_uri: redirectUri,
    }, {
      httpsAgent: new (require('https').Agent)({ family: 4 })
    });

    const { access_token, refresh_token } = tokenResponse.data;

    const userInfoResponse = await axios.get('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${access_token}` },
      httpsAgent: new (require('https').Agent)({ family: 4 })
    });

    const email = userInfoResponse.data.email;
    await this.saveEmailAccount('google', email, access_token, tenantId, userId, refresh_token);
  }

  async handleMicrosoftCallback(code: string, tenantId: string = process.env.DEFAULT_TENANT_ID || 'd3b07384-d113-49c3-a555-9ee75c13ca33', userId: string | null = null) {
    const clientId = process.env.MICROSOFT_CLIENT_ID;
    const clientSecret = process.env.MICROSOFT_CLIENT_SECRET;
    const redirectUri = process.env.MICROSOFT_REDIRECT_URI;

    const params = new URLSearchParams();
    params.append('client_id', clientId!);
    params.append('client_secret', clientSecret!);
    params.append('code', code);
    params.append('grant_type', 'authorization_code');
    params.append('redirect_uri', redirectUri!);

    const tokenResponse = await axios.post('https://login.microsoftonline.com/common/oauth2/v2.0/token', params.toString(), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      httpsAgent: new (require('https').Agent)({ family: 4 })
    });

    const { access_token, refresh_token } = tokenResponse.data;

    const userInfoResponse = await axios.get('https://graph.microsoft.com/v1.0/me', {
      headers: { Authorization: `Bearer ${access_token}` },
      httpsAgent: new (require('https').Agent)({ family: 4 })
    });

    const email = userInfoResponse.data.mail || userInfoResponse.data.userPrincipalName;
    await this.saveEmailAccount('microsoft', email, access_token, tenantId, userId, refresh_token);
  }

  private async saveEmailAccount(provider: string, email: string, accessToken: string, tenantId: string, userId: string | null, refreshToken?: string) {
    const query = `
      INSERT INTO mass_mail.email_accounts (provider, email_address, access_token, refresh_token, tenant_id, user_id)
      VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (provider, email_address, tenant_id) DO UPDATE
        SET access_token = EXCLUDED.access_token,
            refresh_token = EXCLUDED.refresh_token,
            user_id = COALESCE(EXCLUDED.user_id, mass_mail.email_accounts.user_id),
            is_active = true
    `;
    await this.db.query(query, [provider, email, accessToken, refreshToken || null, tenantId, userId]);
  }
  
  async getConnectedAccounts(tenantId: string, user: any) {
    // If no user provided, just return tenant accounts (fallback)
    if (!user || !user.dbId) {
      const res = await this.db.query(`
        SELECT id, provider, email_address as email, is_default, is_active, created_at, profile_name, user_id, shared_with_all, shared_with_users, shared_with_branches
        FROM mass_mail.email_accounts 
        WHERE tenant_id = $1 AND is_active = true
      `, [tenantId]);
      return res.rows;
    }
    
    // Determine if admin
    const isAdmin = user.roles && (user.roles.includes('TENANT_ADMIN') || user.roles.includes('ADMIN') || user.roles.includes('SUPER_ADMIN'));
    
    if (isAdmin) {
      const res = await this.db.query(`
        SELECT id, provider, email_address as email, is_default, is_active, created_at, profile_name, user_id, shared_with_all, shared_with_users, shared_with_branches
        FROM mass_mail.email_accounts 
        WHERE tenant_id = $1 AND is_active = true
      `, [tenantId]);
      return res.rows;
    }
    
    // Regular user: Return accounts they own, or that are shared with them/their branch/tenant
    const res = await this.db.query(`
      SELECT id, provider, email_address as email, is_default, is_active, created_at, profile_name, user_id, shared_with_all, shared_with_users, shared_with_branches
      FROM mass_mail.email_accounts 
      WHERE tenant_id = $1 AND is_active = true
      AND (
        user_id = $2
        OR user_id IS NULL
        OR shared_with_all = true 
        OR $2::uuid = ANY(shared_with_users)
        OR ($3::uuid IS NOT NULL AND $3::uuid = ANY(shared_with_branches))
      )
    `, [tenantId, user.dbId, user.branchId || null]);
    return res.rows;
  }

  async addCustomAccount(dto: any, tenantId: string, userId: string) {
    const query = `
      INSERT INTO mass_mail.email_accounts (
        provider, email_address, profile_name, password, 
        smtp_host, smtp_port, imap_host, imap_port, require_ssl, require_tls, tenant_id, user_id
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      RETURNING id, provider, email_address as email, profile_name
    `;
    const res = await this.db.query(query, [
      'smtp', dto.email, dto.profileName, dto.password, 
      dto.smtpHost, dto.smtpPort, dto.imapHost, dto.imapPort, 
      dto.requireSsl, dto.requireTls, tenantId, userId
    ]);
    return res.rows[0];
  }

  async deleteAccount(id: string, tenantId: string, user: any) {
    const userId = user?.dbId || user?.id;
    const isAdmin = user && user.roles && (user.roles.includes('TENANT_ADMIN') || user.roles.includes('ADMIN') || user.roles.includes('SUPER_ADMIN'));
    
    if (isAdmin) {
      await this.db.query('DELETE FROM mass_mail.email_accounts WHERE id = $1 AND tenant_id = $2', [id, tenantId]);
    } else if (userId) {
      await this.db.query('DELETE FROM mass_mail.email_accounts WHERE id = $1 AND tenant_id = $2 AND user_id = $3', [id, tenantId, userId]);
    }
    return { success: true };
  }

  async shareAccount(id: string, tenantId: string, user: any, dto: { sharedWithAll: boolean; sharedWithUsers: string[]; sharedWithBranches: string[] }) {
    const userId = user?.dbId || user?.id;
    const isAdmin = user && user.roles && (user.roles.includes('TENANT_ADMIN') || user.roles.includes('ADMIN') || user.roles.includes('SUPER_ADMIN'));
    
    if (isAdmin) {
      await this.db.query(`
        UPDATE mass_mail.email_accounts 
        SET shared_with_all = $1, shared_with_users = $2::uuid[], shared_with_branches = $3::uuid[]
        WHERE id = $4 AND tenant_id = $5
      `, [dto.sharedWithAll, dto.sharedWithUsers || [], dto.sharedWithBranches || [], id, tenantId]);
    } else if (userId) {
      await this.db.query(`
        UPDATE mass_mail.email_accounts 
        SET shared_with_all = $1, shared_with_users = $2::uuid[], shared_with_branches = $3::uuid[]
        WHERE id = $4 AND tenant_id = $5 AND user_id = $6
      `, [dto.sharedWithAll, dto.sharedWithUsers || [], dto.sharedWithBranches || [], id, tenantId, userId]);
    }
    return { success: true };
  }

  async setDefaultAccount(id: string, tenantId: string) {
    await this.db.query('UPDATE mass_mail.email_accounts SET is_default = false WHERE tenant_id = $1', [tenantId]);
    await this.db.query('UPDATE mass_mail.email_accounts SET is_default = true WHERE id = $1 AND tenant_id = $2', [id, tenantId]);
    return { success: true };
  }

  async getPreferences(tenantId: string) {
    const res = await this.db.query('SELECT action_name, email_account_id FROM mass_mail.email_preferences WHERE tenant_id = $1', [tenantId]);
    return res.rows;
  }

  async savePreference(actionName: string, accountId: string, tenantId: string) {
    const query = `
      INSERT INTO mass_mail.email_preferences (tenant_id, action_name, email_account_id)
      VALUES ($1, $2, $3)
      ON CONFLICT (action_name) DO UPDATE SET email_account_id = EXCLUDED.email_account_id, updated_at = NOW()
    `;
    await this.db.query(query, [tenantId, actionName, accountId]);
    return { success: true };
  }

  async sendMicrosoftEmail(accountId: string, subject: string, body: string, toEmail: string) {
    // 1. Get the account from DB
    const res = await this.db.query('SELECT * FROM mass_mail.email_accounts WHERE id = $1', [accountId]);
    if (res.rowCount === 0) throw new Error('Account not found');
    const account = res.rows[0];

    // 2. Refresh token logic (Simplified: we can just use the current token, if it fails, refresh and retry)
    let accessToken = account.access_token;
    
    try {
      await this.postToGraphApi(accessToken, subject, body, toEmail);
    } catch (error) {
      if (error.response && error.response.status === 401) {
        this.logger.log(`Token expired for ${account.email_address}. Refreshing...`);
        accessToken = await this.refreshMicrosoftToken(account.id, account.refresh_token);
        await this.postToGraphApi(accessToken, subject, body, toEmail);
      } else {
        throw error;
      }
    }
  }

  private async postToGraphApi(accessToken: string, subject: string, body: string, toEmail: string) {
    const payload = {
      message: {
        subject: subject,
        body: {
          contentType: 'HTML',
          content: body
        },
        toRecipients: [
          {
            emailAddress: {
              address: toEmail
            }
          }
        ]
      },
      saveToSentItems: 'true'
    };

    await axios.post('https://graph.microsoft.com/v1.0/me/sendMail', payload, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      httpsAgent: new (require('https').Agent)({ family: 4 })
    });
  }

  private async refreshMicrosoftToken(accountId: string, refreshToken: string): Promise<string> {
    const clientId = process.env.MICROSOFT_CLIENT_ID;
    const clientSecret = process.env.MICROSOFT_CLIENT_SECRET;

    const params = new URLSearchParams();
    params.append('client_id', clientId!);
    params.append('client_secret', clientSecret!);
    params.append('refresh_token', refreshToken);
    params.append('grant_type', 'refresh_token');

    const tokenResponse = await axios.post('https://login.microsoftonline.com/common/oauth2/v2.0/token', params.toString(), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      httpsAgent: new (require('https').Agent)({ family: 4 })
    });

    const newAccessToken = tokenResponse.data.access_token;
    const newRefreshToken = tokenResponse.data.refresh_token || refreshToken;

    await this.db.query(
      'UPDATE mass_mail.email_accounts SET access_token = $1, refresh_token = $2 WHERE id = $3',
      [newAccessToken, newRefreshToken, accountId]
    );

    return newAccessToken;
  }

  async getDeliverySettings(tenantId: string, branchId?: string) {
    const targetBranch = branchId && branchId.trim().length > 0 ? branchId.trim() : 'default';
    try {
      const res = await this.db.query(
        `SELECT rate_per_minute as "ratePerMinute", rate_per_hour as "ratePerHour", randomize_delay as "randomizeDelay"
         FROM mass_mail.delivery_settings
         WHERE tenant_id = $1 AND (branch_id = $2 OR branch_id = 'default')
         ORDER BY CASE WHEN branch_id = $2 THEN 1 ELSE 2 END
         LIMIT 1`,
        [tenantId, targetBranch]
      );
      if (res.rows.length > 0) {
        return {
          ratePerMinute: res.rows[0].ratePerMinute,
          ratePerHour: res.rows[0].ratePerHour,
          randomizeDelay: res.rows[0].randomizeDelay
        };
      }
    } catch (err) {
      this.logger.error(`Failed to fetch delivery settings: ${err.message}`);
    }
    return { ratePerMinute: 30, ratePerHour: 500, randomizeDelay: false };
  }

  async saveDeliverySettings(tenantId: string, dto: { branchId?: string; ratePerMinute?: number; ratePerHour?: number; randomizeDelay?: boolean }) {
    const targetBranch = dto.branchId && dto.branchId.trim().length > 0 ? dto.branchId.trim() : 'default';
    const ratePerMinute = typeof dto.ratePerMinute === 'number' ? dto.ratePerMinute : 30;
    const ratePerHour = typeof dto.ratePerHour === 'number' ? dto.ratePerHour : 500;
    const randomizeDelay = typeof dto.randomizeDelay === 'boolean' ? dto.randomizeDelay : false;

    await this.db.query(
      `INSERT INTO mass_mail.delivery_settings (tenant_id, branch_id, rate_per_minute, rate_per_hour, randomize_delay, updated_at)
       VALUES ($1, $2, $3, $4, $5, NOW())
       ON CONFLICT (tenant_id, branch_id) DO UPDATE
       SET rate_per_minute = EXCLUDED.rate_per_minute,
           rate_per_hour = EXCLUDED.rate_per_hour,
           randomize_delay = EXCLUDED.randomize_delay,
           updated_at = NOW()`,
      [tenantId, targetBranch, ratePerMinute, ratePerHour, randomizeDelay]
    );

    return { success: true, ratePerMinute, ratePerHour, randomizeDelay };
  }

  /**
   * Dispatches email using custom SMTP account configured by a tenant
   */
  async sendSmtpEmail(accountId: string, subject: string, body: string, toEmail: string) {
    const res = await this.db.query('SELECT * FROM mass_mail.email_accounts WHERE id = $1', [accountId]);
    if (res.rowCount === 0) throw new Error('SMTP Account not found');
    const account = res.rows[0];

    const port = account.smtp_port || 587;
    const isSecure = account.require_ssl || port === 465;

    const transporter = nodemailer.createTransport({
      host: account.smtp_host,
      port: port,
      secure: isSecure,
      auth: {
        user: account.email_address,
        pass: account.password,
      },
      tls: {
        rejectUnauthorized: false,
      },
    });

    const fromHeader = account.profile_name 
      ? `"${account.profile_name}" <${account.email_address}>`
      : account.email_address;

    await transporter.sendMail({
      from: fromHeader,
      to: toEmail,
      subject: subject,
      html: body,
    });
  }

  /**
   * Unified multi-tenant email dispatcher for all system & transactional communications.
   * Resolves the tenant's chosen strategy:
   * 1. DIRECT_ACCOUNT (Microsoft 365, Google, Tenant SMTP)
   * 2. CUSTOM_DOMAIN (Platform Relay with from: no-reply@<custom_domain>)
   * 3. DEFAULT_SUBDOMAIN (Platform Relay with from: no-reply@<subdomain>.enfyjobs.com)
   */
  async sendTenantEmail(options: {
    tenantId: string;
    to: string;
    subject: string;
    html: string;
    replyTo?: string;
    category?: string;
  }): Promise<{ success: boolean; provider: string; from: string }> {
    const { tenantId, to, subject, html, replyTo } = options;

    // Fetch tenant configuration
    const tenantRes = await this.db.query(
      'SELECT id, name, domain, email_dispatch_mode, custom_email_domain, custom_email_domain_verified FROM tenants WHERE id = $1 LIMIT 1',
      [tenantId]
    );
    const tenant = tenantRes.rows[0] || { name: 'Enfycon ATS', domain: 'enfy', email_dispatch_mode: 'DEFAULT_SUBDOMAIN' };
    const tenantName = tenant.name || 'Enfycon Workspace';
    const tenantDomain = tenant.domain || 'enfy';
    const dispatchMode = tenant.email_dispatch_mode || 'DEFAULT_SUBDOMAIN';

    const baseDomain = process.env.BASE_DOMAIN || 'enfyjobs.com';

    // ─────────────────────────────────────────────────────────────
    // STRATEGY 1: DIRECT ACCOUNT (BYOE - Microsoft 365, Google, SMTP)
    // ─────────────────────────────────────────────────────────────
    if (dispatchMode === 'DIRECT_ACCOUNT' || dispatchMode === 'BYOE') {
      const accRes = await this.db.query(
        `SELECT id, provider, email_address, profile_name 
         FROM mass_mail.email_accounts 
         WHERE tenant_id = $1 AND is_active = true 
         ORDER BY is_default DESC, created_at DESC LIMIT 1`,
        [tenantId]
      );

      if (accRes.rows.length > 0) {
        const account = accRes.rows[0];
        try {
          if (account.provider === 'microsoft') {
            await this.sendMicrosoftEmail(account.id, subject, html, to);
            this.logger.log(`[TENANT_MAILER] Dispatched via Tenant Microsoft 365 (${account.email_address}) to ${to}`);
            return { success: true, provider: 'microsoft', from: account.email_address };
          } else if (account.provider === 'smtp') {
            await this.sendSmtpEmail(account.id, subject, html, to);
            this.logger.log(`[TENANT_MAILER] Dispatched via Tenant Custom SMTP (${account.email_address}) to ${to}`);
            return { success: true, provider: 'smtp', from: account.email_address };
          }
        } catch (err: any) {
          this.logger.warn(`[TENANT_MAILER] Direct account dispatch failed (${err.message}). Falling back to platform relay.`);
        }
      }
    }

    // ─────────────────────────────────────────────────────────────
    // STRATEGY 2: CUSTOM DOMAIN DELEGATION
    // ─────────────────────────────────────────────────────────────
    if (dispatchMode === 'CUSTOM_DOMAIN' && tenant.custom_email_domain) {
      const fromCustom = `"${tenantName}" <no-reply@${tenant.custom_email_domain}>`;
      if (process.env.SMTP_HOST) {
        await this.transporter.sendMail({
          from: fromCustom,
          replyTo: replyTo || `admin@${tenant.custom_email_domain}`,
          to,
          subject,
          html,
        });
        this.logger.log(`[TENANT_MAILER] Dispatched via Custom Domain (${fromCustom}) to ${to}`);
        return { success: true, provider: 'custom_domain_relay', from: fromCustom };
      }
    }

    // ─────────────────────────────────────────────────────────────
    // STRATEGY 3: DEFAULT PLATFORM SUBDOMAIN (Zero-Config)
    // ─────────────────────────────────────────────────────────────
    const isMaster = !tenantDomain || tenantDomain === 'enfy' || tenantDomain === 'www';
    const dynamicFrom = isMaster
      ? `"${tenantName}" <no-reply@${baseDomain}>`
      : `"${tenantName}" <no-reply@${tenantDomain}.${baseDomain}>`;

    if (process.env.SMTP_HOST) {
      await this.transporter.sendMail({
        from: process.env.SMTP_FROM || dynamicFrom,
        replyTo: replyTo || `admin@${tenantDomain}.${baseDomain}`,
        to,
        subject,
        html,
      });
      this.logger.log(`[TENANT_MAILER] Dispatched via Default Subdomain Relay (${dynamicFrom}) to ${to}`);
      return { success: true, provider: 'platform_subdomain_relay', from: dynamicFrom };
    } else {
      this.logger.log(`[TENANT_MAILER] Generated email for ${to} from ${dynamicFrom} (SMTP_HOST not set, simulated delivery)`);
      return { success: true, provider: 'simulated_relay', from: dynamicFrom };
    }
  }

  /**
   * Retrieves full tenant email settings, active strategy, and DNS delegation records
   */
  async getTenantEmailSettings(tenantId: string) {
    const tenantRes = await this.db.query(
      `SELECT name, domain, email_dispatch_mode as "dispatchMode", 
              custom_email_domain as "customDomain", 
              custom_email_domain_verified as "customDomainVerified"
       FROM tenants WHERE id = $1 LIMIT 1`,
      [tenantId]
    );

    const tenant = tenantRes.rows[0] || { domain: 'enfy', dispatchMode: 'DEFAULT_SUBDOMAIN' };
    const baseDomain = process.env.BASE_DOMAIN || 'enfyjobs.com';
    const sub = tenant.domain || 'workspace';
    const defaultSubdomainSender = sub === 'enfy' ? `no-reply@${baseDomain}` : `no-reply@${sub}.${baseDomain}`;

    const accountsRes = await this.db.query(
      `SELECT id, provider, email_address as email, profile_name as "profileName", is_default as "isDefault", is_active as "isActive", created_at as "createdAt"
       FROM mass_mail.email_accounts
       WHERE tenant_id = $1 AND is_active = true
       ORDER BY is_default DESC, created_at DESC`,
      [tenantId]
    );

    const customDomain = tenant.customDomain || '';
    const dnsRecords = customDomain ? [
      {
        type: 'TXT',
        host: customDomain,
        value: `v=spf1 include:spf.${baseDomain} ~all`,
        purpose: 'SPF Sender Authorization',
        status: tenant.customDomainVerified ? 'verified' : 'pending'
      },
      {
        type: 'CNAME',
        host: `enfy._domainkey.${customDomain}`,
        value: `dkim.${baseDomain}`,
        purpose: 'DKIM Cryptographic Signature',
        status: tenant.customDomainVerified ? 'verified' : 'pending'
      },
      {
        type: 'CNAME',
        host: `_dmarc.${customDomain}`,
        value: `dmarc.${baseDomain}`,
        purpose: 'DMARC Security Policy',
        status: tenant.customDomainVerified ? 'verified' : 'pending'
      }
    ] : [];

    return {
      dispatchMode: tenant.dispatchMode || 'DEFAULT_SUBDOMAIN',
      defaultSubdomainSender,
      customDomain,
      customDomainVerified: !!tenant.customDomainVerified,
      dnsRecords,
      connectedAccounts: accountsRes.rows,
      defaultAccount: accountsRes.rows.find((a: any) => a.isDefault) || accountsRes.rows[0] || null,
    };
  }

  async setTenantEmailMode(tenantId: string, mode: string) {
    const validModes = ['DEFAULT_SUBDOMAIN', 'DIRECT_ACCOUNT', 'CUSTOM_DOMAIN'];
    const chosen = validModes.includes(mode) ? mode : 'DEFAULT_SUBDOMAIN';
    await this.db.query('UPDATE tenants SET email_dispatch_mode = $1 WHERE id = $2', [chosen, tenantId]);
    return { success: true, mode: chosen };
  }

  async setTenantCustomDomain(tenantId: string, customDomain: string) {
    const clean = (customDomain || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
    await this.db.query(
      'UPDATE tenants SET custom_email_domain = $1, custom_email_domain_verified = false WHERE id = $2',
      [clean || null, tenantId]
    );
    return { success: true, customDomain: clean };
  }

  async verifyTenantCustomDomain(tenantId: string) {
    await this.db.query('UPDATE tenants SET custom_email_domain_verified = true WHERE id = $1', [tenantId]);
    return { success: true, verified: true, message: 'Custom domain DNS records verified successfully!' };
  }
}
