import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import axios from 'axios';
import * as nodemailer from 'nodemailer';
import { createHash } from 'node:crypto';
import { resolveTxt } from 'node:dns/promises';
import { PrismaService } from '../prisma/prisma.service';
import { applySystemEmailReplyPolicy } from './system-email-template';
import type {
  EmailDispatchMode,
  EmailDispatchResult,
  EmailDnsRecord,
  SystemEmailRequest,
  TenantEmailSettings,
} from './system-email.types';

interface BrevoDomain {
  verified: boolean;
  authenticated: boolean;
  dns_records?: Record<
    string,
    { type: string; host_name: string; value: string; status: boolean }
  >;
}
interface BrevoMessage {
  sender: { email: string; name: string };
  to: { email: string }[];
  subject: string;
  htmlContent: string;
  textContent?: string;
  replyTo?: { email: string };
}

@Injectable()
export class SystemMailService {
  private readonly logger = new Logger(SystemMailService.name);
  private readonly brevo = axios.create({
    baseURL: 'https://api.brevo.com/v3',
    timeout: 15000,
  });
  constructor(private readonly prisma: PrismaService) {}

  private email(value: string | undefined, label: string): string {
    if (!value || !/^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(value)) {
      throw new BadRequestException(`${label} must be a valid email address.`);
    }
    return value;
  }

  platformSender() {
    return {
      email: this.email(
        process.env.SYSTEM_EMAIL_FROM?.trim(),
        'Platform sender',
      ),
      name: process.env.SYSTEM_EMAIL_FROM_NAME?.trim() || 'EnfySync',
    };
  }

  private brevoOptions() {
    const key = process.env.BREVO_APIKEY?.trim();
    if (!key)
      throw new ServiceUnavailableException(
        'Platform email is not configured. Contact your platform administrator.',
      );
    return { headers: { 'api-key': key, accept: 'application/json' } };
  }

  private failure(provider: string, error: unknown): never {
    const status = axios.isAxiosError(error)
      ? error.response?.status
      : undefined;
    // Axios errors contain request headers and message bodies; never log the error object.
    this.logger.warn(
      `System email provider ${provider} failed (status=${status ?? 'unavailable'}).`,
    );
    throw new ServiceUnavailableException(
      status === 429
        ? 'Email sending limit reached. Try again later or contact your administrator.'
        : 'Email provider did not confirm acceptance. Check the configured sender before retrying.',
    );
  }

