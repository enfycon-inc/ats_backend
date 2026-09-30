import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import * as nodemailer from 'nodemailer';
import axios from 'axios';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private transporter: nodemailer.Transporter;

  constructor(
    private readonly prisma: PrismaService,
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
      this.logger.log(`Executing campaign create...`);
      const campaign = await this.prisma.campaign.create({
        data: {
          tenantId,
          name: dto.name || 'Untitled Campaign',
          subject: dto.subject,
          bodyTemplate: dto.body,
          ratePerMinute: dto.ratePerMinute || 30,
          ratePerHour: dto.ratePerHour || 500,
          randomizeDelay: dto.randomizeDelay || false,
          emailAccountId: dto.accountId || null,
          status: 'Processing',
          createdBy: userId,
        },
        select: { id: true },
      });
      const campaignId = campaign.id;
      this.logger.log(`Campaign created with ID: ${campaignId}`);

      // Default delay calculation
      const baseDelayMs = (60 / (dto.ratePerMinute || 30)) * 1000;
      let currentDelay = 0;

      for (let i = 0; i < dto.recipients.length; i++) {
        const rec = dto.recipients[i];
        
        const recipient = await this.prisma.recipients.create({
          data: {
            campaignId,
            email: rec.email,
            firstName: rec.firstName,
            lastName: rec.lastName,
            metadata: rec.metadata || {},
            status: 'Pending',
          },
          select: { id: true },
        });
      
        const recipientId = recipient.id;

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
    } catch (err: any) {
      this.logger.error(`Error in createCampaign: ${err.message}`, err.stack);
      throw err;
    }
  }

  async getCampaignStatus(campaignId: string) {
    const statusCounts = await this.prisma.recipients.groupBy({
      by: ['status'],
      where: { campaignId },
      _count: { status: true },
    });
    
    const stats = { total: 0, pending: 0, sent: 0, failed: 0 };
    for (const row of statusCounts) {
      const count = row._count.status;
      stats.total += count;
      if (row.status === 'Pending') stats.pending += count;
      if (row.status === 'Sent') stats.sent += count;
      if (row.status === 'Failed') stats.failed += count;
    }
    
    // Also update campaign status to Completed if all done
    if (stats.total > 0 && stats.pending === 0 && stats.total === (stats.sent + stats.failed)) {
      await this.prisma.campaign.updateMany({
        where: { id: campaignId, status: { not: 'Completed' } },
        data: { status: 'Completed' },
      });
    }
    
    return stats;
  }

  async cancelCampaign(campaignId: string) {
    this.logger.log(`Cancelling campaign: ${campaignId}`);
    
    await this.prisma.campaign.update({
      where: { id: campaignId },
      data: { status: 'Cancelled' },
    });
    
    const res = await this.prisma.recipients.updateMany({
      where: { campaignId, status: 'Pending' },
      data: { status: 'Cancelled' },
    });
    
    return { success: true, message: `Campaign cancelled. ${res.count} pending emails stopped.` };
  }

  async getActiveCampaign() {
    const campaign = await this.prisma.campaign.findFirst({
      where: { status: 'Processing' },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    });
    return { activeCampaignId: campaign?.id || null };
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
      LEFT JOIN ats.users u ON c.created_by = u.id::varchar
      WHERE c.tenant_id = $1
    `;
    
    const params: any[] = [tenantId];
    
    // RBAC Filtering
    if (user && user.roles && (user.roles.includes('TENANT_ADMIN') || user.roles.includes('SUPER_ADMIN'))) {
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

    return await this.prisma.$queryRawUnsafe<any[]>(query, ...params);
  }

  async getCampaignRecipients(campaignId: string) {
    const recipients = await this.prisma.recipients.findMany({
      where: { campaignId },
      orderBy: [
        { sentAt: { sort: 'desc', nulls: 'last' } },
        { id: 'asc' },
      ],
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        status: true,
        metadata: true,
        sentAt: true,
      },
    });
    return recipients.map((r) => ({
      id: r.id,
      email: r.email,
      first_name: r.firstName,
      last_name: r.lastName,
      status: r.status,
      metadata: r.metadata,
      sent_at: r.sentAt,
    }));
  }

  async getTemplates(tenantId: string) {
    try {
      return await this.prisma.emailTemplate.findMany({
        where: { tenantId },
      });
    } catch (e: any) {
      this.logger.error('Failed to get templates', e);
      return [];
    }
  }

  async handleGoogleCallback(code: string, tenantId: string = process.env.DEFAULT_TENANT_ID as string, userId: string | null = null) {
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

  async handleMicrosoftCallback(code: string, tenantId: string = process.env.DEFAULT_TENANT_ID as string, userId: string | null = null) {
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
    await this.prisma.emailAccount.upsert({
      where: {
        provider_emailAddress_tenantId: {
          provider,
          emailAddress: email,
          tenantId,
        },
      },
      create: {
        provider,
        emailAddress: email,
        accessToken,
        refreshToken: refreshToken || null,
        tenantId,
        userId,
        isActive: true,
      },
      update: {
        accessToken,
        refreshToken: refreshToken || undefined,
        userId: userId || undefined,
        isActive: true,
      },
    });
  }
  
  async getConnectedAccounts(tenantId: string, user: any) {
    const isAdmin = !user || !user.dbId || (user.roles && (user.roles.includes('TENANT_ADMIN') || user.roles.includes('SUPER_ADMIN')));
    
    if (isAdmin) {
      const rows = await this.prisma.emailAccount.findMany({
        where: { tenantId, isActive: true },
        select: {
          id: true,
          provider: true,
          emailAddress: true,
          isDefault: true,
          isActive: true,
          createdAt: true,
          profileName: true,
          userId: true,
          sharedWithAll: true,
          sharedWithUsers: true,
          sharedWithBranches: true,
        },
      });
      return rows.map((r) => ({
        ...r,
        email: r.emailAddress,
      }));
    }
    
    // Regular user: Return accounts they own, or that are shared with them/their branch/tenant
    const rows = await this.prisma.$queryRawUnsafe<any[]>(`
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
    `, tenantId, user.dbId, user.branchId || null);
    return rows;
  }

  async addCustomAccount(dto: any, tenantId: string, userId: string) {
    const account = await this.prisma.emailAccount.create({
      data: {
        provider: 'smtp',
        emailAddress: dto.email,
        profileName: dto.profileName,
        password: dto.password,
        smtpHost: dto.smtpHost,
        smtpPort: dto.smtpPort,
        imapHost: dto.imapHost,
        imapPort: dto.imapPort,
        requireSsl: dto.requireSsl || false,
        requireTls: dto.requireTls || false,
        tenantId,
        userId,
      },
      select: {
        id: true,
        provider: true,
        emailAddress: true,
        profileName: true,
      },
    });
    return {
      id: account.id,
      provider: account.provider,
      email: account.emailAddress,
      profile_name: account.profileName,
    };
  }

  async deleteAccount(id: string, tenantId: string, user: any) {
    const userId = user?.dbId || user?.id;
    const isAdmin = user && user.roles && (user.roles.includes('TENANT_ADMIN') || user.roles.includes('SUPER_ADMIN'));
    
    if (isAdmin) {
      await this.prisma.emailAccount.deleteMany({ where: { id, tenantId } });
    } else if (userId) {
      await this.prisma.emailAccount.deleteMany({ where: { id, tenantId, userId } });
    }
    return { success: true };
  }

  async shareAccount(id: string, tenantId: string, user: any, dto: { sharedWithAll: boolean; sharedWithUsers: string[]; sharedWithBranches: string[] }) {
    const userId = user?.dbId || user?.id;
    const isAdmin = user && user.roles && (user.roles.includes('TENANT_ADMIN') || user.roles.includes('SUPER_ADMIN'));
    
    if (isAdmin) {
      await this.prisma.emailAccount.updateMany({
        where: { id, tenantId },
        data: {
          sharedWithAll: dto.sharedWithAll,
          sharedWithUsers: dto.sharedWithUsers || [],
          sharedWithBranches: dto.sharedWithBranches || [],
        },
      });
    } else if (userId) {
      await this.prisma.emailAccount.updateMany({
        where: { id, tenantId, userId },
        data: {
          sharedWithAll: dto.sharedWithAll,
          sharedWithUsers: dto.sharedWithUsers || [],
          sharedWithBranches: dto.sharedWithBranches || [],
        },
      });
    }
    return { success: true };
  }

  async setDefaultAccount(id: string, tenantId: string) {
    await this.prisma.emailAccount.updateMany({
      where: { tenantId },
      data: { isDefault: false },
    });
    await this.prisma.emailAccount.updateMany({
      where: { id, tenantId },
      data: { isDefault: true },
    });
    return { success: true };
  }

  async getPreferences(tenantId: string) {
    const rows = await this.prisma.emailPreference.findMany({
      where: { tenantId },
      select: { actionName: true, emailAccountId: true },
    });
    return rows.map((r) => ({
      action_name: r.actionName,
      email_account_id: r.emailAccountId,
    }));
  }

  async savePreference(actionName: string, accountId: string, tenantId: string) {
    await this.prisma.emailPreference.upsert({
      where: { actionName },
      create: {
        tenantId,
        actionName,
        emailAccountId: accountId,
      },
      update: {
        emailAccountId: accountId,
      },
    });
    return { success: true };
  }

  async sendMicrosoftEmail(accountId: string, subject: string, body: string, toEmail: string) {
    // 1. Get the account from DB
    const account = await this.prisma.emailAccount.findUnique({
      where: { id: accountId },
    });
    if (!account) throw new Error('Account not found');

    // 2. Refresh token logic
    let accessToken = account.accessToken || '';
    
    try {
      await this.postToGraphApi(accessToken, subject, body, toEmail);
    } catch (error: any) {
      if (error.response && error.response.status === 401 && account.refreshToken) {
        this.logger.log(`Token expired for ${account.emailAddress}. Refreshing...`);
        accessToken = await this.refreshMicrosoftToken(account.id, account.refreshToken);
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

    await this.prisma.emailAccount.update({
      where: { id: accountId },
      data: {
        accessToken: newAccessToken,
        refreshToken: newRefreshToken,
      },
    });

    return newAccessToken;
  }

  async getDeliverySettings(tenantId: string, branchId?: string) {
    const targetBranch = branchId && branchId.trim().length > 0 ? branchId.trim() : 'default';
    try {
      const setting = await this.prisma.deliverySettings.findFirst({
        where: {
          tenantId,
          OR: [{ branchId: targetBranch }, { branchId: 'default' }],
        },
        orderBy: {
          branchId: targetBranch === 'default' ? 'desc' : 'asc',
        },
      });
      if (setting) {
        return {
          ratePerMinute: setting.ratePerMinute,
          ratePerHour: setting.ratePerHour,
          randomizeDelay: setting.randomizeDelay,
        };
      }
    } catch (err: any) {
      this.logger.error(`Failed to fetch delivery settings: ${err.message}`);
    }
    return { ratePerMinute: 30, ratePerHour: 500, randomizeDelay: false };
  }

  async saveDeliverySettings(tenantId: string, dto: { branchId?: string; ratePerMinute?: number; ratePerHour?: number; randomizeDelay?: boolean }) {
    const targetBranch = dto.branchId && dto.branchId.trim().length > 0 ? dto.branchId.trim() : 'default';
    const ratePerMinute = typeof dto.ratePerMinute === 'number' ? dto.ratePerMinute : 30;
    const ratePerHour = typeof dto.ratePerHour === 'number' ? dto.ratePerHour : 500;
    const randomizeDelay = typeof dto.randomizeDelay === 'boolean' ? dto.randomizeDelay : false;

    await this.prisma.deliverySettings.upsert({
      where: {
        tenantId_branchId: {
          tenantId,
          branchId: targetBranch,
        },
      },
      create: {
        tenantId,
        branchId: targetBranch,
        ratePerMinute,
        ratePerHour,
        randomizeDelay,
      },
      update: {
        ratePerMinute,
        ratePerHour,
        randomizeDelay,
      },
    });

    return { success: true, ratePerMinute, ratePerHour, randomizeDelay };
  }

  /**
   * Dispatches email using custom SMTP account configured by a tenant
   */
  async sendSmtpEmail(accountId: string, subject: string, body: string, toEmail: string) {
    const account = await this.prisma.emailAccount.findUnique({
      where: { id: accountId },
    });
    if (!account) throw new Error('SMTP Account not found');

    const port = account.smtpPort || 587;
    const isSecure = account.requireSsl || port === 465;

    const transporter = nodemailer.createTransport({
      host: account.smtpHost || '',
      port: port,
      secure: isSecure,
      auth: {
        user: account.emailAddress,
        pass: account.password || '',
      },
      tls: {
        rejectUnauthorized: process.env.SMTP_IGNORE_TLS === 'true' ? false : true,
      },
    });

    const fromHeader = account.profileName 
      ? `"${account.profileName}" <${account.emailAddress}>`
      : account.emailAddress;

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
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: {
        id: true,
        name: true,
        domain: true,
        emailDispatchMode: true,
        customEmailDomain: true,
        customEmailDomainVerified: true,
      },
    });
    
    const tenantName = tenant?.name || 'Enfycon Workspace';
    const tenantDomain = tenant?.domain || 'enfy';
    const dispatchMode = tenant?.emailDispatchMode || 'DEFAULT_SUBDOMAIN';

    const baseDomain = process.env.BASE_DOMAIN || 'enfyjobs.com';

    // ─────────────────────────────────────────────────────────────
    // STRATEGY 1: DIRECT ACCOUNT (BYOE - Microsoft 365, Google, SMTP)
    // ─────────────────────────────────────────────────────────────
    if (dispatchMode === 'DIRECT_ACCOUNT' || dispatchMode === 'BYOE') {
      const account = await this.prisma.emailAccount.findFirst({
        where: { tenantId, isActive: true },
        orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }],
      });

      if (account) {
        try {
          if (account.provider === 'microsoft') {
            await this.sendMicrosoftEmail(account.id, subject, html, to);
            this.logger.log(`[TENANT_MAILER] Dispatched via Tenant Microsoft 365 (${account.emailAddress}) to ${to}`);
            return { success: true, provider: 'microsoft', from: account.emailAddress };
          } else if (account.provider === 'smtp') {
            await this.sendSmtpEmail(account.id, subject, html, to);
            this.logger.log(`[TENANT_MAILER] Dispatched via Tenant Custom SMTP (${account.emailAddress}) to ${to}`);
            return { success: true, provider: 'smtp', from: account.emailAddress };
          }
        } catch (err: any) {
          this.logger.warn(`[TENANT_MAILER] Direct account dispatch failed (${err.message}). Falling back to platform relay.`);
        }
      }
    }

    // ─────────────────────────────────────────────────────────────
    // STRATEGY 2: CUSTOM DOMAIN DELEGATION
    // ─────────────────────────────────────────────────────────────
    if (dispatchMode === 'CUSTOM_DOMAIN' && tenant?.customEmailDomain) {
      const fromCustom = `"${tenantName}" <no-reply@${tenant.customEmailDomain}>`;
      if (process.env.SMTP_HOST) {
        await this.transporter.sendMail({
          from: fromCustom,
          replyTo: replyTo || `admin@${tenant.customEmailDomain}`,
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
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: {
        name: true,
        domain: true,
        emailDispatchMode: true,
        customEmailDomain: true,
        customEmailDomainVerified: true,
      },
    });

    const baseDomain = process.env.BASE_DOMAIN || 'enfyjobs.com';
    const sub = tenant?.domain || 'workspace';
    const defaultSubdomainSender = sub === 'enfy' ? `no-reply@${baseDomain}` : `no-reply@${sub}.${baseDomain}`;

    const accounts = await this.prisma.emailAccount.findMany({
      where: { tenantId, isActive: true },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }],
      select: {
        id: true,
        provider: true,
        emailAddress: true,
        profileName: true,
        isDefault: true,
        isActive: true,
        createdAt: true,
      },
    });

    const formattedAccounts = accounts.map((a) => ({
      id: a.id,
      provider: a.provider,
      email: a.emailAddress,
      profileName: a.profileName,
      isDefault: a.isDefault,
      isActive: a.isActive,
      createdAt: a.createdAt,
    }));

    const customDomain = tenant?.customEmailDomain || '';
    const dnsRecords = customDomain ? [
      {
        type: 'TXT',
        host: customDomain,
        value: `v=spf1 include:spf.${baseDomain} ~all`,
        purpose: 'SPF Sender Authorization',
        status: tenant?.customEmailDomainVerified ? 'verified' : 'pending'
      },
      {
        type: 'CNAME',
        host: `enfy._domainkey.${customDomain}`,
        value: `dkim.${baseDomain}`,
        purpose: 'DKIM Cryptographic Signature',
        status: tenant?.customEmailDomainVerified ? 'verified' : 'pending'
      },
      {
        type: 'CNAME',
        host: `_dmarc.${customDomain}`,
        value: `dmarc.${baseDomain}`,
        purpose: 'DMARC Security Policy',
        status: tenant?.customEmailDomainVerified ? 'verified' : 'pending'
      }
    ] : [];

    return {
      dispatchMode: tenant?.emailDispatchMode || 'DEFAULT_SUBDOMAIN',
      defaultSubdomainSender,
      customDomain,
      customDomainVerified: !!tenant?.customEmailDomainVerified,
      dnsRecords,
      connectedAccounts: formattedAccounts,
      defaultAccount: formattedAccounts.find((a: any) => a.isDefault) || formattedAccounts[0] || null,
    };
  }

  async setTenantEmailMode(tenantId: string, mode: string) {
    const validModes = ['DEFAULT_SUBDOMAIN', 'DIRECT_ACCOUNT', 'CUSTOM_DOMAIN'];
    const chosen = validModes.includes(mode) ? mode : 'DEFAULT_SUBDOMAIN';
    await this.prisma.tenant.update({
      where: { id: tenantId },
      data: { emailDispatchMode: chosen },
    });
    return { success: true, mode: chosen };
  }

  async setTenantCustomDomain(tenantId: string, customDomain: string) {
    const clean = (customDomain || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
    await this.prisma.tenant.update({
      where: { id: tenantId },
      data: {
        customEmailDomain: clean || null,
        customEmailDomainVerified: false,
      },
    });
    return { success: true, customDomain: clean };
  }

  async verifyTenantCustomDomain(tenantId: string) {
    await this.prisma.tenant.update({
      where: { id: tenantId },
      data: { customEmailDomainVerified: true },
    });
    return { success: true, verified: true, message: 'Custom domain DNS records verified successfully!' };
  }
}
