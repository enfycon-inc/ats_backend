import {
  Injectable,
  Logger,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import * as dns from 'dns/promises';
import { AuthQueryService } from './auth-query.service';
import { AuthRbacService } from './auth-rbac.service';
import { AuthKeycloakService } from './auth-keycloak.service';

const DEFAULT_TENANT_ID = process.env.DEFAULT_TENANT_ID || 'd3b07384-d113-49c3-a555-9ee75c13ca33';

/**
 * AuthTenantService — manages all tenant lifecycle operations:
 * tenant registration, approval, settings, domains, auth policy.
 */
@Injectable()
export class AuthTenantService {
  private readonly logger = new Logger(AuthTenantService.name);

  constructor(
    private readonly authQuery: AuthQueryService,
    private readonly rbacService: AuthRbacService,
    private readonly keycloakService: AuthKeycloakService,
  ) {}

  async registerTenant(dto: {
    companyName: string;
    email: string;
    fullName: string;
    password: string;
    subdomain: string;
  }) {
    const companyName = (dto.companyName || '').trim();
    const email = (dto.email || '').trim().toLowerCase();
    const fullName = (dto.fullName || '').trim();
    const password = dto.password;

    if (!companyName || !email || !fullName || !password) {
      throw new BadRequestException('All fields (company name, email, full name, password) are required.');
    }
    if (companyName.length < 2) throw new BadRequestException('Company name must be at least 2 characters.');
    if (fullName.length < 2) throw new BadRequestException('Full name must be at least 2 characters.');
    const emailParts = email.split('@');
    if (emailParts.length !== 2 || !emailParts[0] || !emailParts[1]) {
      throw new BadRequestException('Invalid email address format.');
    }
    if (password.length < 8) throw new BadRequestException('Password must be at least 8 characters.');

    this.logger.log(`New tenant registration: ${companyName} [${dto.subdomain}] by ${email}`);

    if (!dto.subdomain || !/^[a-z0-9-]+$/.test(dto.subdomain)) {
      throw new BadRequestException('Subdomain must contain only lowercase letters, numbers, and hyphens.');
    }

    const subdomainExists = await this.authQuery.query(
      'SELECT id FROM tenants WHERE domain = $1 UNION SELECT tenant_id as id FROM tenant_domains WHERE domain_name = $1 LIMIT 1',
      [dto.subdomain],
    );
    if (subdomainExists.rows.length > 0) {
      throw new ConflictException(`Subdomain "${dto.subdomain}" is already taken. Please choose another.`);
    }

    const emailExists = await this.authQuery.query('SELECT id FROM users WHERE email = $1 LIMIT 1', [email]);
    if (emailExists.rows.length > 0) throw new ConflictException(`Email "${email}" is already registered.`);

    let basePrefix = companyName.replace(/[^a-zA-Z0-9]/g, '').substring(0, 4).toUpperCase();
    if (basePrefix.length < 2) basePrefix = 'COMP';
    let prefixCode = basePrefix;
    let counter = 1;
    while (true) {
      const prefixExists = await this.authQuery.query('SELECT id FROM tenants WHERE prefix_code = $1 LIMIT 1', [prefixCode]);
      if (prefixExists.rows.length === 0) break;
      prefixCode = `${basePrefix.substring(0, 3)}${counter}`;
      counter++;
    }

    const tenantResult = await this.authQuery.query(
      `INSERT INTO tenants (name, domain, status, default_market, prefix_code)
       VALUES ($1, $2, 'PENDING', 'US', $3)
       RETURNING id, name, domain, status, prefix_code`,
      [companyName, dto.subdomain, prefixCode],
    );
    const tenant: any = tenantResult.rows[0];

    await this.authQuery.query(
      `INSERT INTO tenant_domains (tenant_id, domain_name, is_primary) VALUES ($1, $2, TRUE)`,
      [tenant.id, dto.subdomain]
    );

    const roleMap = await this.rbacService.seedTenantRoles(tenant.id);
    const adminRoleId = roleMap['ADMIN'];

    const firstName = fullName.split(/\s+/)[0] || '';
    const lastName = fullName.split(/\s+/).slice(1).join(' ') || '';
    const assignedRoleIds = adminRoleId ? [adminRoleId] : [];
    const userResult = await this.authQuery.query(
      `INSERT INTO users (tenant_id, email, first_name, last_name, full_name, is_active, is_approved, role_id, assigned_role_ids)
       VALUES ($1, $2, $3, $4, $5, true, false, $6, $7::uuid[])
       RETURNING id, email, first_name, last_name, full_name, tenant_id, created_at, role_id`,
      [tenant.id, email, firstName, lastName, fullName, adminRoleId, assignedRoleIds],
    );
    const user: any = userResult.rows[0];

    await this.keycloakService.provisionUserInKeycloak({ email: user.email, password, fullName: user.full_name, tenantId: tenant.id });

    const baseDomain = process.env.BASE_DOMAIN || 'enfyjobs.com';
    return {
      message: 'Company registered successfully! Your account is pending platform administrator approval.',
      tenant: { id: tenant.id, name: tenant.name, subdomain: tenant.domain, workspaceUrl: `${tenant.domain}.${baseDomain}`, status: tenant.status },
      user: { id: user.id, email: user.email, firstName: user.first_name, lastName: user.last_name, fullName: user.full_name, roles: ['ADMIN'], tenantId: user.tenant_id, createdAt: user.created_at },
    };
  }

  async listPendingApprovals() {
    const result = await this.authQuery.query(
      `SELECT u.id, u.email, u.first_name, u.last_name, u.full_name, u.created_at, u.tenant_id, 
              COALESCE(cr.name, 'Staff') as role_name,
              t.name as tenant_name, t.default_market, t.domain as tenant_domain
       FROM users u
       LEFT JOIN tenants t ON u.tenant_id = t.id
       LEFT JOIN custom_roles cr ON u.role_id = cr.id
       WHERE u.is_approved = false
       ORDER BY u.created_at DESC`
    );
    return result.rows.map((row: any) => ({
      id: row.id,
      email: row.email,
      firstName: row.first_name || '',
      lastName: row.last_name || '',
      fullName: row.full_name,
      roles: [row.role_name],
      createdAt: row.created_at,
      tenantId: row.tenant_id,
      tenantName: row.tenant_name || 'N/A',
      defaultMarket: row.default_market || 'US',
      tenantSubdomain: row.tenant_domain || '',
    }));
  }

  async approveUser(userId: string, market: string, subdomain?: string, userLimit?: number, maxBranches?: number) {
    const userResult = await this.authQuery.query('SELECT tenant_id FROM users WHERE id = $1 LIMIT 1', [userId]);
    if (userResult.rows.length === 0) throw new NotFoundException(`User with ID ${userId} was not found.`);
    const tenantId = (userResult.rows[0] as any).tenant_id;

    await this.authQuery.query('UPDATE users SET is_approved = true, is_active = true WHERE id = $1', [userId]);
    await this.authQuery.query("UPDATE tenants SET status = 'ACTIVE' WHERE id = $1", [tenantId]);

    if (market && (market === 'US' || market === 'IN')) {
      await this.authQuery.query('UPDATE tenants SET default_market = $1 WHERE id = $2', [market, tenantId]);
    }
    if (userLimit && userLimit > 0) {
      await this.authQuery.query('UPDATE tenants SET user_limit = $1 WHERE id = $2', [userLimit, tenantId]);
    }
    if (maxBranches && maxBranches > 0) {
      await this.authQuery.query('UPDATE tenants SET max_branches = $1 WHERE id = $2', [maxBranches, tenantId]);
    }
    if (subdomain && subdomain.trim()) {
      await this.updateTenantSubdomain(tenantId, subdomain.trim());
    }

    return { message: 'User approved and tenant activated successfully.', tenantId };
  }

  async createManualTenant(dto: {
    companyName: string;
    subdomain: string;
    adminFullName: string;
    adminEmail: string;
    adminPassword?: string;
    userLimit?: number;
    maxBranches?: number;
    defaultMarket?: string;
  }) {
    const companyName = dto.companyName.trim();
    const email = dto.adminEmail.trim().toLowerCase();
    if (!dto.adminPassword || dto.adminPassword.length < 8) {
      throw new BadRequestException('Admin password is required and must be at least 8 characters.');
    }
    const password = dto.adminPassword;
    const userLimit = dto.userLimit || 20;
    const maxBranches = dto.maxBranches || 5;
    const market = dto.defaultMarket || 'US';

    if (!dto.subdomain || !/^[a-z0-9-]+$/.test(dto.subdomain)) {
      throw new BadRequestException('Subdomain must contain only lowercase letters, numbers, and hyphens.');
    }

    const subdomainExists = await this.authQuery.query(
      'SELECT id FROM tenants WHERE domain = $1 UNION SELECT tenant_id as id FROM tenant_domains WHERE domain_name = $1 LIMIT 1',
      [dto.subdomain]
    );
    if (subdomainExists.rows.length > 0) throw new ConflictException(`Subdomain "${dto.subdomain}" is already taken.`);

    const emailExists = await this.authQuery.query('SELECT id FROM users WHERE email = $1 LIMIT 1', [email]);
    if (emailExists.rows.length > 0) throw new ConflictException(`Email "${email}" is already registered.`);

    let basePrefix = companyName.replace(/[^a-zA-Z0-9]/g, '').substring(0, 4).toUpperCase();
    if (basePrefix.length < 2) basePrefix = 'COMP';
    let prefixCode = basePrefix;
    let counter = 1;
    while (true) {
      const prefixExists = await this.authQuery.query('SELECT id FROM tenants WHERE prefix_code = $1 LIMIT 1', [prefixCode]);
      if (prefixExists.rows.length === 0) break;
      prefixCode = `${basePrefix.substring(0, 3)}${counter}`;
      counter++;
    }

    const tenantResult = await this.authQuery.query(
      `INSERT INTO tenants (name, domain, status, default_market, user_limit, max_branches, prefix_code)
       VALUES ($1, $2, 'ACTIVE', $3, $4, $5, $6)
       RETURNING id, name, domain, status, user_limit, max_branches, default_market, prefix_code`,
      [companyName, dto.subdomain, market, userLimit, maxBranches, prefixCode]
    );
    const tenant: any = tenantResult.rows[0];

    await this.authQuery.query(`INSERT INTO tenant_domains (tenant_id, domain_name, is_primary) VALUES ($1, $2, TRUE)`, [tenant.id, dto.subdomain]);

    const roleMap = await this.rbacService.seedTenantRoles(tenant.id);
    const adminRoleId = roleMap['ADMIN'];

    const adminFullName = dto.adminFullName.trim();
    const firstName = adminFullName.split(/\s+/)[0] || '';
    const lastName = adminFullName.split(/\s+/).slice(1).join(' ') || '';
    const assignedRoleIds = adminRoleId ? [adminRoleId] : [];
    const userResult = await this.authQuery.query(
      `INSERT INTO users (tenant_id, email, first_name, last_name, full_name, is_active, is_approved, role_id, assigned_role_ids)
       VALUES ($1, $2, $3, $4, $5, true, true, $6, $7::uuid[])
       RETURNING id, email, first_name, last_name, full_name, tenant_id, created_at, role_id`,
      [tenant.id, email, firstName, lastName, adminFullName, adminRoleId, assignedRoleIds]
    );
    const user: any = userResult.rows[0];

    await this.keycloakService.provisionUserInKeycloak({ email: user.email, password, fullName: user.full_name, tenantId: tenant.id });

    return {
      message: `Tenant "${companyName}" created and activated successfully!`,
      tenant,
      adminUser: { id: user.id, email: user.email, firstName: user.first_name, lastName: user.last_name, fullName: user.full_name, temporaryPassword: password },
    };
  }

  async listTenants() {
    const result = await this.authQuery.query(
      `SELECT id, name, domain, status, default_market as "defaultMarket", user_limit as "userLimit", created_at as "createdAt"
       FROM tenants ORDER BY name ASC`
    );
    return result.rows;
  }

  async getTenantDetails(tenantId: string) {
    const tenantRes = await this.authQuery.query(
      `SELECT id, name, domain, status, default_market as "defaultMarket", user_limit as "userLimit", created_at as "createdAt"
       FROM tenants WHERE id = $1 LIMIT 1`,
      [tenantId]
    );
    if (tenantRes.rows.length === 0) throw new NotFoundException('Tenant not found');
    const tenant = tenantRes.rows[0];

    const usersRes = await this.authQuery.query(
      `SELECT u.id, u.email, u.first_name as "firstName", u.last_name as "lastName", u.full_name as "fullName", u.is_active as "isActive", u.is_approved as "isApproved", u.created_at as "createdAt", cr.name as "roleName", sr.system_key as "systemRole"
         FROM users u
         LEFT JOIN custom_roles cr ON u.role_id = cr.id
         LEFT JOIN system_roles sr ON cr.system_role_id = sr.id
         WHERE u.tenant_id = $1
       ORDER BY u.created_at DESC`,
      [tenantId]
    );

    const statsRes = await Promise.all([
      this.authQuery.query(`SELECT COUNT(*) FROM jobs WHERE tenant_id = $1`, [tenantId]),
      this.authQuery.query(`SELECT COUNT(*) FROM candidates WHERE tenant_id = $1`, [tenantId]),
      this.authQuery.query(`SELECT COUNT(*) FROM recruiter_submissions WHERE tenant_id = $1`, [tenantId]),
    ]);

    return {
      tenant,
      users: usersRes.rows,
      stats: {
        totalJobs: parseInt((statsRes[0].rows[0] as any).count, 10),
        totalCandidates: parseInt((statsRes[1].rows[0] as any).count, 10),
        totalSubmissions: parseInt((statsRes[2].rows[0] as any).count, 10),
      }
    };
  }

  async updateTenantStatus(tenantId: string, status: string) {
    let upperStatus = status.toUpperCase().trim();
    if (upperStatus === 'SUSPENDED') upperStatus = 'INACTIVE';
    if (upperStatus !== 'ACTIVE' && upperStatus !== 'INACTIVE' && upperStatus !== 'PENDING') {
      throw new BadRequestException('Invalid tenant status. Must be ACTIVE, INACTIVE, or PENDING.');
    }
    await this.authQuery.query('UPDATE tenants SET status = $1, updated_at = NOW() WHERE id = $2', [upperStatus, tenantId]);
    return { message: 'Tenant status updated successfully.', status: upperStatus };
  }

  async updateTenantUserLimit(tenantId: string, limit: number) {
    if (isNaN(limit) || limit < 1) throw new BadRequestException('Invalid user limit. Must be a positive integer.');
    await this.authQuery.query('UPDATE tenants SET user_limit = $1, updated_at = NOW() WHERE id = $2', [limit, tenantId]);
    return { message: 'Tenant user limit updated successfully.', userLimit: limit };
  }

  async updateTenantBranchLimit(tenantId: string, limit: number) {
    if (isNaN(limit) || limit < 1) throw new BadRequestException('Invalid branch limit. Must be a positive integer.');
    await this.authQuery.query('UPDATE tenants SET max_branches = $1, updated_at = NOW() WHERE id = $2', [limit, tenantId]);
    return { message: 'Tenant max branches limit updated successfully.', maxBranches: limit };
  }

  async updateTenantMarket(tenantId: string, market: string) {
    if (market !== 'US' && market !== 'IN') throw new BadRequestException('Invalid market type. Must be US or IN.');
    await this.authQuery.query('UPDATE tenants SET default_market = $1, updated_at = NOW() WHERE id = $2', [market, tenantId]);
    return { message: 'Tenant staffing market updated successfully.', market };
  }

  async updateTenantSubdomain(tenantId: string, subdomain: string) {
    if (!subdomain || !/^[a-z0-9-]+$/.test(subdomain)) {
      throw new BadRequestException('Subdomain must contain alphanumeric characters and hyphens only.');
    }
    const exists = await this.authQuery.query(
      'SELECT id FROM tenant_domains WHERE domain_name = $1 AND tenant_id <> $2 LIMIT 1',
      [subdomain, tenantId]
    );
    if (exists.rows.length > 0) throw new ConflictException('Subdomain is already taken by another company.');
    await this.authQuery.query('UPDATE tenants SET domain = $1, updated_at = NOW() WHERE id = $2', [subdomain, tenantId]);
    await this.authQuery.query('UPDATE tenant_domains SET domain_name = $1 WHERE tenant_id = $2 AND is_primary = TRUE', [subdomain, tenantId]);
    return { message: 'Subdomain updated successfully.', subdomain };
  }

  async getTenantDomains(tenantId: string) {
    const res = await this.authQuery.query(
      `SELECT id, domain_name, is_primary, 
              CASE WHEN is_primary = TRUE THEN 'VERIFIED' ELSE COALESCE(verification_status, 'PENDING') END as verification_status, 
              CASE WHEN is_primary = TRUE THEN 'ACTIVE' ELSE COALESCE(ssl_status, 'PENDING') END as ssl_status, 
              created_at 
       FROM tenant_domains 
       WHERE tenant_id = $1 
       ORDER BY created_at ASC`,
      [tenantId]
    );
    return res.rows;
  }

  async addTenantDomain(tenantId: string, domainName: string) {
    const normalizedDomain = domainName.toLowerCase().trim();
    if (!normalizedDomain || !/^[a-z0-9.-]+$/.test(normalizedDomain) || normalizedDomain.includes('..')) {
      throw new BadRequestException('Invalid domain name format. Do not include http://, https://, or paths.');
    }
    const exists = await this.authQuery.query('SELECT id FROM tenant_domains WHERE domain_name = $1 LIMIT 1', [normalizedDomain]);
    if (exists.rows.length > 0) throw new ConflictException('Domain name is already registered by another workspace.');
    const res = await this.authQuery.query(
      `INSERT INTO tenant_domains (tenant_id, domain_name, is_primary, verification_status, ssl_status)
       VALUES ($1, $2, FALSE, 'PENDING', 'PENDING')
       RETURNING id, domain_name, is_primary, verification_status, ssl_status, created_at`,
      [tenantId, normalizedDomain]
    );
    return res.rows[0];
  }

  async deleteTenantDomain(tenantId: string, domainId: string) {
    const check = await this.authQuery.query(
      'SELECT is_primary FROM tenant_domains WHERE id = $1 AND tenant_id = $2 LIMIT 1',
      [domainId, tenantId]
    );
    if (check.rows.length === 0) throw new NotFoundException('Domain mapping not found.');
    if ((check.rows[0] as any).is_primary) throw new BadRequestException('Cannot delete the primary subdomain of the company workspace.');
    await this.authQuery.query('DELETE FROM tenant_domains WHERE id = $1 AND tenant_id = $2', [domainId, tenantId]);
    return { success: true, message: 'Domain deleted successfully.' };
  }

  async isDomainRegistered(domainName: string): Promise<boolean> {
    const normalized = domainName.toLowerCase().trim();
    if (!normalized) return false;
    try {
      const res = await this.authQuery.query(
        `SELECT 1 FROM tenant_domains WHERE domain_name = $1
         UNION
         SELECT 1 FROM tenants WHERE LOWER(domain) = $1 OR LOWER(domain || '.enfyjobs.com') = $1
         LIMIT 1`,
        [normalized]
      );
      return (res.rows.length > 0);
    } catch {
      return false;
    }
  }

  async updateTenantSettings(tenantId: string, settings: {
    podSystemEnabled?: boolean;
    candidatePoolMode?: string;
    jobAssignmentMode?: string;
    jobAssignmentOptions?: any;
      jobCodePattern?: string;
      enforceJobCodePattern?: boolean;
    siteTitle?: string;
    logoUrl?: string;
    name?: string;
  }) {
    this.logger.log(`Updating tenant settings for ${tenantId}: ${JSON.stringify(settings)}`);

    const fields: string[] = [];
    const params: any[] = [tenantId];
    let paramIndex = 2;

    if (settings.podSystemEnabled !== undefined) { fields.push(`pod_system_enabled = $${paramIndex}`); params.push(settings.podSystemEnabled); paramIndex++; }

    if (settings.candidatePoolMode !== undefined) {
      const mode = settings.candidatePoolMode.trim().toUpperCase();
      if (!['COMBINED_MARKET', 'STRICT_BRANCH', 'ALL_BRANCHES'].includes(mode)) {
        throw new BadRequestException('Invalid candidate pool mode. Must be COMBINED_MARKET, STRICT_BRANCH, or ALL_BRANCHES.');
      }
      fields.push(`candidate_pool_mode = $${paramIndex}`); params.push(mode); paramIndex++;
    }

    if (settings.jobAssignmentMode !== undefined) {
      const mode = settings.jobAssignmentMode.trim().toUpperCase();
      if (!['AUTO', 'ADMIN_CONTROLLED'].includes(mode)) {
        throw new BadRequestException('Invalid job assignment mode. Must be AUTO or ADMIN_CONTROLLED.');
      }
      fields.push(`job_assignment_mode = $${paramIndex}`); params.push(mode); paramIndex++;
    }

    if (settings.jobAssignmentOptions !== undefined) {
      fields.push(`job_assignment_options = $${paramIndex}`);
      params.push(typeof settings.jobAssignmentOptions === 'string' ? settings.jobAssignmentOptions : JSON.stringify(settings.jobAssignmentOptions));
      paramIndex++;
    }

    if (settings.jobCodePattern !== undefined) { fields.push(`job_code_pattern = $${paramIndex}`); params.push(settings.jobCodePattern); paramIndex++; }
    if (settings.enforceJobCodePattern !== undefined) { fields.push(`enforce_job_code_pattern = $${paramIndex}`); params.push(settings.enforceJobCodePattern); paramIndex++; }

        if (settings.siteTitle !== undefined) { fields.push(`site_title = $${paramIndex}`); params.push(settings.siteTitle); paramIndex++; }
    if (settings.logoUrl !== undefined) { fields.push(`logo_url = $${paramIndex}`); params.push(settings.logoUrl); paramIndex++; }
    if (settings.name !== undefined) { fields.push(`name = $${paramIndex}`); params.push(settings.name); paramIndex++; }

    if (fields.length === 0) throw new BadRequestException('No valid setting fields provided.');

    const sql = `UPDATE tenants SET ${fields.join(', ')}, updated_at = NOW() WHERE id = $1 RETURNING *`;
    const res = await this.authQuery.query(sql, params);
    return res.rows[0];
  }

  async getTenantAuthPolicy(tenantIdOrSubdomain: string) {
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(tenantIdOrSubdomain);
    let tenantId = tenantIdOrSubdomain;
    if (!isUuid) {
      const res = await this.authQuery.query(
        `SELECT tenant_id FROM tenant_domains WHERE LOWER(domain_name) = $1
         UNION SELECT id as tenant_id FROM tenants WHERE LOWER(domain) = $1 LIMIT 1`,
        [tenantIdOrSubdomain.toLowerCase()]
      ).catch(() => ({ rows: [] }));
      tenantId = res.rows.length > 0 ? (res.rows[0] as any).tenant_id : DEFAULT_TENANT_ID;
    }

    const result = await this.authQuery.query('SELECT * FROM tenant_auth_settings WHERE tenant_id = $1 LIMIT 1', [tenantId]).catch(() => ({ rows: [] }));
    if (result.rows.length === 0) {
      return {
        tenantId, allowPasswordLogin: true, allowMicrosoftSso: true, allowGoogleSso: true,
        enforceSsoOnly: false, requireMfa: false, allowPersonalEmails: true, allowedEmailDomains: [],
        microsoftTenantId: null, microsoftClientId: null,
      };
    }
    const row: any = result.rows[0];
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
    };
  }

  async updateTenantAuthPolicy(tenantId: string, dto: any) {
    const result = await this.authQuery.query(
      `INSERT INTO tenant_auth_settings (
         tenant_id, allow_password_login, allow_microsoft_sso, allow_google_sso, enforce_sso_only, require_mfa, allow_personal_emails, allowed_email_domains, microsoft_tenant_id, microsoft_client_id, microsoft_client_secret
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       ON CONFLICT (tenant_id) DO UPDATE SET
         allow_password_login    = EXCLUDED.allow_password_login,
         allow_microsoft_sso     = EXCLUDED.allow_microsoft_sso,
         allow_google_sso        = EXCLUDED.allow_google_sso,
         enforce_sso_only        = EXCLUDED.enforce_sso_only,
         require_mfa             = EXCLUDED.require_mfa,
         allow_personal_emails   = EXCLUDED.allow_personal_emails,
         allowed_email_domains   = EXCLUDED.allowed_email_domains,
         microsoft_tenant_id     = EXCLUDED.microsoft_tenant_id,
         microsoft_client_id     = EXCLUDED.microsoft_client_id,
         microsoft_client_secret = COALESCE(EXCLUDED.microsoft_client_secret, tenant_auth_settings.microsoft_client_secret),
         updated_at              = NOW()
       RETURNING *`,
      [
        tenantId,
        dto.allowPasswordLogin ?? true, dto.allowMicrosoftSso ?? true, dto.allowGoogleSso ?? true,
        dto.enforceSsoOnly ?? false, dto.requireMfa ?? false, dto.allowPersonalEmails ?? true,
        dto.allowedEmailDomains || [], dto.microsoftTenantId || null, dto.microsoftClientId || null, dto.microsoftClientSecret || null,
      ]
    );
    const row: any = result.rows[0];
    return {
      tenantId: row.tenant_id, allowPasswordLogin: row.allow_password_login,
      allowMicrosoftSso: row.allow_microsoft_sso, allowGoogleSso: row.allow_google_sso,
      enforceSsoOnly: row.enforce_sso_only, requireMfa: row.require_mfa,
      allowPersonalEmails: row.allow_personal_emails, allowedEmailDomains: row.allowed_email_domains,
      microsoftTenantId: row.microsoft_tenant_id, microsoftClientId: row.microsoft_client_id,
    };
  }

  async verifyCustomDomain(tenantId: string, domainName: string) {
    const normalized = (domainName || '').toLowerCase().trim();
    if (!normalized) throw new BadRequestException('Domain name is required.');

    const res = await this.authQuery.query(
      'SELECT id, verification_token, verification_status FROM tenant_domains WHERE LOWER(domain_name) = $1 AND tenant_id = $2 LIMIT 1',
      [normalized, tenantId]
    );
    if (res.rows.length === 0) throw new NotFoundException('Domain mapping not found.');

    const isLocal = normalized.endsWith('.local') || normalized.includes('localhost') || (process.env.NODE_ENV !== 'production' && !normalized.includes('.'));
    if (isLocal) {
      await this.authQuery.query(
        `UPDATE tenant_domains SET verification_status = 'VERIFIED', ssl_status = 'ACTIVE', verified_at = NOW() WHERE id = $1`,
        [(res.rows[0] as any).id]
      );
      return { success: true, verified: true, status: 'VERIFIED', domainName: normalized, sslStatus: 'ACTIVE', message: 'Domain verified in development mode.' };
    }

    const resolver = new dns.Resolver();
    resolver.setServers(['8.8.8.8', '1.1.1.1']);
    let dnsMatched = false;
    let matchDetail = '';

    try {
      const cnames = await resolver.resolveCname(normalized);
      this.logger.log(`DNS check CNAME for ${normalized}: ${JSON.stringify(cnames)}`);
      const baseDomain = (process.env.BASE_DOMAIN || 'enfyjobs.com').toLowerCase();
      const validCname = cnames.some(c => {
        const cleanC = c.toLowerCase().replace(/\.$/, '');
        return cleanC.endsWith(baseDomain) || cleanC === baseDomain;
      });
      if (validCname) { dnsMatched = true; matchDetail = `CNAME points to ${cnames.join(', ')}`; }
    } catch (e: any) {
      this.logger.debug(`CNAME resolution not found for ${normalized}: ${e.message}`);
    }

    if (!dnsMatched) {
      try {
        const aRecords = await resolver.resolve4(normalized);
        this.logger.log(`DNS check A records for ${normalized}: ${JSON.stringify(aRecords)}`);
        const serverIp = process.env.VPS_IP || '13.55.100.200';
        if (aRecords.includes(serverIp)) { dnsMatched = true; matchDetail = `A record points to server IP ${serverIp}`; }
      } catch (e: any) {
        this.logger.debug(`A record resolution not found for ${normalized}: ${e.message}`);
      }
    }

    if (!dnsMatched) {
      await this.authQuery.query(
        `UPDATE tenant_domains SET verification_status = 'PENDING', ssl_status = 'PENDING' WHERE id = $1`,
        [(res.rows[0] as any).id]
      );
      return {
        success: false, verified: false, status: 'PENDING', domainName: normalized, sslStatus: 'PENDING',
        message: `DNS records not detected yet for ${normalized}. Please ensure your CNAME points to enfyjobs.com or an A record points to 13.55.100.200.`,
      };
    }

    await this.authQuery.query(
      `UPDATE tenant_domains SET verification_status = 'VERIFIED', ssl_status = 'ACTIVE', verified_at = NOW() WHERE id = $1`,
      [(res.rows[0] as any).id]
    );

    return { success: true, verified: true, status: 'VERIFIED', domainName: normalized, sslStatus: 'ACTIVE', message: `DNS verified successfully (${matchDetail}) and SSL is active!` };
  }
}
