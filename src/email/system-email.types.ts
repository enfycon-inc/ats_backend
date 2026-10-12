export type EmailDispatchMode =
  'DEFAULT_SUBDOMAIN' | 'DIRECT_ACCOUNT' | 'CUSTOM_DOMAIN';
export interface EmailNotification {
  status: 'accepted' | 'failed' | 'disabled';
  message?: string;
}
export interface SystemEmailRequest {
  tenantId: string;
  to: string;
  subject: string;
  html: string;
  text?: string;
  systemGenerated?: boolean;
  replyTo?: string;
  category?: string;
}
export interface EmailDispatchResult {
  success: true;
  provider: 'brevo' | 'microsoft' | 'smtp' | 'custom_domain_brevo';
  from: string;
  status: 'accepted';
  messageId?: string;
}
export interface EmailDnsRecord {
  type: string;
  host: string;
  value: string;
  purpose: string;
  status: 'verified' | 'pending';
}
export interface TenantEmailAccount {
  id: string;
  provider: string;
  email: string;
  profileName: string | null;
  isDefault: boolean;
  isActive: boolean;
}
export interface TenantEmailSettings {
  dispatchMode: EmailDispatchMode;
  defaultSubdomainSender: string; // Legacy API field retained for existing clients.
  customDomain: string;
  customDomainVerified: boolean;
  dnsRecords: EmailDnsRecord[];
  connectedAccounts: TenantEmailAccount[];
  defaultAccount: TenantEmailAccount | null;
  readiness: 'ready' | 'incomplete';
  configurationError: string | null;
}
