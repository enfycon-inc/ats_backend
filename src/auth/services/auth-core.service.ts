import {
  Injectable,
  Logger,
  UnauthorizedException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { AuthQueryService } from './auth-query.service';
import { AuthKeycloakService } from './auth-keycloak.service';
import { AuthTenantService } from './auth-tenant.service';
import { AuthRbacService } from './auth-rbac.service';
import { AuthEmailService } from './auth-email.service';

const DEFAULT_TENANT_ID = process.env.DEFAULT_TENANT_ID || 'd3b07384-d113-49c3-a555-9ee75c13ca33';

/**
 * AuthCoreService — core authentication flows:
 * - Password login via Keycloak direct grant (RS256 token, no internal JWT issuance)
 * - Keycloak token refresh (proxy-only — no HS256 fallback)
 * - Admin user registration
 */
@Injectable()
export class AuthCoreService {
  private readonly logger = new Logger(AuthCoreService.name);

  constructor(
    public readonly authQuery: AuthQueryService,
    private readonly keycloakService: AuthKeycloakService,
    private readonly tenantService: AuthTenantService,
    private readonly rbacService: AuthRbacService,
    private readonly emailService: AuthEmailService,
  ) {}

  // ─── Token decode helper (no signature check — for reading Keycloak JWT claims) ──

  decodeTokenPayload(token: string): any {
    try {
      const parts = token.split('.');
      if (parts.length !== 3) return null;
      return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    } catch {
      return null;
    }
  }

  async getRequesterInfoFromToken(authHeader?: string): Promise<{ roles: string[]; tenantId: string | null; isAdmin: boolean }> {
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return { roles: [], tenantId: null, isAdmin: false };
    }
    const token = authHeader.slice(7).trim();
    const payload = this.decodeTokenPayload(token);
    if (!payload) return { roles: [], tenantId: null, isAdmin: false };

    const email = (payload.email || payload.preferred_username || '').toLowerCase();
    const sub = payload.sub || '';

    let dbRoles: string[] = [];
    let dbTenantId: string | null = null;
    if (email || sub) {
      const userRes = await this.authQuery.query(
        `SELECT u.tenant_id, u.role_id, u.assigned_role_ids, cr.name as role_name, cr.system_role
         FROM users u
         LEFT JOIN custom_roles cr ON cr.id = u.role_id
         WHERE u.email = $1 OR u.keycloak_id = $2 OR u.id::text = $3 LIMIT 1`,
        [email, sub, sub]
      );
      if (userRes.rows.length > 0) {
        const uRow: any = userRes.rows[0];
        dbTenantId = uRow.tenant_id || null;
        if (uRow.role_name) dbRoles.push(uRow.role_name);
        if (uRow.system_role) dbRoles.push(uRow.system_role);

        if (Array.isArray(uRow.assigned_role_ids) && uRow.assigned_role_ids.length > 0) {
          const extraRolesRes = await this.authQuery.query(
            `SELECT name, system_role FROM custom_roles WHERE id = ANY($1::uuid[])`,
            [uRow.assigned_role_ids]
          );
          (extraRolesRes.rows as any[]).forEach((r) => {
            if (r.name) dbRoles.push(r.name);
            if (r.system_role) dbRoles.push(r.system_role);
          });
        }
      }
    }

    let jwtRoles: string[] = payload.roles || [];
    if (payload.realm_access?.roles) jwtRoles = [...jwtRoles, ...payload.realm_access.roles];

    const allRoles = Array.from(new Set([...jwtRoles, ...dbRoles])).map((r) => r.toUpperCase());
    const tenantId = dbTenantId || payload.tenantId || null;
    const isAdmin = allRoles.includes('ADMIN') || allRoles.includes('SUPER_ADMIN') || allRoles.includes('TENANT_ADMIN') || allRoles.includes('BRANCH_ADMIN');

    return { roles: allRoles, tenantId, isAdmin };
  }

  // ─── Login ───────────────────────────────────────────────────────────────────

  async login(dto: { email: string; password: string; subdomain?: string }) {
    this.logger.log(`Login attempt for ${dto.email} [Provider: Keycloak]`);

    const cleanEmail = dto.email.trim().toLowerCase();
    let result = await this.authQuery.query(
      `SELECT u.id, u.email, u.first_name, u.last_name, u.full_name, u.is_active, u.is_approved, u.tenant_id, u.role_id, u.assigned_role_ids, u.pod_id, u.branch_id, u.assigned_branch_ids, u.branch_roles, u.business_unit_id, t.default_market, t.domain as tenant_domain, t.status as tenant_status, t.pod_system_enabled, cr.system_role, cr.name as role_name, b.name as branch_name, bu.name as business_unit_name
       FROM users u
       LEFT JOIN tenants t ON u.tenant_id = t.id
       LEFT JOIN custom_roles cr ON u.role_id = cr.id
       LEFT JOIN branches b ON u.branch_id = b.id
       LEFT JOIN business_units bu ON u.business_unit_id = bu.id
       WHERE LOWER(TRIM(u.email)) = $1 LIMIT 1`,
      [cleanEmail]
    );

    // Self-healing bootstrap if admin / tenant-admin DB record missing
    if (result.rows.length === 0) {
      try {
        const platformAdminEmail = process.env.PLATFORM_ADMIN_EMAIL;
        const debAdminEmail = process.env.DEB_ADMIN_EMAIL;
        const isPlatformAdmin = Boolean(platformAdminEmail && cleanEmail === platformAdminEmail.toLowerCase());
        const isDebAdmin = Boolean(debAdminEmail && cleanEmail === debAdminEmail.toLowerCase());

        if (isPlatformAdmin || isDebAdmin) {
          const isSuperAdmin = isPlatformAdmin;
          const tenantId = isSuperAdmin ? DEFAULT_TENANT_ID : (process.env.DEB_TENANT_ID || '737f666b-916a-4e9c-91bd-b2bd37e475d1');
          const userId = isSuperAdmin ? '1d4ac532-4229-4c95-9b11-af573060020b' : 'fd276e95-2bc6-4b96-9f61-2e971e9b8aa4';
          const fullName = isSuperAdmin
            ? (process.env.PLATFORM_ADMIN_NAME || 'Platform Super Admin')
            : (process.env.DEB_ADMIN_NAME || 'Tenant Admin');

          let roleId: string | null = null;
          try {
            const roleMap = await this.rbacService.seedTenantRoles(tenantId);
            roleId = isSuperAdmin ? roleMap['SUPER_ADMIN'] : roleMap['ADMIN'];
          } catch (rErr: any) {
            this.logger.warn(`Could not seed role for ${cleanEmail}: ${rErr.message}`);
          }

          const existingUser = await this.authQuery.query('SELECT id FROM users WHERE LOWER(email) = LOWER($1) LIMIT 1', [cleanEmail]).catch(() => ({ rows: [] }));
          if (existingUser.rows.length > 0) {
            await this.authQuery.query('UPDATE users SET is_active = true, is_approved = true WHERE LOWER(email) = LOWER($1)', [cleanEmail]).catch(() => {});
          } else {
            await this.authQuery.query(
              `INSERT INTO users (id, tenant_id, email, full_name, is_active, is_approved, keycloak_id)
               VALUES ($1, $2, $3, $4, true, true, $1)
               ON CONFLICT (id) DO UPDATE SET is_active = true, is_approved = true`,
              [userId, tenantId, cleanEmail, fullName]
            ).catch((err) => this.logger.warn(`User bootstrap insert note: ${err.message}`));
          }

          if (roleId) {
            await this.authQuery.query('UPDATE users SET role_id = $1 WHERE LOWER(email) = LOWER($2)', [roleId, cleanEmail]).catch(() => {});
          }

          result = await this.authQuery.query(
            `SELECT u.id, u.email, u.first_name, u.last_name, u.full_name, u.is_active, u.is_approved, u.tenant_id, u.role_id, u.assigned_role_ids, u.pod_id, u.branch_id, u.assigned_branch_ids, u.branch_roles, u.business_unit_id, t.default_market, t.domain as tenant_domain, t.status as tenant_status, t.pod_system_enabled, cr.system_role, cr.name as role_name, b.name as branch_name, bu.name as business_unit_name
             FROM users u
             LEFT JOIN tenants t ON u.tenant_id = t.id
             LEFT JOIN custom_roles cr ON u.role_id = cr.id
             LEFT JOIN branches b ON u.branch_id = b.id
             LEFT JOIN business_units bu ON u.business_unit_id = bu.id
             WHERE LOWER(TRIM(u.email)) = $1 LIMIT 1`,
            [cleanEmail]
          ).catch(() => ({ rows: [], rowCount: 0 }));
        }
      } catch (bootstrapErr: any) {
        this.logger.warn(`Self-healing bootstrap note for ${cleanEmail}: ${bootstrapErr.message}`);
      }
    }

    if (result.rows.length === 0) throw new UnauthorizedException('Invalid email or password.');
    const user: any = result.rows[0];

    if (user.tenant_status && user.tenant_status !== 'ACTIVE') {
      throw new UnauthorizedException('Your company workspace is inactive. Contact the platform administrator.');
    }
    if (!user.is_active) throw new UnauthorizedException('Your account has been deactivated. Contact your administrator.');
    if (!user.is_approved) {
      if (user.tenant_status === 'ACTIVE') {
        await this.authQuery.query('UPDATE users SET is_approved = true WHERE id = $1', [user.id]);
        user.is_approved = true;
      } else {
        throw new UnauthorizedException('Your account is pending approval by the administrator.');
      }
    }

    const policy = await this.tenantService.getTenantAuthPolicy(user.tenant_id);
    if (policy.enforceSsoOnly || !policy.allowPasswordLogin) {
      throw new UnauthorizedException('Password login is disabled by your organization administrator. Please sign in using Single Sign-On (SSO).');
    }
    if (policy.allowedEmailDomains && policy.allowedEmailDomains.length > 0) {
      const emailDomain = dto.email.split('@')[1]?.toLowerCase();
      if (!policy.allowedEmailDomains.map((d: string) => d.toLowerCase()).includes(emailDomain)) {
        throw new UnauthorizedException(`Logins with @${emailDomain} domain are not permitted for this organization.`);
      }
    }

    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    const userRoleIds = new Set<string>();
    const legacyRoleNames = new Set<string>();

    if (user.role_id) {
      if (uuidRegex.test(user.role_id)) userRoleIds.add(user.role_id);
      else legacyRoleNames.add(user.role_id);
    }
    if (Array.isArray(user.assigned_role_ids)) {
      user.assigned_role_ids.forEach((rid: string) => {
        if (rid) { if (uuidRegex.test(rid)) userRoleIds.add(rid); else legacyRoleNames.add(rid); }
      });
    }
    if (user.branch_roles && typeof user.branch_roles === 'object') {
      Object.values(user.branch_roles).forEach((bRoleList: any) => {
        if (Array.isArray(bRoleList)) bRoleList.forEach((rid: string) => {
          if (rid) { if (uuidRegex.test(rid)) userRoleIds.add(rid); else legacyRoleNames.add(rid); }
        });
      });
    }

    let permissions: string[] = [];
    let dynamicRoles: string[] = [];

    if (legacyRoleNames.size > 0) {
      const legacyRes = await this.authQuery.query(
        'SELECT id, name FROM custom_roles WHERE tenant_id = $1 AND (UPPER(name) = ANY($2) OR system_role = ANY($2))',
        [user.tenant_id, Array.from(legacyRoleNames).map(r => r.toUpperCase())]
      ).catch(() => ({ rows: [] }));
      (legacyRes.rows as any[]).forEach((r) => userRoleIds.add(r.id));
    }

    if (userRoleIds.size > 0) {
      const validUuids = Array.from(userRoleIds).filter(id => uuidRegex.test(id));
      if (validUuids.length > 0) {
        const [permsResult, rolesResult] = await Promise.all([
          this.authQuery.query('SELECT DISTINCT permission FROM role_permissions WHERE role_id = ANY($1::uuid[])', [validUuids]).catch(() => ({ rows: [] })),
          this.authQuery.query('SELECT id, name, system_role FROM custom_roles WHERE id = ANY($1::uuid[])', [validUuids]).catch(() => ({ rows: [] }))
        ]);
        permissions = (permsResult.rows as any[]).map((row) => row.permission);
        dynamicRoles = Array.from(new Set((rolesResult.rows as any[]).map((row) => row.name)));
      }
    }
    if (dynamicRoles.length === 0 && user.role_name) dynamicRoles = [user.role_name];
    if (dynamicRoles.length === 0) dynamicRoles = [user.system_role || 'RECRUITER'];

    const isSuperAdmin = dynamicRoles.includes('SUPER_ADMIN');
    if (isSuperAdmin && dto.subdomain && dto.subdomain !== 'www' && dto.subdomain !== 'localhost' && dto.subdomain !== 'enfycon.com' && dto.subdomain !== 'enfyjobs.com') {
      throw new UnauthorizedException('Super Administrators can only log in from the main domain.');
    }

    if (!isSuperAdmin && dto.subdomain && dto.subdomain !== 'www' && dto.subdomain !== 'localhost' && dto.subdomain !== 'enfycon.com' && dto.subdomain !== 'enfyjobs.com') {
      const cleanSubdomain = dto.subdomain.split(':')[0].replace(/^https?:\/\//, '').trim().toLowerCase();
      const domainMapping = await this.authQuery.query(
        `SELECT tenant_id FROM tenant_domains WHERE LOWER(TRIM(domain_name)) = $1 OR LOWER(TRIM(domain_name)) = $2
         UNION
         SELECT id as tenant_id FROM tenants WHERE LOWER(TRIM(domain)) = $1 OR LOWER(TRIM(domain || '.enfyjobs.com')) = $1
         LIMIT 1`,
        [cleanSubdomain, cleanSubdomain.replace(/^www\./, '')]
      );
      if (domainMapping.rows.length > 0) {
        const mappedTenantId = (domainMapping.rows[0] as any).tenant_id;
        if (user.tenant_id !== mappedTenantId) throw new UnauthorizedException('User does not belong to this company workspace.');
      } else {
        const userTenant = await this.authQuery.query('SELECT domain FROM tenants WHERE id = $1', [user.tenant_id]);
        if (userTenant.rows.length > 0) {
          const tenantSlug = ((userTenant.rows[0] as any).domain || '').toLowerCase().trim();
          if (!(cleanSubdomain === tenantSlug || cleanSubdomain === `${tenantSlug}.enfyjobs.com` || cleanSubdomain.startsWith(tenantSlug))) {
            throw new UnauthorizedException('Workspace not found.');
          }
        } else {
          throw new UnauthorizedException('Workspace not found.');
        }
      }
    }

    let systemRole = user.system_role || 'RECRUITER';
    // systemRole will be re-derived from Keycloak realm_access.roles after successful auth below.


    // Keycloak authentication — single source of truth
    let keycloakToken: string | null = null;
    let refreshToken: string | null = null;
    let expiresIn: number;

    const issuer = process.env.KEYCLOAK_ISSUER || 'http://keycloak:8080/realms/enfycon-ats';
    const tokenUrl = `${issuer}/protocol/openid-connect/token`;
    const params = new URLSearchParams();
    params.append('grant_type', 'password');
    params.append('client_id', process.env.KEYCLOAK_CLIENT_ID || 'enfycon-ats');
    const clientSecret = process.env.KEYCLOAK_CLIENT_SECRET || 'mL9aWPt1POtRCp2dDqCt9tG4fakwm7rn';
    if (clientSecret) params.append('client_secret', clientSecret);
    params.append('username', cleanEmail);
    params.append('password', dto.password);

    try {
      let res = await fetch(tokenUrl, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: params.toString() });
      if (!res.ok && res.status !== 401 && res.status !== 400) {
        const altUrl = tokenUrl.includes('localhost') ? tokenUrl.replace('localhost', 'keycloak') : tokenUrl.replace('keycloak', 'localhost');
        res = await fetch(altUrl, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: params.toString() });
      }

      // If rejected (401) and it's an admin user configured in env, auto-sync credentials in Keycloak and retry
      const platformAdminEmail = process.env.PLATFORM_ADMIN_EMAIL;
      const debAdminEmail = process.env.DEB_ADMIN_EMAIL;
      const isAdminEmail = (platformAdminEmail && cleanEmail === platformAdminEmail.toLowerCase()) ||
                           (debAdminEmail && cleanEmail === debAdminEmail.toLowerCase());
      const adminExpectedPass = (platformAdminEmail && cleanEmail === platformAdminEmail.toLowerCase())
        ? process.env.PLATFORM_ADMIN_PASSWORD
        : process.env.DEB_ADMIN_PASSWORD;

      if (!res.ok && res.status === 401 && isAdminEmail && adminExpectedPass && dto.password === adminExpectedPass) {
        this.logger.log(`[Auth] Attempting auto-sync of credentials in Keycloak for ${cleanEmail}...`);
        await this.keycloakService.provisionUserInKeycloak({
          email: cleanEmail,
          password: dto.password,
          fullName: user.full_name,
          tenantId: user.tenant_id,
        }).catch((err) => this.logger.warn(`Keycloak provision error: ${err.message}`));
        res = await fetch(tokenUrl, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: params.toString() });
      }
      if (res.ok) {
        const tokenData = await res.json();
        keycloakToken = tokenData.access_token;
        refreshToken = tokenData.refresh_token;
        expiresIn = tokenData.expires_in;

        // ── Derive authoritative systemRole from Keycloak realm_access.roles ──
        try {
          const kcPayload = JSON.parse(Buffer.from(keycloakToken!.split('.')[1], 'base64url').toString('utf8'));
          const kcRealmRoles: string[] = (kcPayload.realm_access?.roles || []).map((r: string) => r.toUpperCase());
          if (kcRealmRoles.includes('SUPER_ADMIN')) systemRole = 'SUPER_ADMIN';
          else if (dynamicRoles.includes('SUPER_ADMIN')) systemRole = 'SUPER_ADMIN';
        } catch (decodeErr) {
          this.logger.warn(`[Auth] Could not decode Keycloak token for realm roles: ${decodeErr}`);
          if (dynamicRoles.includes('SUPER_ADMIN')) systemRole = 'SUPER_ADMIN';
        }

        await this.keycloakService.syncKeycloakUser({ keycloakId: user.id, email: user.email, fullName: user.full_name, roles: dynamicRoles }).catch(() => {});
      } else {
        this.logger.warn(`Keycloak direct grant rejected credentials for ${dto.email} (status ${res.status})`);
        throw new UnauthorizedException('Invalid email or password.');
      }
    } catch (kcErr: any) {
      if (kcErr instanceof UnauthorizedException) throw kcErr;
      this.logger.error(`Keycloak direct grant error for ${dto.email}: ${kcErr.message}`);
      throw new UnauthorizedException('Authentication failed or invalid credentials.');
    }

    if (!keycloakToken) throw new UnauthorizedException('Invalid email or password.');

    return {
      accessToken: keycloakToken,
      refreshToken: refreshToken || keycloakToken,
      expiresIn: expiresIn!,
      tokenType: 'Bearer',
      user: {
        id: user.id, email: user.email, firstName: user.first_name || '', lastName: user.last_name || '', fullName: user.full_name,
        roles: dynamicRoles, tenantId: user.tenant_id || DEFAULT_TENANT_ID, defaultMarket: user.default_market || 'US',
        tenantDomain: user.tenant_domain || '', permissions, systemRole,
        podId: user.pod_id || null, branchId: user.branch_id || null,
        assignedBranchIds: user.assigned_branch_ids && user.assigned_branch_ids.length > 0 ? user.assigned_branch_ids : (user.branch_id ? [user.branch_id] : []),
        branchRoles: user.branch_roles || {}, branchName: user.branch_name || null,
        businessUnitId: user.business_unit_id || null, businessUnitName: user.business_unit_name || null,
        podSystemEnabled: user.pod_system_enabled ?? true,
      },
    };
  }

  // ─── Token Refresh (Keycloak-only — no internal HS256 fallback) ───────────────

  async refreshKeycloakToken(refreshToken: string) {
    if (!refreshToken) throw new BadRequestException('Refresh token is required.');

    const issuer = process.env.KEYCLOAK_ISSUER || 'http://keycloak:8080/realms/enfycon-ats';
    const tokenUrl = `${issuer}/protocol/openid-connect/token`;
    const params = new URLSearchParams();
    params.append('grant_type', 'refresh_token');
    params.append('client_id', process.env.KEYCLOAK_CLIENT_ID || 'enfycon-ats');
    const clientSecret = process.env.KEYCLOAK_CLIENT_SECRET || 'mL9aWPt1POtRCp2dDqCt9tG4fakwm7rn';
    if (clientSecret) params.append('client_secret', clientSecret);
    params.append('refresh_token', refreshToken);

    let res = await fetch(tokenUrl, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: params.toString() }).catch(() => null);
    if (!res || !res.ok) {
      const altUrl = tokenUrl.includes('localhost')
        ? tokenUrl.replace('localhost', 'keycloak')
        : tokenUrl.replace('keycloak', 'localhost');
      res = await fetch(altUrl, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: params.toString() }).catch(() => null);
    }

    if (res && res.ok) {
      const tokenData = await res.json();
      return {
        accessToken: tokenData.access_token,
        refreshToken: tokenData.refresh_token || refreshToken,
        expiresIn: tokenData.expires_in,
      };
    }

    // Keycloak rejected the refresh token — session has genuinely expired
    this.logger.warn('[Auth] Keycloak refresh token rejected — session expired.');
    throw new UnauthorizedException('Your session has expired. Please log in again.');
  }

  // ─── Register (Admin creates user) ───────────────────────────────────────────

  async register(dto: {
    email: string;
    firstName?: string;
    lastName?: string;
    fullName?: string;
    password: string;
    role?: string;
    roles?: string[];
    tenantId?: string;
    branchId?: string;
    assignedBranchIds?: string[];
    branchRoles?: Record<string, string[]>;
    isApproved?: boolean;
    sendEmailInvite?: boolean;
  }, authHeader?: string) {
    const email = (dto.email || '').trim().toLowerCase();
    const firstName = (dto.firstName || (dto.fullName ? dto.fullName.trim().split(/\s+/)[0] : '') || '').trim();
    const lastName = (dto.lastName || (dto.fullName ? dto.fullName.trim().split(/\s+/).slice(1).join(' ') : '') || '').trim();
    const fullName = (dto.fullName || `${firstName} ${lastName}`).trim();
    const password = dto.password;

    if (!email || !fullName || !password) throw new BadRequestException('Email, full name, and password are required and cannot be empty.');
    if (fullName.length < 2) throw new BadRequestException('Full name must be at least 2 characters.');
    const emailParts = email.split('@');
    if (emailParts.length !== 2 || !emailParts[0] || !emailParts[1]) throw new BadRequestException('Invalid email address format.');
    if (password.length < 8) throw new BadRequestException('Password must be at least 8 characters.');

    this.logger.log(`Registering user: ${email} [${dto.role}]`);

    const exists = await this.authQuery.query('SELECT id FROM users WHERE email = $1 LIMIT 1', [email]);
    if (exists.rows.length > 0) throw new ConflictException(`Email ${email} is already registered.`);

    const role = dto.role?.toUpperCase() || 'RECRUITER';
    if (role === 'SUPER_ADMIN') throw new ForbiddenException('Registering with SUPER_ADMIN role is not allowed.');
    let tenantId = dto.tenantId || DEFAULT_TENANT_ID;

    const requester = await this.getRequesterInfoFromToken(authHeader);
    const requesterRoles = requester.roles;
    const requesterIsAdmin = requester.isAdmin;
    const requesterTenantId = requester.tenantId;

    if (requesterIsAdmin && !requesterRoles.includes('SUPER_ADMIN') && requesterTenantId) tenantId = requesterTenantId;

    let isApproved = false;
    if (requesterIsAdmin) {
      if (requesterRoles.includes('SUPER_ADMIN')) isApproved = dto.isApproved !== undefined ? dto.isApproved : true;
      else if (requesterTenantId === tenantId) isApproved = true;
    }

    if (isApproved) await this.rbacService.checkSeatLimit(tenantId);

    const rawRolesList: string[] = [];
    if (Array.isArray(dto.roles) && dto.roles.length > 0) rawRolesList.push(...dto.roles);
    else if (dto.role) rawRolesList.push(dto.role);
    if (rawRolesList.length === 0) rawRolesList.push('RECRUITER');

    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    const resolvedRoleIds = new Set<string>();
    let primaryRoleName = rawRolesList[0];

    const rolesRes = await this.authQuery.query(
      `SELECT id, name, system_role FROM custom_roles WHERE tenant_id = $1 AND (id::text = ANY($2) OR UPPER(name) = ANY($3) OR system_role = ANY($3))`,
      [tenantId, rawRolesList, rawRolesList.map(r => r.toUpperCase())]
    );
    (rolesRes.rows as any[]).forEach((r) => {
      resolvedRoleIds.add(r.id);
      if (!primaryRoleName || primaryRoleName === 'RECRUITER') primaryRoleName = r.name;
    });

    const assignedRoleIds: string[] = Array.from(resolvedRoleIds);
    const roleId: string | null = assignedRoleIds[0] || null;
    const branchId: string | null = dto.branchId && uuidRegex.test(dto.branchId) ? dto.branchId : null;
    let assignedBranchIds: string[] = Array.isArray(dto.assignedBranchIds)
      ? dto.assignedBranchIds.filter(b => b && uuidRegex.test(b))
      : (branchId ? [branchId] : []);
    if (branchId && !assignedBranchIds.includes(branchId)) assignedBranchIds.push(branchId);
    const branchRoles = dto.branchRoles || (branchId && assignedRoleIds.length > 0 ? { [branchId]: assignedRoleIds } : {});

    const result = await this.authQuery.query(
      `INSERT INTO users (tenant_id, email, first_name, last_name, full_name, is_active, is_approved, role_id, assigned_role_ids, branch_id, assigned_branch_ids, branch_roles)
       VALUES ($1, $2, $3, $4, $5, true, $6, $7, $8::uuid[], $9, $10::uuid[], $11::jsonb)
       RETURNING id, email, first_name, last_name, full_name, tenant_id, created_at, role_id, assigned_role_ids, branch_id, assigned_branch_ids`,
      [tenantId, email, firstName, lastName, fullName, isApproved, roleId, assignedRoleIds, branchId, assignedBranchIds, JSON.stringify(branchRoles)]
    );
    const user: any = result.rows[0];

    await this.keycloakService.provisionUserInKeycloak({ email: user.email, password, fullName: user.full_name, tenantId: user.tenant_id });

    if (dto.sendEmailInvite !== false) {
      this.authQuery.query('SELECT name, domain FROM tenants WHERE id = $1 LIMIT 1', [tenantId])
        .then((tRes) => {
          const tenantName = (tRes.rows[0] as any)?.name || 'Enfycon Workspace';
          const tenantDomain = (tRes.rows[0] as any)?.domain || '';
          return this.emailService.sendMemberCredentialsEmail({ to: email, fullName, tenantName, subdomain: tenantDomain, tenantId, temporaryPassword: password, roleName: primaryRoleName });
        })
        .catch((err) => { this.logger.warn(`Failed to dispatch member credentials email to ${email}: ${err.message}`); });
    }

    return {
      message: isApproved ? 'User registered and approved successfully.' : 'User registered successfully. Pending administrator approval.',
      user: { id: user.id, email: user.email, firstName: user.first_name, lastName: user.last_name, fullName: user.full_name, roles: [primaryRoleName], tenantId: user.tenant_id, createdAt: user.created_at },
    };
  }

  // ─── SSO Login (disabled — requires Keycloak token exchange; not currently in scope) ─

  async ssoLogin(_dto: any): Promise<never> {
    throw new BadRequestException(
      'SSO login is not currently supported. Please use password-based login.'
    );
  }
}

