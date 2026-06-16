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

  async createCampaign(dto: any) {
    this.logger.log(`Creating mass mail campaign: ${dto.name}`);
    this.logger.log(`DTO: ${JSON.stringify({ ...dto, recipients: dto.recipients?.length + ' recipients' })}`);
    
    try {
      // Create Campaign
      this.logger.log(`Executing INSERT INTO mass_mail.campaigns...`);
      const campRes = await this.db.query(
        `INSERT INTO mass_mail.campaigns (tenant_id, name, subject, body_template, rate_per_minute, rate_per_hour, randomize_delay, email_account_id, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'Processing') RETURNING id`,
        [
          'd3b07384-d113-49c3-a555-9ee75c13ca33', // Default Tenant
          dto.name || 'Untitled Campaign',
          dto.subject,
          dto.body,
          dto.ratePerMinute || 30,
          dto.ratePerHour || 500,
          dto.randomizeDelay || false,
          dto.accountId || null, // FIX: Fallback to null instead of undefined!
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

  async getCampaigns() {
    const res = await this.db.query(`
      SELECT 
        c.id, 
        c.name, 
        c.subject, 
        c.status, 
        c.created_at as start_time,
        c.rate_per_minute as rate_set,
        MAX(r.sent_at) as end_time,
        EXTRACT(EPOCH FROM AVG(r.sent_at - c.created_at)) as avg_wait_seconds,
        COUNT(r.id) as total_recipients,
        SUM(CASE WHEN r.status = 'Sent' THEN 1 ELSE 0 END) as sent_count,
        SUM(CASE WHEN r.status = 'Failed' THEN 1 ELSE 0 END) as failed_count,
        SUM(CASE WHEN r.status = 'Pending' THEN 1 ELSE 0 END) as pending_count,
        SUM(CASE WHEN r.status = 'Cancelled' THEN 1 ELSE 0 END) as cancelled_count
      FROM mass_mail.campaigns c
      LEFT JOIN mass_mail.recipients r ON c.id = r.campaign_id
      GROUP BY c.id
      ORDER BY c.created_at DESC
    `);
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

  async getTemplates() {
    try {
      const res = await this.db.query('SELECT * FROM mass_mail.templates');
      return res.rows;
    } catch (e) {
      this.logger.error('Failed to get templates', e);
      return [];
    }
  }

  async handleGoogleCallback(code: string) {
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
    await this.saveEmailAccount('google', email, access_token, refresh_token);
  }

  async handleMicrosoftCallback(code: string) {
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
    await this.saveEmailAccount('microsoft', email, access_token, refresh_token);
  }

  private async saveEmailAccount(provider: string, email: string, accessToken: string, refreshToken?: string) {
    const query = `
      INSERT INTO mass_mail.email_accounts (provider, email_address, access_token, refresh_token)
      VALUES ($1, $2, $3, $4)
    `;
    await this.db.query(query, [provider, email, accessToken, refreshToken || null]);
  }
  
  async getConnectedAccounts() {
    const res = await this.db.query(`
      SELECT id, provider, email_address as email, is_default, is_active, created_at, profile_name 
      FROM mass_mail.email_accounts 
      WHERE is_active = true
    `);
    return res.rows;
  }

  async addCustomAccount(dto: any) {
    const query = `
      INSERT INTO mass_mail.email_accounts (
        provider, email_address, profile_name, password, 
        smtp_host, smtp_port, imap_host, imap_port, require_ssl, require_tls
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      RETURNING id, provider, email_address as email, profile_name
    `;
    const res = await this.db.query(query, [
      'smtp', dto.email, dto.profileName, dto.password, 
      dto.smtpHost, dto.smtpPort, dto.imapHost, dto.imapPort, 
      dto.requireSsl, dto.requireTls
    ]);
    return res.rows[0];
  }

  async deleteAccount(id: string) {
    await this.db.query('DELETE FROM mass_mail.email_accounts WHERE id = $1', [id]);
    return { success: true };
  }

  async setDefaultAccount(id: string) {
    await this.db.query('UPDATE mass_mail.email_accounts SET is_default = false');
    await this.db.query('UPDATE mass_mail.email_accounts SET is_default = true WHERE id = $1', [id]);
    return { success: true };
  }

  async getPreferences() {
    const res = await this.db.query('SELECT action_name, email_account_id FROM mass_mail.email_preferences');
    return res.rows;
  }

  async savePreference(actionName: string, accountId: string) {
    const tenantRes = await this.db.query('SELECT id FROM public.tenants LIMIT 1');
    const tenantId = tenantRes.rows[0].id;
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
}