  async tenant(tenantId: string) {
    if (!tenantId?.trim())
      throw new BadRequestException(
        'Tenant identity is required for system email.',
      );
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: {
        id: true,
        name: true,
        emailDispatchMode: true,
        customEmailDomain: true,
        customEmailDomainVerified: true,
      },
    });
    if (!tenant) throw new NotFoundException('Workspace not found.');
    return tenant;
  }

  private mode(value: string | null): EmailDispatchMode {
    if (!value || value === 'DEFAULT_SUBDOMAIN') return 'DEFAULT_SUBDOMAIN';
    if (value === 'BYOE' || value === 'DIRECT_ACCOUNT') return 'DIRECT_ACCOUNT';
    if (value === 'CUSTOM_DOMAIN') return 'CUSTOM_DOMAIN';
    throw new BadRequestException('Unknown workspace email strategy.');
  }

  private async defaultAccount(tenantId: string) {
    const account = await this.prisma.emailAccount.findFirst({
      where: { tenantId, isActive: true, isDefault: true },
      select: {
        id: true,
        provider: true,
        emailAddress: true,
        profileName: true,
        accessToken: true,
        refreshToken: true,
        smtpHost: true,
        smtpPort: true,
        password: true,
        requireSsl: true,
      },
    });
    if (!account)
      throw new BadRequestException(
        'Connect a mailbox and select it as the default sender first.',
      );
    this.email(account.emailAddress, 'Mailbox sender');
    if (account.provider === 'microsoft') {
      if (!account.accessToken)
        throw new BadRequestException('Reconnect your Microsoft mailbox.');
    } else if (account.provider === 'smtp') {
      if (!account.smtpHost || !account.password)
        throw new BadRequestException(
          'Complete the default mailbox SMTP settings first.',
        );
    } else
      throw new BadRequestException(
        'Choose a Microsoft 365 or SMTP default mailbox.',
      );
    return account;
  }

  private domain(value: string): string {
    const clean = typeof value === 'string' ? value.trim().toLowerCase() : '';
    if (
      clean.length > 253 ||
      !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(clean)
    ) {
      throw new BadRequestException(
        'Enter a valid email domain without a URL or path.',
      );
    }
    return clean;
  }

  private ownership(tenantId: string, domain: string): EmailDnsRecord {
    const token = createHash('sha256')
      .update(`enfysync-domain:${tenantId}:${domain}`)
      .digest('hex');
    return {
      type: 'TXT',
      host: `_enfysync-verification.${domain}`,
      value: `enfysync-tenant=${token}`,
      purpose: 'Workspace domain ownership',
      status: 'pending',
    };
  }

  private async ownsDomain(tenantId: string, domain: string) {
    const record = this.ownership(tenantId, domain);
    try {
      return (await resolveTxt(record.host)).some(
        (parts) => parts.join('') === record.value,
      );
    } catch {
      return false;
    }
  }

  private async domainConfiguration(domain: string): Promise<BrevoDomain> {
    const options = this.brevoOptions();
    try {
      return (
        await this.brevo.get<BrevoDomain>(
          `/senders/domains/${encodeURIComponent(domain)}`,
          options,
        )
      ).data;
    } catch (error) {
      this.failure('brevo-domain', error);
    }
  }

  private records(
    tenantId: string,
    domain: string,
    config: BrevoDomain,
  ): EmailDnsRecord[] {
    return [
      this.ownership(tenantId, domain),
      ...Object.entries(config.dns_records ?? {}).map(([purpose, record]) => {
        const host = record.host_name.replace(/\.$/, '');
        return {
          type: record.type,
          host: !host
            ? domain
            : host === domain || host.endsWith(`.${domain}`)
              ? host
              : `${host}.${domain}`,
          value: record.value,
          purpose: purpose.replace(/_/g, ' '),
          status: record.status ? ('verified' as const) : ('pending' as const),
        };
      }),
    ];
  }

  async settings(tenantId: string): Promise<TenantEmailSettings> {
    const tenant = await this.tenant(tenantId);
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
      },
    });
    const connectedAccounts = accounts.map(({ emailAddress, ...account }) => ({
      ...account,
      email: emailAddress,
    }));
    const mode = this.mode(tenant.emailDispatchMode);
    let configurationError: string | null = null;
    let dnsRecords: EmailDnsRecord[] = [];
    let sender = process.env.SYSTEM_EMAIL_FROM?.trim() || '';
    try {
      sender = this.platformSender().email;
      this.brevoOptions();
    } catch {
      configurationError =
        'Platform sender or Brevo API key is not configured.';
    }
    if (tenant.customEmailDomain) {
      try {
        const config = await this.domainConfiguration(tenant.customEmailDomain);
        const owned = await this.ownsDomain(tenantId, tenant.customEmailDomain);
        dnsRecords = this.records(tenantId, tenant.customEmailDomain, config);
        dnsRecords[0].status = owned ? 'verified' : 'pending';
        if (
          mode === 'CUSTOM_DOMAIN' &&
          (!owned || !config.verified || !config.authenticated)
        )
          configurationError =
            'Custom domain ownership or email authentication is not verified.';
      } catch {
        if (mode === 'CUSTOM_DOMAIN')
          configurationError =
            'Custom-domain DNS settings are unavailable. Contact your administrator.';
      }
    }
    try {
      if (mode === 'DIRECT_ACCOUNT') {
        await this.defaultAccount(tenantId);
        configurationError = null;
      }
      if (mode === 'CUSTOM_DOMAIN' && !tenant.customEmailDomainVerified)
        configurationError = 'Verify your custom domain before sending.';
    } catch (error) {
      configurationError =
        error instanceof BadRequestException
          ? error.message
          : 'Sender configuration is incomplete.';
    }
    return {
      dispatchMode: mode,
      defaultSubdomainSender: sender,
      customDomain: tenant.customEmailDomain ?? '',
      customDomainVerified: !!tenant.customEmailDomainVerified,
      dnsRecords,
      connectedAccounts,
      defaultAccount: connectedAccounts.find((a) => a.isDefault) ?? null,
      readiness: configurationError ? 'incomplete' : 'ready',
      configurationError,
    };
  }

  async setMode(tenantId: string, value: string) {
    if (
      !['DEFAULT_SUBDOMAIN', 'DIRECT_ACCOUNT', 'CUSTOM_DOMAIN'].includes(value)
    )
      throw new BadRequestException('Invalid email strategy.');
    const tenant = await this.tenant(tenantId);
    if (value === 'DIRECT_ACCOUNT') await this.defaultAccount(tenantId);
    if (value === 'CUSTOM_DOMAIN') {
      if (!tenant.customEmailDomain || !tenant.customEmailDomainVerified)
        throw new BadRequestException(
          'Save and verify your custom domain first.',
        );
      await this.requireDomain(tenantId, tenant.customEmailDomain);
    }
    await this.prisma.tenant.update({
      where: { id: tenantId },
      data: { emailDispatchMode: value },
    });
    return { success: true, mode: value as EmailDispatchMode };
  }

  async saveDomain(tenantId: string, value: string) {
    const tenant = await this.tenant(tenantId);
    const domain = this.domain(value);
    if (domain === this.platformSender().email.split('@')[1])
      throw new BadRequestException(
        'Use the platform default for the platform sending domain.',
      );
    const other = await this.prisma.tenant.findFirst({
      where: { customEmailDomain: domain, id: { not: tenantId } },
      select: { id: true },
    });
    if (other)
      throw new BadRequestException(
        'This domain is already assigned to another workspace.',
      );
    // Do not take over an existing Brevo domain: tenant-specific DNS proof is also required.
    const options = this.brevoOptions();
    try {
      await this.brevo.get(
        `/senders/domains/${encodeURIComponent(domain)}`,
        options,
      );
    } catch (error) {
      if (axios.isAxiosError(error) && error.response?.status === 404) {
        try {
          await this.brevo.post('/senders/domains', { name: domain }, options);
        } catch (createError) {
          this.failure('brevo-domain', createError);
        }
      } else this.failure('brevo-domain', error);
    }
    await this.prisma.tenant.update({
      where: { id: tenantId },
      data: {
        customEmailDomain: domain,
        customEmailDomainVerified:
          tenant.customEmailDomain === domain &&
          tenant.customEmailDomainVerified,
      },
    });
    return { success: true, customDomain: domain };
  }

  private async requireDomain(tenantId: string, domain: string) {
    if (!(await this.ownsDomain(tenantId, domain)))
      throw new BadRequestException(
        'Workspace domain ownership TXT record is not verified.',
      );
    const config = await this.domainConfiguration(domain);
    if (!config.verified || !config.authenticated)
      throw new BadRequestException(
        'The sending domain is not verified and authenticated in Brevo.',
      );
    return config;
  }

  async verifyDomain(tenantId: string) {
    const tenant = await this.tenant(tenantId);
    if (!tenant.customEmailDomain)
      throw new BadRequestException('Save a custom email domain first.');
    const domain = tenant.customEmailDomain;
    if (!(await this.ownsDomain(tenantId, domain)))
      throw new BadRequestException(
        'Add the workspace ownership TXT record before verifying.',
      );
    try {
      await this.brevo.put(
        `/senders/domains/${encodeURIComponent(domain)}/authenticate`,
        {},
        this.brevoOptions(),
      );
    } catch (error) {
      this.failure('brevo-domain', error);
    }
    const config = await this.domainConfiguration(domain);
    const verified = config.verified === true && config.authenticated === true;
    // Conditional update prevents an in-flight check from verifying a newly changed domain.
    const update = await this.prisma.tenant.updateMany({
      where: { id: tenantId, customEmailDomain: domain },
      data: { customEmailDomainVerified: verified },
    });
    if (update.count !== 1)
      throw new BadRequestException(
        'Domain changed during verification. Try again.',
      );
    return {
      success: true,
      verified,
      message: verified
        ? 'Domain ownership and Brevo authentication verified.'
        : 'DNS verification is pending. Check the required records and try again.',
    };
  }

  async send(request: SystemEmailRequest): Promise<EmailDispatchResult> {
    const tenant = await this.tenant(request.tenantId);
    this.email(request.to, 'Recipient');
    if (request.replyTo) this.email(request.replyTo, 'Reply-To');
    const mode = this.mode(tenant.emailDispatchMode);
    if (mode === 'DIRECT_ACCOUNT') {
      const account = await this.defaultAccount(request.tenantId);
      request = applySystemEmailReplyPolicy(request, account.emailAddress);
      try {
        if (account.provider === 'microsoft') {
          const payload = {
            message: {
              subject: request.subject,
              body: { contentType: 'HTML', content: request.html },
              toRecipients: [{ emailAddress: { address: request.to } }],
              ...(request.replyTo
                ? { replyTo: [{ emailAddress: { address: request.replyTo } }] }
                : {}),
            },
            saveToSentItems: true,
          };
          const post = (token: string) =>
            axios.post(
              'https://graph.microsoft.com/v1.0/me/sendMail',
              payload,
              { timeout: 15000, headers: { Authorization: `Bearer ${token}` } },
            );
          try {
            await post(account.accessToken!);
          } catch (error) {
            if (
              !axios.isAxiosError(error) ||
              error.response?.status !== 401 ||
              !account.refreshToken
            )
              throw error;
            const clientId = process.env.MICROSOFT_CLIENT_ID;
            const clientSecret = process.env.MICROSOFT_CLIENT_SECRET;
            if (!clientId || !clientSecret)
              throw new Error('Microsoft OAuth configuration missing');
            const response = await axios.post<{
              access_token: string;
              refresh_token?: string;
            }>(
              'https://login.microsoftonline.com/common/oauth2/v2.0/token',
              new URLSearchParams({
                client_id: clientId,
                client_secret: clientSecret,
                refresh_token: account.refreshToken,
                grant_type: 'refresh_token',
              }),
              { timeout: 15000 },
            );
            if (!response.data.access_token)
              throw new Error('Microsoft refresh rejected');
            await this.prisma.emailAccount.updateMany({
              where: { id: account.id, tenantId: request.tenantId },
              data: {
                accessToken: response.data.access_token,
                refreshToken:
                  response.data.refresh_token || account.refreshToken,
              },
            });
            await post(response.data.access_token);
          }
          return {
            success: true,
            status: 'accepted',
            provider: 'microsoft',
            from: account.emailAddress,
          };
        }
        const port = account.smtpPort || 587;
        const transport = nodemailer.createTransport({
          host: account.smtpHost!,
          port,
          secure: port === 465,
          requireTLS: true,
          connectionTimeout: 15000,
          socketTimeout: 15000,
          auth: { user: account.emailAddress, pass: account.password! },
        });
        const result = await transport.sendMail({
          from: {
            name: account.profileName || tenant.name,
            address: account.emailAddress,
          },
          to: request.to,
          subject: request.subject,
          html: request.html,
          ...(request.text ? { text: request.text } : {}),
          ...(request.replyTo ? { replyTo: request.replyTo } : {}),
        });
        if (!result.accepted?.length || result.rejected?.length)
          throw new Error('SMTP recipient rejected');
        return {
          success: true,
          status: 'accepted',
          provider: 'smtp',
          from: account.emailAddress,
          messageId: result.messageId,
        };
      } catch (error) {
        this.failure(account.provider, error);
      }
    }

    let sender: { name: string; email: string };
    if (mode === 'CUSTOM_DOMAIN') {
      if (!tenant.customEmailDomain || !tenant.customEmailDomainVerified)
        throw new BadRequestException(
          'Verify your custom domain before sending.',
        );
      await this.requireDomain(request.tenantId, tenant.customEmailDomain);
      sender = {
        name: tenant.name,
        email: this.email(
          `no-reply@${tenant.customEmailDomain}`,
          'Custom domain sender',
        ),
      };
    } else sender = this.platformSender();
    request = applySystemEmailReplyPolicy(request, sender.email);
    const options = this.brevoOptions();
    const payload: BrevoMessage = {
      sender,
      to: [{ email: request.to }],
      subject: request.subject,
      htmlContent: request.html,
      ...(request.text ? { textContent: request.text } : {}),
      ...(request.replyTo ? { replyTo: { email: request.replyTo } } : {}),
    };
    try {
      const response = await this.brevo.post<{ messageId: string }>(
        '/smtp/email',
        payload,
        options,
      );
      if (!response.data.messageId)
        throw new Error('Missing provider acceptance');
      return {
        success: true,
        status: 'accepted',
        provider: mode === 'CUSTOM_DOMAIN' ? 'custom_domain_brevo' : 'brevo',
        from: sender.email,
        messageId: response.data.messageId,
      };
    } catch (error) {
      this.failure('brevo', error);
    }
  }
}
