const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'src/auth/services/auth-tenant.service.ts');
let content = fs.readFileSync(filePath, 'utf8');

const replacement = `
    const tenantRes = await this.authQuery.query('SELECT name, site_title, logo_url FROM tenants WHERE id = $1 LIMIT 1', [tenantId]).catch(() => ({ rows: [] }));
    const tenantData = tenantRes.rows.length > 0 ? tenantRes.rows[0] : null;

    const result = await this.authQuery.query('SELECT * FROM tenant_auth_settings WHERE tenant_id = $1 LIMIT 1', [tenantId]).catch(() => ({ rows: [] }));
    if (result.rows.length === 0) {
      return {
        tenantId, allowPasswordLogin: true, allowMicrosoftSso: true, allowGoogleSso: true,
        enforceSsoOnly: false, requireMfa: false, allowPersonalEmails: true, allowedEmailDomains: [],
        microsoftTenantId: null, microsoftClientId: null,
        name: tenantData?.name, siteTitle: tenantData?.site_title, logoUrl: tenantData?.logo_url,
      };
    }
    const row = result.rows[0];
    return {
      tenantId: row.tenant_id,
      allowPasswordLogin: row.allow_password_login ?? true,
      allowMicrosoftSso: row.allow_microsoft_sso ?? true,
      allowGoogleSso: row.allow_google_sso ?? true,
      enforceSsoOnly: row.enforce_sso_only ?? false,
      requireMfa: row.require_mfa ?? false,
      allowPersonalEmails: row.allow_personal_emails ?? true,
      allowedEmailDomains: row.allowed_email_domains || [],
      microsoftTenantId: row.microsoft_tenant_id || null,
      microsoftClientId: row.microsoft_client_id || null,
      name: tenantData?.name, siteTitle: tenantData?.site_title, logoUrl: tenantData?.logo_url,
    };
`;

const startIndex = content.indexOf(`const result = await this.authQuery.query('SELECT * FROM tenant_auth_settings`);
const endIndex = content.indexOf(`  async updateTenantAuthPolicy(tenantId: string, dto: any) {`);

if (startIndex !== -1 && endIndex !== -1) {
  content = content.slice(0, startIndex) + replacement.trim() + '\n  }\n\n' + content.slice(endIndex);
  fs.writeFileSync(filePath, content, 'utf8');
  console.log('Successfully patched auth-tenant.service.ts');
} else {
  console.log('Target string not found');
}
