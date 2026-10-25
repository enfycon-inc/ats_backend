/** Canonical tenant branding contract. Sync with scripts/sync-tenant-branding.cjs. */
export interface TenantBranding {
  name?: string;
  siteTitle?: string;
  logoUrl?: string | null;
  loginLogoUrl?: string | null;
  compactLogoUrl?: string | null;
}
export interface TenantBrandingUpdate {
  name?: string;
  siteTitle?: string;
  logoUrl?: string;
  loginLogoUrl?: string;
  compactLogoUrl?: string;
}

export interface TenantBrandingSettingsResponse {
  name: string;
  site_title: string | null;
  logo_url: string | null;
  login_logo_url: string | null;
  compact_logo_url: string | null;
}
