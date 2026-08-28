import {
  Injectable,
  Logger,
  OnModuleInit,
  UnauthorizedException,
  ConflictException,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import * as crypto from 'crypto';
import * as nodemailer from 'nodemailer';
import * as dns from 'dns/promises';
import axios from 'axios';
import { DatabaseService } from '../database/database.service';
import { LoginDto } from './dtos/login.dto';
import { RegisterDto } from './dtos/register.dto';
import { RegisterTenantDto } from './dtos/register-tenant.dto';
import { InviteUserDto } from './dtos/invite-user.dto';
import { SsoLoginDto } from './dtos/sso-login.dto';
import { AcceptInviteDto } from './dtos/accept-invite.dto';
import { AddCustomDomainDto, VerifyCustomDomainDto } from './dtos/custom-domain.dto';

const DEFAULT_TENANT_ID = process.env.DEFAULT_TENANT_ID || 'd3b07384-d113-49c3-a555-9ee75c13ca33';
const TOKEN_TTL_SECONDS = 60 * 60 * 24 * 7;

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * AuthService — Keycloak Identity & Authorization Service
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Handles direct grant authentication and token refresh via Keycloak OIDC
 * protocol endpoints, and syncs user credentials & RBAC into PostgreSQL.
 * ─────────────────────────────────────────────────────────────────────────────
 */
@Injectable()
export class AuthService implements OnModuleInit {
  private readonly logger = new Logger(AuthService.name);
  private readonly jwtSecret: string =
    process.env.AUTH_SECRET ||
    process.env.MOCK_JWT_SECRET ||
    process.env.JWT_SECRET ||
    'enfy-ats-jwt-secret-secure-key';

  constructor(private readonly db: DatabaseService) {}

  // ─────────────────────────────────────────────────────────────
  // Module boot: ensure users table exists and seed defaults
  // ─────────────────────────────────────────────────────────────
  async onModuleInit() {
    await this.ensureUsersTable();
    await this.seedDefaultUsers();
    
    // Sync active tenants with system permissions in background to enable instant server boot
    this.syncAllTenantRoles().catch((err) => {
      this.logger.warn(`Background tenant role sync note: ${err.message}`);
    });

    const adminEmail = process.env.PLATFORM_ADMIN_EMAIL;
    const adminPassword = process.env.PLATFORM_ADMIN_PASSWORD;
    const adminName = process.env.PLATFORM_ADMIN_NAME || 'Platform Super Admin';
    if (adminEmail && adminPassword) {
      this.logger.log(`[BOOT] Syncing Platform Super Admin (${adminEmail}) into Keycloak on startup...`);
      this.provisionUserInKeycloak({
        email: adminEmail,
        password: adminPassword,
        fullName: adminName,
        tenantId: DEFAULT_TENANT_ID,
      }).catch((err) => {
        this.logger.warn(`[BOOT] Async Keycloak admin sync note: ${err.message}`);
      });
    } else {
      this.logger.warn(`[BOOT] PLATFORM_ADMIN_EMAIL or PLATFORM_ADMIN_PASSWORD not set in environment — skipping Keycloak Super Admin sync.`);
    }
  }

  private async syncAllTenantRoles() {
    try {
      const tenantsResult = await this.db.query('SELECT id FROM tenants');
      await Promise.all(tenantsResult.rows.map((tenant) => this.seedTenantRoles(tenant.id)));
      this.logger.log('All tenant default roles and permissions successfully synchronized.');
    } catch (err: any) {
      this.logger.error(`Failed to synchronize tenant roles: ${err.message}`);
    }
  }

  private async ensureUsersTable() {
    const ddl = `
      -- 1. Create custom_roles table
      CREATE TABLE IF NOT EXISTS custom_roles (
        id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id     UUID NOT NULL DEFAULT 'd3b07384-d113-49c3-a555-9ee75c13ca33',
        name          VARCHAR(100) NOT NULL,
        description   TEXT,
        is_system     BOOLEAN NOT NULL DEFAULT false,
        created_at    TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at    TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        UNIQUE(tenant_id, name)
      );

      -- Ensure system_role column exists on custom_roles
      ALTER TABLE custom_roles ADD COLUMN IF NOT EXISTS system_role VARCHAR(50) DEFAULT 'RECRUITER';

      -- Update system_role mappings for default system roles
      UPDATE custom_roles SET system_role = 'ADMIN' WHERE name = 'ADMIN';
      UPDATE custom_roles SET system_role = 'SUPER_ADMIN' WHERE name = 'SUPER_ADMIN';
      UPDATE custom_roles SET system_role = 'BRANCH_ADMIN' WHERE name = 'BRANCH_ADMIN';
      UPDATE custom_roles SET system_role = 'ACCOUNT_MANAGER' WHERE name = 'ACCOUNT_MANAGER';
      UPDATE custom_roles SET system_role = 'DELIVERY_HEAD' WHERE name = 'DELIVERY_HEAD';
      UPDATE custom_roles SET system_role = 'POD_LEAD' WHERE name = 'POD_LEAD';

      -- Remove obsolete TRACKER system role if present
      DELETE FROM custom_roles WHERE UPPER(name) = 'TRACKER' OR UPPER(system_role) = 'TRACKER';

      -- 2. Create role_permissions table
      CREATE TABLE IF NOT EXISTS role_permissions (
        role_id       UUID NOT NULL REFERENCES custom_roles(id) ON DELETE CASCADE,
        permission    VARCHAR(100) NOT NULL,
        PRIMARY KEY (role_id, permission)
      );

      -- 3. Create users table
      CREATE TABLE IF NOT EXISTS users (
        id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id     UUID NOT NULL DEFAULT '${DEFAULT_TENANT_ID}',
        keycloak_id   VARCHAR(255) UNIQUE,
        email         VARCHAR(255) NOT NULL UNIQUE,
        full_name     VARCHAR(255) NOT NULL,
        password_hash VARCHAR(512),
        salt          VARCHAR(128),
        roles         TEXT[] NOT NULL DEFAULT '{}',
        is_active     BOOLEAN NOT NULL DEFAULT true,
        is_approved   BOOLEAN NOT NULL DEFAULT true,
        profile_picture TEXT,
        created_at    TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at    TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );

      -- 4. Add role_id to users if not exists
      ALTER TABLE users ADD COLUMN IF NOT EXISTS role_id UUID REFERENCES custom_roles(id) ON DELETE SET NULL;

      -- Ensure is_approved column exists on older tables
      ALTER TABLE users ADD COLUMN IF NOT EXISTS is_approved BOOLEAN NOT NULL DEFAULT true;

      -- Add branch_id, assigned_branch_ids, branch_roles and business_unit_id to users
      ALTER TABLE users ADD COLUMN IF NOT EXISTS branch_id UUID REFERENCES branches(id) ON DELETE SET NULL;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS assigned_branch_ids UUID[] DEFAULT '{}';
      ALTER TABLE users ADD COLUMN IF NOT EXISTS branch_roles JSONB DEFAULT '{}';
      ALTER TABLE users ADD COLUMN IF NOT EXISTS business_unit_id UUID REFERENCES business_units(id) ON DELETE SET NULL;

      -- Update any existing users with null value to true
      UPDATE users SET is_approved = true WHERE is_approved IS NULL;

      -- Auto-approve active users belonging to active company tenants
      UPDATE users u
      SET is_approved = true
      FROM tenants t
      WHERE u.tenant_id = t.id
        AND t.status = 'ACTIVE'
        AND u.is_active = true
        AND u.is_approved = false;

      -- Ensure job_assignment_mode and job_assignment_options exist on tenants
      ALTER TABLE tenants ADD COLUMN IF NOT EXISTS job_assignment_mode VARCHAR(50) DEFAULT 'AUTO';
      ALTER TABLE tenants ADD COLUMN IF NOT EXISTS job_assignment_options JSONB DEFAULT '{"allowAuto":true,"allowAll":true,"allowUnassigned":true,"allowedPodIds":[]}';

      -- Compulsory Default HQ Branch Creation for Tenants without branches
      INSERT INTO branches (id, tenant_id, name, code, market)
      SELECT gen_random_uuid(), t.id, t.name || ' Headquarters', 'HQ01', COALESCE(t.default_market, 'US')
      FROM tenants t
      WHERE NOT EXISTS (SELECT 1 FROM branches b WHERE b.tenant_id = t.id);

      -- Compulsorily assign any unassigned users to their tenant's primary branch
      UPDATE users u
      SET branch_id = (
        SELECT id FROM branches b
        WHERE b.tenant_id = u.tenant_id
        ORDER BY CASE WHEN b.name ILIKE '%bbsr%' OR b.name ILIKE '%domestic%' THEN 1 ELSE 2 END, b.created_at ASC
        LIMIT 1
      )
      WHERE u.branch_id IS NULL;

      -- Auto-backfill assigned_branch_ids array with branch_id if empty
      UPDATE users SET assigned_branch_ids = ARRAY[branch_id] WHERE branch_id IS NOT NULL AND (assigned_branch_ids IS NULL OR cardinality(assigned_branch_ids) = 0);
    `;
    try {
      await this.db.query(ddl);
      this.logger.log('Users, default compulsory branches, and branch user assignments auto-resolved.');
    } catch (err) {
      this.logger.error(`Failed to create users/RBAC tables: ${err.message}`);
    }
  }

  private async seedDefaultUsers() {
    // ─── Platform SUPER_ADMIN — credentials come from .env, never from source code ───
    const adminEmail    = process.env.PLATFORM_ADMIN_EMAIL;
    const adminPassword = process.env.PLATFORM_ADMIN_PASSWORD;
    const adminName     = process.env.PLATFORM_ADMIN_NAME || 'Enfy Super Admin';

    if (!adminEmail || !adminPassword) {
      this.logger.warn(
        '⚠️  PLATFORM_ADMIN_EMAIL or PLATFORM_ADMIN_PASSWORD not set in .env — skipping SUPER_ADMIN seed.',
      );
      return;
    }

    try {
      // Seed roles first for master tenant
      const roleMap = await this.seedTenantRoles(DEFAULT_TENANT_ID);
      const superAdminRoleId = roleMap['SUPER_ADMIN'];

      const exists = await this.db.query(
        'SELECT id, roles FROM users WHERE email = $1 LIMIT 1',
        [adminEmail],
      );

      if (exists.rows.length > 0) {
        const user = exists.rows[0];
        const roles = user.roles || [];
        if (!roles.includes('SUPER_ADMIN')) {
          this.logger.log(`Updating existing user ${adminEmail} to have SUPER_ADMIN role.`);
          await this.db.query(
            `UPDATE users SET roles = array_append(roles, 'SUPER_ADMIN'), is_approved = true, is_active = true, role_id = $1 WHERE id = $2`,
            [superAdminRoleId, user.id],
          );
        } else {
          await this.db.query(
            `UPDATE users SET is_approved = true, is_active = true, role_id = $1 WHERE id = $2`,
            [superAdminRoleId, user.id],
          );
        }
        this.logger.log(`✅ Platform SUPER_ADMIN already exists in DB (${adminEmail}) — skipping seed.`);
        return;
      }

      // First boot only: create the platform super admin
      const { hash, salt } = this.hashPassword(adminPassword);
      await this.db.query(
        `INSERT INTO users (tenant_id, email, full_name, password_hash, salt, roles, is_active, is_approved, role_id)
         VALUES ($1, $2, $3, $4, $5, $6, true, true, $7)`,
        [DEFAULT_TENANT_ID, adminEmail, adminName, hash, salt, ['SUPER_ADMIN'], superAdminRoleId],
      );
      this.logger.log(`🚀 Platform SUPER_ADMIN created: ${adminEmail}`);
    } catch (err) {
      this.logger.warn(`Could not seed SUPER_ADMIN: ${err.message}`);
    }
  }

  // ─────────────────────────────────────────────────────────────
  // LOGIN IMPLEMENTATION (Supports both Mock mode and Keycloak mode)
  // ─────────────────────────────────────────────────────────────
  async login(dto: LoginDto) {
    this.logger.log(`Login attempt for ${dto.email} [Provider: Keycloak]`);

    const result = await this.db.query(
      `SELECT u.id, u.email, u.full_name, u.password_hash, u.salt, u.roles, u.is_active, u.is_approved, u.tenant_id, u.role_id, u.pod_id, u.branch_id, u.assigned_branch_ids, u.branch_roles, u.business_unit_id, t.default_market, t.domain as tenant_domain, t.status as tenant_status, t.pod_system_enabled, cr.system_role, b.name as branch_name, bu.name as business_unit_name
       FROM users u
       LEFT JOIN tenants t ON u.tenant_id = t.id
       LEFT JOIN custom_roles cr ON u.role_id = cr.id
       LEFT JOIN branches b ON u.branch_id = b.id
       LEFT JOIN business_units bu ON u.business_unit_id = bu.id
       WHERE u.email = $1 LIMIT 1`,
      [dto.email],
    );

    if (result.rows.length === 0) {
      throw new UnauthorizedException('Invalid email or password.');
    }

    const user = result.rows[0];

    // Enforce tenant active status check
    if (user.tenant_status && user.tenant_status !== 'ACTIVE') {
      throw new UnauthorizedException(
        'Your company workspace is inactive. Contact the platform administrator.',
      );
    }

    // Check if user is active/approved
    if (!user.is_active) {
      throw new UnauthorizedException(
        'Your account has been deactivated. Contact your administrator.',
      );
    }

    if (!user.is_approved) {
      if (user.tenant_status === 'ACTIVE') {
        this.logger.log(`Auto-approving active user ${user.email} in active tenant workspace (${user.tenant_id})`);
        await this.db.query('UPDATE users SET is_approved = true WHERE id = $1', [user.id]);
        user.is_approved = true;
      } else {
        throw new UnauthorizedException(
          'Your account is pending approval by the administrator.',
        );
      }
    }

    // Enforce Tenant Auth Settings Policy
    const policy = await this.getTenantAuthPolicy(user.tenant_id);
    if (policy.enforceSsoOnly || !policy.allowPasswordLogin) {
      throw new UnauthorizedException('Password login is disabled by your organization administrator. Please sign in using Single Sign-On (SSO).');
    }

    if (policy.allowedEmailDomains && policy.allowedEmailDomains.length > 0) {
      const emailDomain = dto.email.split('@')[1]?.toLowerCase();
      if (!policy.allowedEmailDomains.map((d: string) => d.toLowerCase()).includes(emailDomain)) {
        throw new UnauthorizedException(`Logins with @${emailDomain} domain are not permitted for this organization.`);
      }
    }

    // Validate subdomain / custom domain context
    const isSuperAdmin = user.roles && user.roles.includes('SUPER_ADMIN');
    if (isSuperAdmin && dto.subdomain && dto.subdomain !== 'www' && dto.subdomain !== 'localhost' && dto.subdomain !== 'enfycon.com' && dto.subdomain !== 'enfyjobs.com') {
      throw new UnauthorizedException('Super Administrators can only log in from the main domain.');
    }

    if (!isSuperAdmin && dto.subdomain && dto.subdomain !== 'www' && dto.subdomain !== 'localhost' && dto.subdomain !== 'enfycon.com' && dto.subdomain !== 'enfyjobs.com') {
      const cleanSubdomain = dto.subdomain.split(':')[0].replace(/^https?:\/\//, '').trim().toLowerCase();
      const domainMapping = await this.db.query(
        `SELECT tenant_id FROM tenant_domains WHERE LOWER(TRIM(domain_name)) = $1 OR LOWER(TRIM(domain_name)) = $2
         UNION
         SELECT id as tenant_id FROM tenants WHERE LOWER(TRIM(domain)) = $1 OR LOWER(TRIM(domain || '.enfyjobs.com')) = $1
         LIMIT 1`,
        [cleanSubdomain, cleanSubdomain.replace(/^www\./, '')]
      );
      if (domainMapping.rows.length > 0) {
        const mappedTenantId = domainMapping.rows[0].tenant_id;
        if (user.tenant_id !== mappedTenantId) {
          throw new UnauthorizedException('User does not belong to this company workspace.');
        }
      } else {
        // Fallback: Check if cleanSubdomain matches the user tenant's slug
        const userTenant = await this.db.query('SELECT domain FROM tenants WHERE id = $1', [user.tenant_id]);
        if (userTenant.rows.length > 0) {
          const tenantSlug = (userTenant.rows[0].domain || '').toLowerCase().trim();
          if (cleanSubdomain === tenantSlug || cleanSubdomain === `${tenantSlug}.enfyjobs.com` || cleanSubdomain.startsWith(tenantSlug)) {
            // Valid match
          } else {
            throw new UnauthorizedException('Workspace not found.');
          }
        } else {
          throw new UnauthorizedException('Workspace not found.');
        }
      }
    }

    // Fetch dynamic permissions assigned to the custom role
    let permissions: string[] = [];
    if (user.role_id) {
      const permsResult = await this.db.query(
        'SELECT permission FROM role_permissions WHERE role_id = $1',
        [user.role_id]
      );
      permissions = permsResult.rows.map((row) => row.permission);
    }

    // Resolve systemRole
    let systemRole = user.system_role || 'RECRUITER';
    if (user.roles && user.roles.includes('SUPER_ADMIN')) {
      systemRole = 'SUPER_ADMIN';
    }

    // ── KEYCLOAK / DB HYBRID AUTHENTICATION ───────────────────
    let keycloakToken: string | null = null;
    let refreshToken: string | null = null;
    let expiresIn: number = 36000;

    // 1. Verify password against PostgreSQL DB hash if available
    let passwordValid = false;
    if (user.password_hash && user.salt) {
      const computedHash = this.hashPassword(dto.password, user.salt).hash;
      if (computedHash === user.password_hash) {
        passwordValid = true;
      }
    }

    // 2. Attempt Keycloak Direct Grant
    const issuer = process.env.KEYCLOAK_ISSUER || 'http://keycloak:8080/realms/enfycon-ats';
    const tokenUrl = `${issuer}/protocol/openid-connect/token`;
    const params = new URLSearchParams();
    params.append('grant_type', 'password');
    params.append('client_id', process.env.KEYCLOAK_CLIENT_ID || 'ats');
    if (process.env.KEYCLOAK_CLIENT_SECRET) {
      params.append('client_secret', process.env.KEYCLOAK_CLIENT_SECRET);
    }
    params.append('username', dto.email);
    params.append('password', dto.password);
    params.append('scope', 'openid');

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 2500);
      const res = await fetch(tokenUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params.toString(),
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      if (res.ok) {
        const tokenData = await res.json();
        keycloakToken = tokenData.access_token;
        refreshToken = tokenData.refresh_token;
        expiresIn = tokenData.expires_in || 36000;
        passwordValid = true;

        await this.syncKeycloakUser({
          keycloakId: user.id,
          email: user.email,
          fullName: user.full_name,
          roles: user.roles || [],
        }).catch(() => {});
      } else {
        this.logger.warn(`Keycloak direct grant returned status ${res.status} for ${dto.email}`);
      }
    } catch (kcErr: any) {
      this.logger.warn(`Keycloak direct grant connection note: ${kcErr.message}`);
    }

    // 3. If Keycloak did not issue a token, check DB password validity
    if (!keycloakToken) {
      if (!passwordValid) {
        throw new UnauthorizedException('Invalid email or password.');
      }

      // Password is valid in DB. Issue high-availability access token & trigger background Keycloak sync
      this.logger.log(`Password verified via database for ${dto.email}. Issuing access token & provisioning Keycloak user...`);
      const internalToken = this.signInternalToken(user);
      keycloakToken = internalToken.accessToken;
      expiresIn = internalToken.expiresIn;

      // Auto-provision user into Keycloak asynchronously
      this.provisionUserInKeycloak({
        email: user.email,
        password: dto.password,
        fullName: user.full_name,
        tenantId: user.tenant_id,
      }).catch((err) => {
        this.logger.warn(`Background Keycloak provisioning note: ${err.message}`);
      });
    }

    return {
      accessToken: keycloakToken,
      refreshToken: refreshToken || keycloakToken,
      expiresIn,
      tokenType: 'Bearer',
      user: {
        id: user.id,
        email: user.email,
        fullName: user.full_name,
        roles: user.roles || [],
        tenantId: user.tenant_id || DEFAULT_TENANT_ID,
        defaultMarket: user.default_market || 'US',
        tenantDomain: user.tenant_domain || '',
        permissions,
        systemRole,
        podId: user.pod_id || null,
        branchId: user.branch_id || null,
        assignedBranchIds: user.assigned_branch_ids && user.assigned_branch_ids.length > 0 ? user.assigned_branch_ids : (user.branch_id ? [user.branch_id] : []),
        branchRoles: user.branch_roles || {},
        branchName: user.branch_name || null,
        businessUnitId: user.business_unit_id || null,
        businessUnitName: user.business_unit_name || null,
        podSystemEnabled: user.pod_system_enabled ?? true,
      },
    };
  }

  // ─────────────────────────────────────────────────────────────
  // Refresh Token (Keycloak or Internal HS256)
  // ─────────────────────────────────────────────────────────────
  async refreshKeycloakToken(refreshToken: string) {
    if (!refreshToken) {
      throw new BadRequestException('Refresh token is required.');
    }

    // ── Detect token type from JWT header ──────────────────────
    // Internal HS256 tokens have no `kid` in the header.
    // Keycloak RS256 tokens always include `kid`.
    let isInternalToken = false;
    try {
      const parts = refreshToken.split('.');
      if (parts.length === 3) {
        const header = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
        if (!header.kid && header.alg === 'HS256') {
          isInternalToken = true;
        }
      }
    } catch {
      // Not a JWT — fall through to Keycloak path
    }

    // ── Internal HS256 refresh path ────────────────────────────
    // Verify signature (ignoring expiry), look up live user, re-issue token.
    if (isInternalToken) {
      this.logger.log('[Auth] Internal HS256 refresh requested.');
      const payload = this.verifyJwtIgnoreExpiry(refreshToken);
      if (!payload) {
        throw new UnauthorizedException('Invalid internal token signature.');
      }

      const userId = payload.sub || payload.id;
      if (!userId) {
        throw new UnauthorizedException('Token payload missing user identifier.');
      }

      const userResult = await this.db.query(
        `SELECT u.*, cr.system_role
         FROM users u
         LEFT JOIN custom_roles cr ON cr.id = u.role_id
         WHERE u.id = $1 LIMIT 1`,
        [userId],
      );
      if (!userResult.rows.length) {
        throw new UnauthorizedException('User not found.');
      }
      const user = userResult.rows[0];
      if (!user.is_active) {
        throw new UnauthorizedException('Your account has been deactivated.');
      }

      const freshToken = this.signInternalToken(user);
      this.logger.log(`[Auth] Re-issued internal token for user ${user.email}`);
      return {
        accessToken: freshToken.accessToken,
        refreshToken: freshToken.accessToken, // internal: refresh token = access token
        expiresIn: freshToken.expiresIn,
      };
    }

    // ── Keycloak RS256 refresh path ────────────────────────────
    const issuer = process.env.KEYCLOAK_ISSUER || 'http://keycloak:8080/realms/enfycon-ats';
    const tokenUrl = `${issuer}/protocol/openid-connect/token`;
    const params = new URLSearchParams();
    params.append('grant_type', 'refresh_token');
    params.append('client_id', process.env.KEYCLOAK_CLIENT_ID || 'ats-frontend');
    if (process.env.KEYCLOAK_CLIENT_SECRET) {
      params.append('client_secret', process.env.KEYCLOAK_CLIENT_SECRET);
    }
    params.append('refresh_token', refreshToken);

    let res = await fetch(tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    }).catch(() => null);

    if (!res || !res.ok) {
      const altUrl = tokenUrl.includes('localhost')
        ? tokenUrl.replace('localhost', 'keycloak')
        : tokenUrl.replace('keycloak', 'localhost');
      res = await fetch(altUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params.toString(),
      }).catch(() => null);
    }

    if (res && res.ok) {
      const tokenData = await res.json();
      return {
        accessToken: tokenData.access_token,
        refreshToken: tokenData.refresh_token,
        expiresIn: tokenData.expires_in,
      };
    }

    throw new UnauthorizedException('Invalid or expired refresh token.');
  }

  /**
   * Verify an HS256 JWT signature WITHOUT checking expiry.
   * Used solely for the internal token refresh flow.
   */
  verifyJwtIgnoreExpiry(token: string): any {
    try {
      const parts = token.split('.');
      if (parts.length !== 3) return null;
      const data = `${parts[0]}.${parts[1]}`;
      const expectedSig = crypto
        .createHmac('sha256', this.jwtSecret)
        .update(data)
        .digest('base64url');
      if (expectedSig !== parts[2]) return null;
      return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    } catch {
      return null;
    }
  }

  // ─────────────────────────────────────────────────────────────
  // MOCK MODE: Register new user
  // ─────────────────────────────────────────────────────────────
  async register(dto: RegisterDto, authHeader?: string) {
    const email = (dto.email || '').trim().toLowerCase();
    const fullName = (dto.fullName || '').trim();
    const password = dto.password;

    if (!email || !fullName || !password) {
      throw new BadRequestException('Email, full name, and password are required and cannot be empty.');
    }

    if (fullName.length < 2) {
      throw new BadRequestException('Full name must be at least 2 characters.');
    }

    const emailParts = email.split('@');
    if (emailParts.length !== 2 || !emailParts[0] || !emailParts[1]) {
      throw new BadRequestException('Invalid email address format.');
    }

    if (password.length < 8) {
      throw new BadRequestException('Password must be at least 8 characters.');
    }

    this.logger.log(`Registering user: ${email} [${dto.role}]`);

    const exists = await this.db.query(
      'SELECT id FROM users WHERE email = $1 LIMIT 1',
      [email],
    );
    if (exists.rows.length > 0) {
      throw new ConflictException(
        `Email ${email} is already registered.`,
      );
    }

    const role = dto.role?.toUpperCase() || 'RECRUITER';
    if (role === 'SUPER_ADMIN') {
      throw new ForbiddenException('Registering with SUPER_ADMIN role is not allowed.');
    }
    let tenantId = dto.tenantId || DEFAULT_TENANT_ID;

    // Verify if requester is a tenant admin or super admin (supports both Mock and Keycloak tokens)
    const requester = await this.getRequesterInfoFromToken(authHeader);
    const requesterRoles = requester.roles;
    const requesterIsAdmin = requester.isAdmin;
    const requesterTenantId = requester.tenantId;

    // Force tenant ID to requester's tenant ID for tenant admins to prevent cross-tenant registration spoofing
    if (requesterIsAdmin && !requesterRoles.includes('SUPER_ADMIN') && requesterTenantId) {
      tenantId = requesterTenantId;
    }

    // Force isApproved to false unless requester is an admin in the SAME tenant (or a SUPER_ADMIN)
    // Tenant Admins are auto-approved instantly and bypass the platform approvals panel.
    let isApproved = false;
    if (requesterIsAdmin) {
      if (requesterRoles.includes('SUPER_ADMIN')) {
        isApproved = dto.isApproved !== undefined ? dto.isApproved : true;
      } else if (requesterTenantId === tenantId) {
        isApproved = true;
      }
    }

    // Validate email domain suffix matches tenant domain name (except for SUPER_ADMIN)
    if (!requesterRoles.includes('SUPER_ADMIN')) {
      const tenantRes = await this.db.query('SELECT domain FROM tenants WHERE id = $1 LIMIT 1', [tenantId]);
      if (tenantRes.rows.length > 0) {
        const tenantDomain = tenantRes.rows[0].domain || '';
        // Sanitize the domain: strip trailing .com if it already ends in .com
        const cleanDomain = tenantDomain.toLowerCase().endsWith('.com')
          ? tenantDomain.slice(0, -4)
          : tenantDomain;
        const expectedDomain = `@${cleanDomain}.com`.toLowerCase();
        if (!email.endsWith(expectedDomain)) {
          throw new BadRequestException(`Email address must end with the company domain: ${expectedDomain}`);
        }
      }
    }

    if (isApproved) {
      await this.checkSeatLimit(tenantId);
    }

    // Find the dynamic role ID corresponding to the requested role name
    let roleId = null;
    const roleResult = await this.db.query(
      'SELECT id FROM custom_roles WHERE tenant_id = $1 AND UPPER(name) = $2 LIMIT 1',
      [tenantId, role]
    );
    if (roleResult.rows.length > 0) {
      roleId = roleResult.rows[0].id;
    }

    const { hash, salt } = this.hashPassword(password);

    // If direct invite, user starts as active & approved immediately. Else pending.
    const result = await this.db.query(
      `INSERT INTO users (tenant_id, email, full_name, password_hash, salt, roles, is_active, is_approved, role_id)
       VALUES ($1, $2, $3, $4, $5, $6, true, $7, $8)
       RETURNING id, email, full_name, roles, tenant_id, created_at, role_id`,
      [tenantId, email, fullName, hash, salt, [role], isApproved, roleId],
    );

    const user = result.rows[0];

    await this.provisionUserInKeycloak({
      email: user.email,
      password: password,
      fullName: user.full_name,
      tenantId: user.tenant_id,
    });

    // Dispatch welcome email with credentials and login guide
    if (dto.sendEmailInvite !== false) {
      this.db.query('SELECT name, domain FROM tenants WHERE id = $1 LIMIT 1', [tenantId])
        .then((tRes) => {
          const tenantName = tRes.rows[0]?.name || 'Enfycon Workspace';
          const tenantDomain = tRes.rows[0]?.domain || '';
          return this.sendMemberCredentialsEmail({
            to: email,
            fullName,
            tenantName,
            subdomain: tenantDomain,
            tenantId,
            temporaryPassword: password,
            roleName: role,
          });
        })
        .catch((err) => {
          this.logger.warn(`Failed to dispatch member credentials email to ${email}: ${err.message}`);
        });
    }

    return {
      message: isApproved 
        ? 'User registered and approved successfully.'
        : 'User registered successfully. Pending administrator approval.',
      user: {
        id: user.id,
        email: user.email,
        fullName: user.full_name,
        roles: user.roles,
        tenantId: user.tenant_id,
        createdAt: user.created_at,
      },
    };
  }

  // ─────────────────────────────────────────────────────────────
  // SAAS TENANT SELF-REGISTRATION
  // Creates a new tenant + first admin user, both pending approval
  // ─────────────────────────────────────────────────────────────
  async registerTenant(dto: RegisterTenantDto) {
    const companyName = (dto.companyName || '').trim();
    const email = (dto.email || '').trim().toLowerCase();
    const fullName = (dto.fullName || '').trim();
    const password = dto.password;

    if (!companyName || !email || !fullName || !password) {
      throw new BadRequestException('All fields (company name, email, full name, password) are required.');
    }

    if (companyName.length < 2) {
      throw new BadRequestException('Company name must be at least 2 characters.');
    }

    if (fullName.length < 2) {
      throw new BadRequestException('Full name must be at least 2 characters.');
    }

    const emailParts = email.split('@');
    if (emailParts.length !== 2 || !emailParts[0] || !emailParts[1]) {
      throw new BadRequestException('Invalid email address format.');
    }

    if (password.length < 8) {
      throw new BadRequestException('Password must be at least 8 characters.');
    }

    this.logger.log(`New tenant registration: ${companyName} [${dto.subdomain}] by ${email}`);

    // 1. Validate subdomain format
    if (!dto.subdomain || !/^[a-z0-9-]+$/.test(dto.subdomain)) {
      throw new BadRequestException('Subdomain must contain only lowercase letters, numbers, and hyphens.');
    }

    // 2. Check subdomain uniqueness
    const subdomainExists = await this.db.query(
      'SELECT id FROM tenants WHERE domain = $1 UNION SELECT tenant_id as id FROM tenant_domains WHERE domain_name = $1 LIMIT 1',
      [dto.subdomain],
    );
    if (subdomainExists.rows.length > 0) {
      throw new ConflictException(`Subdomain "${dto.subdomain}" is already taken. Please choose another.`);
    }

    // 3. Check email uniqueness
    const emailExists = await this.db.query(
      'SELECT id FROM users WHERE email = $1 LIMIT 1',
      [email],
    );
    if (emailExists.rows.length > 0) {
      throw new ConflictException(`Email "${email}" is already registered.`);
    }

    // 3.5 Generate prefix code from company name
    let basePrefix = companyName.replace(/[^a-zA-Z0-9]/g, '').substring(0, 4).toUpperCase();
    if (basePrefix.length < 2) basePrefix = 'COMP';
    
    // Check uniqueness of prefix, append number if needed
    let prefixCode = basePrefix;
    let counter = 1;
    while (true) {
      const prefixExists = await this.db.query('SELECT id FROM tenants WHERE prefix_code = $1 LIMIT 1', [prefixCode]);
      if (prefixExists.rows.length === 0) break;
      prefixCode = `${basePrefix.substring(0, 3)}${counter}`;
      counter++;
    }

    // 4. Create the new tenant (status = PENDING until admin approves)
    const tenantResult = await this.db.query(
      `INSERT INTO tenants (name, domain, status, default_market, prefix_code)
       VALUES ($1, $2, 'PENDING', 'US', $3)
       RETURNING id, name, domain, status, prefix_code`,
      [companyName, dto.subdomain, prefixCode],
    );
    const tenant = tenantResult.rows[0];

    // Map default subdomain in tenant_domains
    await this.db.query(
      `INSERT INTO tenant_domains (tenant_id, domain_name, is_primary)
       VALUES ($1, $2, TRUE)`,
      [tenant.id, dto.subdomain]
    );

    // 5. Seed the default custom roles & permissions for this new company tenant
    const roleMap = await this.seedTenantRoles(tenant.id);
    const adminRoleId = roleMap['ADMIN'];

    // 6. Create the first admin user for this tenant (is_approved = false)
    const { hash, salt } = this.hashPassword(password);
    const userResult = await this.db.query(
      `INSERT INTO users (tenant_id, email, full_name, password_hash, salt, roles, is_active, is_approved, role_id)
       VALUES ($1, $2, $3, $4, $5, $6, true, false, $7)
       RETURNING id, email, full_name, roles, tenant_id, created_at, role_id`,
      [tenant.id, email, fullName, hash, salt, ['ADMIN'], adminRoleId],
    );
    const user = userResult.rows[0];

    await this.provisionUserInKeycloak({
      email: user.email,
      password: password,
      fullName: user.full_name,
      tenantId: tenant.id,
    });

    const baseDomain = process.env.BASE_DOMAIN || 'enfyjobs.com';
    return {
      message: 'Company registered successfully! Your account is pending platform administrator approval. You will be notified once approved.',
      tenant: {
        id: tenant.id,
        name: tenant.name,
        subdomain: tenant.domain,
        workspaceUrl: `${tenant.domain}.${baseDomain}`,
        status: tenant.status,
      },
      user: {
        id: user.id,
        email: user.email,
        fullName: user.full_name,
        roles: user.roles,
        tenantId: user.tenant_id,
        createdAt: user.created_at,
      },
    };
  }

  // ─────────────────────────────────────────────────────────────
  // KEYCLOAK ADMIN HELPERS: Auto-provisioning users into Keycloak
  // ─────────────────────────────────────────────────────────────
  private async getKeycloakAdminToken(): Promise<string | null> {
    const issuer = process.env.KEYCLOAK_ISSUER || 'http://localhost:8080/realms/enfycon-ats';
    const baseUrl = issuer.split('/realms/')[0];
    const adminUser = process.env.KEYCLOAK_ADMIN || 'admin';
    const adminPass = process.env.KEYCLOAK_ADMIN_PASSWORD || 'admin';

    const tokenEndpoints = [
      `${baseUrl}/realms/master/protocol/openid-connect/token`,
      `${baseUrl.includes('localhost') ? baseUrl.replace('localhost', 'keycloak') : baseUrl.replace('keycloak', 'localhost')}/realms/master/protocol/openid-connect/token`,
    ];

    for (const url of tokenEndpoints) {
      try {
        const params = new URLSearchParams();
        params.append('grant_type', 'password');
        params.append('client_id', 'admin-cli');
        params.append('username', adminUser);
        params.append('password', adminPass);

        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: params.toString(),
        });
        if (res.ok) {
          const data = await res.json();
          return data.access_token;
        }
      } catch (err) {
        // Continue to fallback endpoint
      }
    }
    return null;
  }

  async provisionUserInKeycloak(data: { email: string; password?: string; fullName?: string; tenantId?: string }): Promise<boolean> {
    try {
      const adminToken = await this.getKeycloakAdminToken();
      if (!adminToken) {
        this.logger.warn(`Could not obtain Keycloak admin token to provision ${data.email}`);
        return false;
      }

      const issuer = process.env.KEYCLOAK_ISSUER || 'http://localhost:8080/realms/enfycon-ats';
      const realm = issuer.split('/realms/')[1] || 'enfycon-ats';
      const baseUrl = issuer.split('/realms/')[0];

      const nameParts = (data.fullName || data.email).trim().split(' ');
      const firstName = nameParts[0] || 'User';
      const lastName = nameParts.slice(1).join(' ') || 'User';

      const userPayload: any = {
        username: data.email,
        email: data.email,
        enabled: true,
        emailVerified: true,
        firstName,
        lastName,
        attributes: {
          tenant_id: [data.tenantId || DEFAULT_TENANT_ID],
        },
      };

      if (data.password) {
        userPayload.credentials = [
          {
            type: 'password',
            value: data.password,
            temporary: false,
          },
        ];
      }

      const targetEndpoints = [
        `${baseUrl}/admin/realms/${realm}/users`,
        `${baseUrl.includes('localhost') ? baseUrl.replace('localhost', 'keycloak') : baseUrl.replace('keycloak', 'localhost')}/admin/realms/${realm}/users`,
      ];

      for (const url of targetEndpoints) {
        try {
          const res = await fetch(url, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${adminToken}`,
            },
            body: JSON.stringify(userPayload),
          });

          if (res.ok) {
            this.logger.log(`Keycloak user ${data.email} provisioned in realm ${realm}`);
            return true;
          }

          if (res.status === 409) {
            // User already exists in Keycloak — sync password if provided
            if (data.password) {
              const searchUrl = url.replace('/users', `/users?email=${encodeURIComponent(data.email)}`);
              const searchRes = await fetch(searchUrl, {
                headers: { 'Authorization': `Bearer ${adminToken}` },
              });
              if (searchRes.ok) {
                const usersList = await searchRes.json();
                if (Array.isArray(usersList) && usersList.length > 0) {
                  const kcUserId = usersList[0].id;
                  const resetUrl = url.replace('/users', `/users/${kcUserId}/reset-password`);
                  await fetch(resetUrl, {
                    method: 'PUT',
                    headers: {
                      'Content-Type': 'application/json',
                      'Authorization': `Bearer ${adminToken}`,
                    },
                    body: JSON.stringify({
                      type: 'password',
                      value: data.password,
                      temporary: false,
                    }),
                  });
                  this.logger.log(`Keycloak user ${data.email} password updated/synced in realm ${realm}`);
                }
              }
            }
            return true;
          }
        } catch (err) {
          // Continue to next endpoint
        }
      }
      return false;
    } catch (err: any) {
      this.logger.error(`Failed to provision user ${data.email} in Keycloak: ${err.message}`);
      return false;
    }
  }

  // ─────────────────────────────────────────────────────────────
  // KEYCLOAK MODE: On-demand user sync from JWT claims
  // Called by JwtAuthGuard after signature verification
  // ─────────────────────────────────────────────────────────────
  async syncKeycloakUser(data: {
    keycloakId: string;
    email: string;
    fullName: string;
    roles: string[];
  }) {
    this.logger.debug(`Syncing Keycloak user: ${data.email}`);

    const normalizedRoles = data.roles
      .map((r) => r.toUpperCase().replace(/[\s-]/g, '_'))
      .filter((r) => r.length > 0);

    // Preserve internal roles that Keycloak doesn't manage
    const existing = await this.db.query(
      'SELECT id, roles, tenant_id, is_active, role_id FROM users WHERE keycloak_id = $1 OR email = $2 LIMIT 1',
      [data.keycloakId, data.email],
    );

    const existingRoles = existing.rows.length > 0 ? (existing.rows[0].roles || []) : [];

    let tenantId = existing.rows.length > 0
      ? existing.rows[0].tenant_id
      : DEFAULT_TENANT_ID;

    // Union existing DB roles with Keycloak JWT roles so PostgreSQL roles are never erased
    let mergedRoles = Array.from(new Set([...existingRoles, ...normalizedRoles]));

    // Platform Super Admin email from .env ALWAYS retains SUPER_ADMIN role & Master Tenant
    const platformAdminEmail = process.env.PLATFORM_ADMIN_EMAIL ? process.env.PLATFORM_ADMIN_EMAIL.toLowerCase() : null;
    const isPlatformAdmin = platformAdminEmail && data.email.toLowerCase() === platformAdminEmail;
    if (isPlatformAdmin || normalizedRoles.includes('SUPER_ADMIN') || existingRoles.includes('SUPER_ADMIN')) {
      if (!mergedRoles.includes('SUPER_ADMIN')) {
        mergedRoles.push('SUPER_ADMIN');
      }
      tenantId = DEFAULT_TENANT_ID;
    } else if (tenantId !== DEFAULT_TENANT_ID) {
      mergedRoles = mergedRoles.filter(r => r !== 'SUPER_ADMIN');
    }

    // Synchronize Keycloak role name to dynamic custom role ID
    let roleId = existing.rows.length > 0 ? existing.rows[0].role_id : null;
    if (!roleId && mergedRoles.length > 0) {
      const primaryRole = mergedRoles.includes('ADMIN') ? 'ADMIN' : mergedRoles[0];
      const roleResult = await this.db.query(
        'SELECT id FROM custom_roles WHERE tenant_id = $1 AND UPPER(name) = $2 LIMIT 1',
        [tenantId, primaryRole]
      );
      if (roleResult.rows.length > 0) {
        roleId = roleResult.rows[0].id;
      }
    }

    let dbUser: any;
    if (existing.rows.length > 0) {
      const existingUser = existing.rows[0];
      const updateRes = await this.db.query(
        `UPDATE users
         SET keycloak_id = $1,
             full_name   = COALESCE($2, full_name),
             roles       = $3,
             role_id     = COALESCE(users.role_id, $4),
             updated_at  = NOW()
         WHERE id = $5
         RETURNING id, email, full_name, roles, tenant_id, is_active, role_id`,
        [data.keycloakId, data.fullName, mergedRoles, roleId, existingUser.id],
      );
      dbUser = updateRes.rows[0];
    } else {
      const insertRes = await this.db.query(
        `INSERT INTO users (keycloak_id, tenant_id, email, full_name, roles, is_active, is_approved, role_id)
         VALUES ($1, $2, $3, $4, $5, true, true, $6)
         RETURNING id, email, full_name, roles, tenant_id, is_active, role_id`,
        [data.keycloakId, tenantId, data.email, data.fullName, mergedRoles, roleId],
      );
      dbUser = insertRes.rows[0];
    }

    // Load custom role permissions dynamically across assigned role ID and all user roles
    let permissions: string[] = [];
    const roleNamesUpper = (dbUser.roles || []).map((r: string) => r.toUpperCase());
    const permsRes = await this.db.query(
      `SELECT DISTINCT rp.permission 
       FROM custom_roles cr
       JOIN role_permissions rp ON rp.role_id = cr.id
       WHERE (cr.tenant_id = $1 OR cr.tenant_id IS NULL) 
         AND (cr.id = $2 OR UPPER(cr.name) = ANY($3) OR UPPER(cr.system_role) = ANY($3))`,
      [dbUser.tenant_id || DEFAULT_TENANT_ID, dbUser.role_id || null, roleNamesUpper]
    );
    permissions = permsRes.rows.map(row => row.permission);

    return {
      ...dbUser,
      permissions
    };
  }

  // ─────────────────────────────────────────────────────────────
  async getProfile(userId: string) {
    // Ensure columns exist on tenants table
    await this.db.query(`
      ALTER TABLE tenants ADD COLUMN IF NOT EXISTS job_assignment_mode VARCHAR(50) DEFAULT 'AUTO';
      ALTER TABLE tenants ADD COLUMN IF NOT EXISTS job_assignment_options JSONB DEFAULT '{"allowAuto":true,"allowAll":true,"allowUnassigned":true,"allowedPodIds":[]}';
    `).catch(() => {});

    const result = await this.db.query(
      `SELECT u.id, u.email, u.full_name, u.roles, u.tenant_id, u.is_active, u.created_at, u.updated_at, u.role_id, u.pod_id, u.branch_id, u.assigned_branch_ids, u.branch_roles, u.business_unit_id, t.name as tenant_name, t.default_market, t.domain as tenant_domain, t.user_limit as user_limit, t.pod_system_enabled, t.candidate_pool_mode, t.job_assignment_mode, t.job_assignment_options, b.name as branch_name, bu.name as business_unit_name
       FROM users u
       LEFT JOIN tenants t ON u.tenant_id = t.id
       LEFT JOIN branches b ON u.branch_id = b.id
       LEFT JOIN business_units bu ON u.business_unit_id = bu.id
       WHERE u.id = $1 LIMIT 1`,
      [userId],
    );
    if (result.rows.length === 0) {
      throw new NotFoundException('User profile not found.');
    }
    const u = result.rows[0];

    // Load custom role details and permissions
    let roleName = u.roles[0] || 'RECRUITER';
    let systemRole = 'RECRUITER';
    if (u.roles && u.roles.includes('SUPER_ADMIN')) {
      systemRole = 'SUPER_ADMIN';
    }
    let permissions: string[] = [];
    const rolesArray: string[] = Array.isArray(u.roles) ? u.roles : (u.roles ? [u.roles] : []);

    // 1. Fetch permissions for custom roles linked via role_id or matching role names in u.roles
    const permsRes = await this.db.query(
      `SELECT DISTINCT rp.permission
       FROM role_permissions rp
       JOIN custom_roles cr ON cr.id = rp.role_id
       WHERE cr.tenant_id = $1
         AND (
           cr.id = $2
           OR cr.name = ANY($3::text[])
           OR UPPER(cr.name) = ANY(ARRAY(SELECT UPPER(x) FROM unnest($3::text[]) x))
         )`,
      [u.tenant_id, u.role_id, rolesArray]
    ).catch(() => ({ rows: [] }));

    if (permsRes.rows.length > 0) {
      permissions = permsRes.rows.map(row => row.permission);
    }

    if (u.role_id) {
      const roleRes = await this.db.query(
        'SELECT name, system_role FROM custom_roles WHERE id = $1 LIMIT 1',
        [u.role_id]
      );
      if (roleRes.rows.length > 0) {
        roleName = roleRes.rows[0].name;
        systemRole = roleRes.rows[0].system_role || systemRole;
      }
    } else if (rolesArray.length > 0) {
      const roleRes = await this.db.query(
        'SELECT id, name, system_role FROM custom_roles WHERE tenant_id = $1 AND (name = ANY($2::text[]) OR UPPER(name) = ANY(ARRAY(SELECT UPPER(x) FROM unnest($2::text[]) x))) LIMIT 1',
        [u.tenant_id, rolesArray]
      );
      if (roleRes.rows.length > 0) {
        roleName = roleRes.rows[0].name;
        systemRole = roleRes.rows[0].system_role || systemRole;
      }
    }

    return {
      id: u.id,
      email: u.email,
      fullName: u.full_name,
      roles: u.roles,
      roleId: u.role_id,
      roleName,
      systemRole,
      permissions,
      tenantId: u.tenant_id,
      isActive: u.is_active,
      createdAt: u.created_at,
      defaultMarket: u.default_market || 'US',
      tenantDomain: u.tenant_domain || '',
      userLimit: u.user_limit || 5,
      podId: u.pod_id,
      branchId: u.branch_id,
      assignedBranchIds: u.assigned_branch_ids && u.assigned_branch_ids.length > 0 ? u.assigned_branch_ids : (u.branch_id ? [u.branch_id] : []),
      branchRoles: u.branch_roles || {},
      branchName: u.branch_name || null,
      businessUnitId: u.business_unit_id,
      businessUnitName: u.business_unit_name || null,
      podSystemEnabled: u.pod_system_enabled !== false,
      candidatePoolMode: u.candidate_pool_mode || 'COMBINED_MARKET',
      jobAssignmentMode: u.job_assignment_mode || 'AUTO',
      jobAssignmentOptions: u.job_assignment_options || { allowAuto: true, allowAll: true, allowUnassigned: true, allowedPodIds: [] },
      tenant: {
        name: u.tenant_name || '',
        domain: u.tenant_domain || '',
      },
    };
  }

  // ─────────────────────────────────────────────────────────────
  // List all users (admin utility)
  // ─────────────────────────────────────────────────────────────
  async listUsers(tenantId: string) {
    const result = await this.db.query(
      `SELECT u.id, u.email, u.full_name, u.roles, u.is_active, u.is_approved, u.created_at, u.role_id, u.pod_id, u.branch_id, u.assigned_branch_ids, u.branch_roles, u.business_unit_id, r.name as role_name, b.name as branch_name, bu.name as business_unit_name
       FROM users u 
       LEFT JOIN custom_roles r ON u.role_id = r.id
       LEFT JOIN branches b ON u.branch_id = b.id
       LEFT JOIN business_units bu ON u.business_unit_id = bu.id
       WHERE u.tenant_id = $1 ORDER BY u.full_name ASC`,
      [tenantId],
    );

    // Fetch active valid role names for this tenant to exclude deleted custom roles
    const validRolesRes = await this.db.query(
      `SELECT name FROM custom_roles WHERE tenant_id = $1`,
      [tenantId]
    );

    const SYSTEM_ROLES = [
      "SUPER_ADMIN", "ADMIN", "TENANT_ADMIN", "ACCOUNT_MANAGER",
      "POD_LEAD", "DELIVERY_HEAD", "RECRUITER", "BRANCH_ADMIN"
    ];

    const validRoleNames = new Set([
      ...SYSTEM_ROLES,
      ...validRolesRes.rows.map(r => r.name.toUpperCase())
    ]);

    return result.rows.map((u) => {
      const rawRoles = Array.isArray(u.roles) ? u.roles : [];
      const filteredRoles = rawRoles.filter(rName => validRoleNames.has(rName.toUpperCase()));
      const primaryRole = u.role_name || filteredRoles[0] || 'RECRUITER';

      return {
        id: u.id,
        email: u.email,
        fullName: u.full_name,
        roles: filteredRoles.length > 0 ? filteredRoles : [primaryRole],
        roleId: u.role_id,
        roleName: primaryRole,
        isActive: u.is_active,
        isApproved: u.is_approved,
        createdAt: u.created_at,
        podId: u.pod_id,
        branchId: u.branch_id,
        assignedBranchIds: u.assigned_branch_ids && u.assigned_branch_ids.length > 0 ? u.assigned_branch_ids : (u.branch_id ? [u.branch_id] : []),
        branchRoles: u.branch_roles || {},
        branchName: u.branch_name || null,
        businessUnitId: u.business_unit_id,
        businessUnitName: u.business_unit_name || null,
      };
    });
  }

  // ─────────────────────────────────────────────────────────────
  // Update user active status (admin utility)
  // ─────────────────────────────────────────────────────────────
  async setUserActive(userId: string, isActive: boolean, requesterId: string) {
    if (userId === requesterId && !isActive) {
      throw new BadRequestException('You cannot deactivate your own account.');
    }

    // Find the user's tenant ID, active, and approved status first
    const userRes = await this.db.query(
      'SELECT tenant_id, is_active, is_approved FROM users WHERE id = $1 LIMIT 1',
      [userId]
    );
    if (userRes.rows.length === 0) {
      throw new NotFoundException('User not found.');
    }
    const user = userRes.rows[0];

    if (isActive) {
      // If user is being transitioned to active, check seat limit first
      if (!user.is_active || !user.is_approved) {
        await this.checkSeatLimit(user.tenant_id);
      }
    } else {
      // Deactivating. Protect last admin lockout
      await this.verifyLastAdminProtection(user.tenant_id, userId, 'deactivate');
    }

    // Activating a user also approves them
    await this.db.query(
      `UPDATE users SET is_active = $1, is_approved = true, updated_at = NOW() WHERE id = $2`,
      [isActive, userId],
    );
    return { message: `User ${isActive ? 'activated' : 'deactivated'} successfully.` };
  }

  // ─────────────────────────────────────────────────────────────
  // Update user roles (admin utility)
  // ─────────────────────────────────────────────────────────────
  async updateUserRoles(userId: string, roles: string[], requesterRoles: string[]) {
    const normalized = roles.map((r) => r.toUpperCase());

    // Fetch target user details
    const userRes = await this.db.query(
      'SELECT tenant_id, roles FROM users WHERE id = $1 LIMIT 1',
      [userId]
    );
    if (userRes.rows.length === 0) {
      throw new NotFoundException('User not found.');
    }
    const targetUser = userRes.rows[0];
    const targetUserRoles = targetUser.roles || [];
    const tenantId = targetUser.tenant_id;

    // Block modifying SUPER_ADMIN user roles unless requester is SUPER_ADMIN
    if (targetUserRoles.includes('SUPER_ADMIN') && (!requesterRoles || !requesterRoles.includes('SUPER_ADMIN'))) {
      throw new ForbiddenException('You are not authorized to modify roles of a SUPER_ADMIN.');
    }

    // Block assigning SUPER_ADMIN unless requester has SUPER_ADMIN role
    if (normalized.includes('SUPER_ADMIN') && (!requesterRoles || !requesterRoles.includes('SUPER_ADMIN'))) {
      throw new ForbiddenException('You are not authorized to assign the SUPER_ADMIN role.');
    }

    // Demoting check: if new roles do not contain ADMIN, protect last admin lockout
    const isNewAdmin = normalized.includes('ADMIN');
    if (!isNewAdmin) {
      await this.verifyLastAdminProtection(tenantId, userId, 'demote');
    }

    // Find the custom role ID corresponding to any assigned custom role in the list
    let roleId = null;
    if (normalized.length > 0) {
      for (const r of normalized) {
        const roleResult = await this.db.query(
          'SELECT id FROM custom_roles WHERE tenant_id = $1 AND UPPER(name) = $2 LIMIT 1',
          [tenantId, r]
        );
        if (roleResult.rows.length > 0) {
          roleId = roleResult.rows[0].id;
          break;
        }
      }
    }

    await this.db.query(
      `UPDATE users SET roles = $1, role_id = $2, updated_at = NOW() WHERE id = $3`,
      [normalized, roleId, userId],
    );
    return { message: 'User roles updated successfully.', roles: normalized };
  }

  async updateUserDetails(
    userId: string,
    dto: { fullName?: string; email?: string; password?: string; branchId?: string; assignedBranchIds?: string[]; branchRoles?: Record<string, string[]>; businessUnitId?: string; roles?: string[] },
    requester: any
  ) {
    const userRes = await this.db.query('SELECT * FROM users WHERE id = $1 LIMIT 1', [userId]);
    if (userRes.rows.length === 0) {
      throw new NotFoundException('User not found.');
    }
    const user = userRes.rows[0];

    if (!requester.roles?.includes('SUPER_ADMIN') && user.tenant_id !== requester.tenantId) {
      throw new ForbiddenException('You are not authorized to update users in another company tenant.');
    }

    let fullName = user.full_name;
    let email = user.email;
    let hash = user.password_hash;
    let salt = user.salt;
    let branchId = user.branch_id;
    let businessUnitId = user.business_unit_id;

    if (dto.fullName && dto.fullName.trim().length >= 2) {
      fullName = dto.fullName.trim();
    }

    if (dto.email && dto.email.trim().toLowerCase() !== user.email) {
      const cleanEmail = dto.email.trim().toLowerCase();
      const dup = await this.db.query('SELECT id FROM users WHERE email = $1 AND id <> $2 LIMIT 1', [cleanEmail, userId]);
      if (dup.rows.length > 0) {
        throw new ConflictException(`Email ${cleanEmail} is already registered to another user.`);
      }
      email = cleanEmail;
    }

    if (dto.password && dto.password.length >= 8) {
      const pwdRes = this.hashPassword(dto.password);
      hash = pwdRes.hash;
      salt = pwdRes.salt;
    }

    let assignedBranchIds = user.assigned_branch_ids || [];
    let branchRoles = user.branch_roles || {};

    if (dto.branchId !== undefined) {
      branchId = dto.branchId || null;
    }

    if (dto.assignedBranchIds !== undefined) {
      assignedBranchIds = Array.isArray(dto.assignedBranchIds) ? dto.assignedBranchIds : [];
    }

    if (dto.branchRoles !== undefined) {
      branchRoles = dto.branchRoles || {};
    }

    if (branchId && !assignedBranchIds.includes(branchId)) {
      assignedBranchIds = Array.from(new Set([branchId, ...assignedBranchIds]));
    }

    if (dto.businessUnitId !== undefined) {
      businessUnitId = dto.businessUnitId || null;
    }

    await this.db.query(
      `UPDATE users
       SET full_name = $1, email = $2, password_hash = $3, salt = $4, branch_id = $5, assigned_branch_ids = $6, branch_roles = $7, business_unit_id = $8, updated_at = NOW()
       WHERE id = $9`,
      [fullName, email, hash, salt, branchId, assignedBranchIds, JSON.stringify(branchRoles), businessUnitId, userId]
    );

    if (dto.roles && Array.isArray(dto.roles) && dto.roles.length > 0) {
      await this.updateUserRoles(userId, dto.roles, requester.roles || []);
    }

    return this.getProfile(userId);
  }

  // ─────────────────────────────────────────────────────────────
  // ENTERPRISE GRANULAR RBAC CRUD & PERMISSIONS MANAGEMENT (Ceipal style)
  // ─────────────────────────────────────────────────────────────
  async seedTenantRoles(tenantId: string): Promise<Record<string, string>> {
    const DEFAULT_PERMISSIONS: Record<string, string[]> = {
      ADMIN: [
        'job:create', 'job:edit', 'job:view', 'job:assign', 'job:assign_recruiter', 'job:assign_pod',
        'candidate:create', 'candidate:view',
        'submission:create', 'submission:edit',
        'tenant:settings', 'user:manage',
        'pod:create', 'pod:edit', 'pod:delete', 'pod:view', 'pod:reset_cycle'
      ],
      BRANCH_ADMIN: [
        'job:view', 'job:edit', 'job:assign', 'job:assign_recruiter', 'job:assign_pod',
        'candidate:create', 'candidate:view',
        'submission:create', 'submission:view', 'submission:edit',
        'branch_admin:manage', 'user:manage', 'pod:view', 'pod:edit'
      ],
      RECRUITER: [
        'candidate:create', 'candidate:view',
        'submission:create', 'submission:view',
        'job:view',
        'pod:view'
      ],
      ACCOUNT_MANAGER: [
        'job:create', 'job:edit', 'job:view',
        'candidate:view', 'submission:view', 'submission:edit',
        'pod:view'
      ],
      DELIVERY_HEAD: [
        'job:view', 'job:edit', 'job:assign', 'job:assign_recruiter', 'job:assign_pod',
        'candidate:view', 'submission:view', 'submission:edit',
        'pod:create', 'pod:edit', 'pod:delete', 'pod:view', 'pod:reset_cycle'
      ],
      POD_LEAD: [
        'job:view', 'candidate:view', 'submission:view', 'submission:edit',
        'pod:view', 'job:edit'
      ]
    };

    // Only seed platform SUPER_ADMIN for the master/default tenant
    if (tenantId === DEFAULT_TENANT_ID) {
      DEFAULT_PERMISSIONS['SUPER_ADMIN'] = [
        'job:create', 'job:edit', 'job:view',
        'candidate:create', 'candidate:view',
        'submission:create', 'submission:edit',
        'tenant:settings', 'user:manage', 'platform:manage'
      ];
    }

    const roleMap: Record<string, string> = {};

    for (const [roleName, permissions] of Object.entries(DEFAULT_PERMISSIONS)) {
      // 1. Insert role
      const roleRes = await this.db.query(`
        INSERT INTO custom_roles (tenant_id, name, description, is_system, system_role)
        VALUES ($1, $2, $3, true, $4)
        ON CONFLICT (tenant_id, name) DO UPDATE SET system_role = EXCLUDED.system_role
        RETURNING id
      `, [
        tenantId,
        roleName,
        `Default system role for ${roleName.toLowerCase().replace('_', ' ')}s.`,
        roleName,
      ]);
      
      const roleId = roleRes.rows[0].id;
      roleMap[roleName] = roleId;

      // 2. Insert permissions
      await this.db.query('DELETE FROM role_permissions WHERE role_id = $1', [roleId]);
      for (const perm of permissions) {
        await this.db.query(`
          INSERT INTO role_permissions (role_id, permission)
          VALUES ($1, $2)
        `, [roleId, perm]);
      }
    }

    return roleMap;
  }

  async listRoles(tenantId: string) {
    let sql = 'SELECT id, name, description, is_system as "isSystem", system_role as "systemRole" FROM custom_roles WHERE tenant_id = $1';
    if (tenantId !== DEFAULT_TENANT_ID) {
      sql += " AND name <> 'SUPER_ADMIN'";
    }
    sql += ' ORDER BY name ASC';
    const rolesRes = await this.db.query(sql, [tenantId]);
    const roles = rolesRes.rows;

    const DEFAULT_PERMS: Record<string, string[]> = {
      ADMIN: [
        'job:create', 'job:edit', 'job:view', 'job:publish_direct', 'job:approve', 'job:reject',
        'job:assign', 'job:assign_recruiter', 'job:assign_pod',
        'candidate:create', 'candidate:view',
        'submission:view', 'submission:create', 'submission:internal_screening', 'submission:audit_rounds', 'submission:audit_l1', 'submission:audit_l2', 'submission:audit_l3', 'submission:final_status', 'submission:approve_client', 'submission:schedule_interview', 'submission:edit_rate', 'submission:edit',
        'tenant:settings', 'user:manage',
        'pod:create', 'pod:edit', 'pod:delete', 'pod:view', 'pod:reset_cycle', 'pod:overlap',
        'branch_admin:manage', 'candidate:search_all_branches', 'job:view_all_branches', 'candidate:search_all_markets',
        'client:view', 'placement:view', 'report:view'
      ],
      BRANCH_ADMIN: [
        'job:create', 'job:view', 'job:edit', 'job:publish_direct', 'job:approve', 'job:reject',
        'job:assign', 'job:assign_recruiter', 'job:assign_pod',
        'candidate:create', 'candidate:view',
        'submission:create', 'submission:view', 'submission:internal_screening', 'submission:audit_rounds', 'submission:audit_l1', 'submission:audit_l2', 'submission:audit_l3', 'submission:final_status', 'submission:approve_client', 'submission:schedule_interview', 'submission:edit_rate', 'submission:edit',
        'branch_admin:manage', 'user:manage', 'pod:view', 'pod:edit',
        'client:view', 'placement:view', 'report:view'
      ],
      RECRUITER: [
        'candidate:create', 'candidate:view',
        'submission:create', 'submission:view', 'submission:edit',
        'job:view',
        'pod:view'
      ],
      ACCOUNT_MANAGER: [
        'job:create', 'job:edit', 'job:view', 'job:approve',
        'candidate:view', 'candidate:create',
        'submission:view', 'submission:create', 'submission:audit_rounds', 'submission:audit_l1', 'submission:audit_l2', 'submission:audit_l3', 'submission:final_status', 'submission:schedule_interview', 'submission:edit_rate', 'submission:edit',
        'pod:view',
        'client:view', 'client:create', 'client:edit',
        'placement:view', 'placement:create',
        'report:view'
      ],
      DELIVERY_HEAD: [
        'job:view', 'job:edit', 'job:approve', 'job:reject',
        'job:assign', 'job:assign_recruiter', 'job:assign_pod',
        'candidate:view', 'candidate:create',
        'submission:view', 'submission:create', 'submission:internal_screening', 'submission:audit_rounds', 'submission:audit_l1', 'submission:audit_l2', 'submission:audit_l3', 'submission:final_status', 'submission:approve_client', 'submission:schedule_interview', 'submission:edit_rate', 'submission:edit',
        'pod:create', 'pod:edit', 'pod:delete', 'pod:view', 'pod:reset_cycle', 'pod:overlap',
        'candidate:search_all_branches', 'job:view_all_branches', 'candidate:search_all_markets',
        'client:view', 'placement:view', 'report:view'
      ],
      POD_LEAD: [
        'job:view', 'job:edit', 'job:approve', 'job:reject',
        'candidate:view', 'candidate:create',
        'submission:view', 'submission:create', 'submission:internal_screening', 'submission:schedule_interview', 'submission:edit',
        'pod:view', 'pod:edit', 'report:view'
      ]
    };

    const areEqual = (p1: string[], p2: string[]) => {
      if (!p1 || !p2 || p1.length !== p2.length) return false;
      const s1 = [...p1].sort();
      const s2 = [...p2].sort();
      return s1.every((val, index) => val === s2[index]);
    };

    const result: any[] = [];
    for (const role of roles) {
      const permsRes = await this.db.query(
        'SELECT permission FROM role_permissions WHERE role_id = $1',
        [role.id]
      );
      const rolePerms = permsRes.rows.map(row => row.permission);
      const baseSysRole = (role.systemRole || role.name).toUpperCase();
      const defaultPerms = DEFAULT_PERMS[baseSysRole] || [];

      const isExactSubstitution = !role.isSystem && areEqual(rolePerms, defaultPerms);

      result.push({
        ...role,
        permissions: role.isSystem && defaultPerms.length > 0 ? defaultPerms : rolePerms,
        isExactSubstitution,
        replacesSystemRole: isExactSubstitution ? baseSysRole : null,
      });
    }
    return result;
  }

  async getAssignableRolePool(tenantId: string) {
    const allRoles = await this.listRoles(tenantId);
    const substitutedKeys = new Set<string>();

    for (const r of allRoles) {
      if (r.isExactSubstitution && r.replacesSystemRole) {
        substitutedKeys.add(r.replacesSystemRole.toUpperCase());
      }
    }

    return allRoles.filter(r => {
      if (r.isSystem && substitutedKeys.has(r.name.toUpperCase())) {
        return false;
      }
      return true;
    });
  }

  async createCustomRole(tenantId: string, name: string, description: string, permissions: string[], systemRole?: string) {
    const nameUpper = name.toUpperCase().trim();
    if (['SUPER_ADMIN', 'ADMIN', 'BRANCH_ADMIN', 'RECRUITER', 'ACCOUNT_MANAGER', 'DELIVERY_HEAD', 'POD_LEAD'].includes(nameUpper)) {
      throw new BadRequestException('Role name conflicts with a default system role.');
    }

    const resolvedSystemRole = systemRole?.toUpperCase().trim() || 'RECRUITER';
    if (!['ADMIN', 'BRANCH_ADMIN', 'ACCOUNT_MANAGER', 'RECRUITER', 'DELIVERY_HEAD', 'POD_LEAD'].includes(resolvedSystemRole)) {
      throw new BadRequestException('Invalid base system role selected.');
    }

    // Determine default permissions for the selected base template if none or generic defaults are provided.
    let resolvedPermissions = permissions || [];
    if (
      resolvedPermissions.length === 0 || 
      (resolvedPermissions.length === 2 && resolvedPermissions.includes('job:view') && resolvedPermissions.includes('candidate:view'))
    ) {
      const DEFAULT_PERMISSIONS: Record<string, string[]> = {
        ADMIN: [
          'job:create', 'job:edit', 'job:view',
          'candidate:create', 'candidate:view',
          'submission:create', 'submission:edit',
          'tenant:settings', 'user:manage',
          'pod:create', 'pod:edit', 'pod:delete', 'pod:view', 'pod:reset_cycle',
          'branch_admin:manage', 'candidate:search_all_branches', 'job:view_all_branches'
        ],
        BRANCH_ADMIN: [
          'job:view', 'job:edit', 'candidate:create', 'candidate:view',
          'submission:create', 'submission:view', 'submission:edit',
          'branch_admin:manage', 'user:manage', 'pod:view', 'pod:edit'
        ],
        RECRUITER: [
          'candidate:create', 'candidate:view',
          'submission:create', 'submission:view',
          'job:view',
          'pod:view'
        ],
        ACCOUNT_MANAGER: [
          'job:create', 'job:edit', 'job:view',
          'candidate:view', 'submission:view', 'submission:edit',
          'pod:view'
        ],
        DELIVERY_HEAD: [
          'job:view', 'job:edit', 'candidate:view', 'submission:view', 'submission:edit',
          'pod:create', 'pod:edit', 'pod:delete', 'pod:view', 'pod:reset_cycle',
          'candidate:search_all_branches', 'job:view_all_branches'
        ],
        POD_LEAD: [
          'job:view', 'candidate:view', 'submission:view', 'submission:edit',
          'pod:view', 'job:edit'
        ]
      };
      resolvedPermissions = DEFAULT_PERMISSIONS[resolvedSystemRole] || ['job:view', 'candidate:view'];
    }

    const exists = await this.db.query(
      'SELECT id FROM custom_roles WHERE tenant_id = $1 AND UPPER(name) = $2 LIMIT 1',
      [tenantId, nameUpper]
    );
    if (exists.rows.length > 0) {
      throw new ConflictException(`A role with name "${name}" already exists.`);
    }

    const roleRes = await this.db.query(
      `INSERT INTO custom_roles (tenant_id, name, description, is_system, system_role)
       VALUES ($1, $2, $3, false, $4)
       RETURNING id, name, description, is_system as "isSystem", system_role as "systemRole"`,
      [tenantId, name, description, resolvedSystemRole]
    );
    const role = roleRes.rows[0];

    for (const perm of resolvedPermissions) {
      await this.db.query(
        'INSERT INTO role_permissions (role_id, permission) VALUES ($1, $2)',
        [role.id, perm]
      );
    }

    return {
      ...role,
      permissions: resolvedPermissions
    };
  }

  async updateRolePermissions(tenantId: string, roleId: string, permissions: string[]) {
    const roleResult = await this.db.query(
      'SELECT id, is_system FROM custom_roles WHERE id = $1 AND tenant_id = $2 LIMIT 1',
      [roleId, tenantId]
    );
    if (roleResult.rows.length === 0) {
      throw new NotFoundException('Role not found.');
    }

    // Update permissions in database
    await this.db.query('DELETE FROM role_permissions WHERE role_id = $1', [roleId]);
    for (const perm of permissions) {
      await this.db.query(
        'INSERT INTO role_permissions (role_id, permission) VALUES ($1, $2)',
        [roleId, perm]
      );
    }

    return { message: 'Permissions updated successfully.', permissions };
  }

  async deleteCustomRole(tenantId: string, roleId: string, targetRoleId?: string) {
    const roleResult = await this.db.query(
      'SELECT id, name, is_system, system_role FROM custom_roles WHERE id = $1 AND tenant_id = $2 LIMIT 1',
      [roleId, tenantId]
    );
    if (roleResult.rows.length === 0) {
      throw new NotFoundException('Role not found.');
    }
    const roleToDel = roleResult.rows[0];
    if (roleToDel.is_system) {
      throw new BadRequestException('You cannot delete default system roles.');
    }

    // Check staff count currently assigned to this role
    const staffCountRes = await this.db.query(
      'SELECT COUNT(*)::int as count FROM users WHERE role_id = $1 OR $2 = ANY(roles)',
      [roleId, roleToDel.name]
    );
    const staffCount = staffCountRes.rows[0]?.count || 0;

    // If staff members exist and no targetRoleId is provided, throw error requiring target selection
    if (staffCount > 0 && !targetRoleId) {
      throw new BadRequestException({
        message: `Cannot delete custom role "${roleToDel.name}" because ${staffCount} staff member(s) are currently assigned to it. Please select a replacement target role.`,
        requiresReassignment: true,
        staffCount,
        roleName: roleToDel.name,
      });
    }

    let targetRole: any = null;
    if (targetRoleId) {
      const targetRes = await this.db.query(
        'SELECT id, name FROM custom_roles WHERE id = $1 AND tenant_id = $2 LIMIT 1',
        [targetRoleId, tenantId]
      );
      if (targetRes.rows.length === 0) {
        throw new NotFoundException('Target replacement role not found.');
      }
      targetRole = targetRes.rows[0];
    } else {
      // Default fallback if staffCount is 0
      const baseSysRole = roleToDel.system_role || 'RECRUITER';
      const fallbackRes = await this.db.query(
        "SELECT id, name FROM custom_roles WHERE tenant_id = $1 AND (name = $2 OR system_role = $2) AND is_system = true LIMIT 1",
        [tenantId, baseSysRole]
      );
      targetRole = fallbackRes.rows[0];
    }

    let reassignedCount = 0;
    if (targetRole) {
      const updateRes = await this.db.query(
        'UPDATE users SET role_id = $1 WHERE role_id = $2 RETURNING id',
        [targetRole.id, roleId]
      );
      reassignedCount = updateRes.rows.length;

      // Replace role name in users.roles array
      await this.db.query(
        `UPDATE users SET roles = array_replace(roles, $1, $2) WHERE tenant_id = $3 AND $1 = ANY(roles)`,
        [roleToDel.name, targetRole.name, tenantId]
      ).catch(() => {});
    } else {
      // Remove role name from users.roles array
      await this.db.query(
        `UPDATE users SET roles = array_remove(roles, $1) WHERE tenant_id = $2 AND $1 = ANY(roles)`,
        [roleToDel.name, tenantId]
      ).catch(() => {});
    }

    // 1. Clear associated permissions and user role mappings first to prevent FK constraint errors
    await this.db.query('DELETE FROM role_permissions WHERE role_id = $1', [roleId]).catch(() => {});
    await this.db.query('DELETE FROM user_roles WHERE role_id = $1', [roleId]).catch(() => {});

    // 2. Delete the custom role
    await this.db.query('DELETE FROM custom_roles WHERE id = $1', [roleId]);
    return {
      message: `Custom role "${roleToDel.name}" deleted successfully.${reassignedCount > 0 ? ` Reassigned ${reassignedCount} staff member(s) to ${targetRole?.name || 'default role'}.` : ''}`,
      reassignedCount,
      targetRole: targetRole?.name,
    };
  }


  async assignUserRoles(tenantId: string, userId: string, roleIds: string[], requesterRoles: string[]) {
    if (!roleIds || roleIds.length === 0) {
      throw new BadRequestException('Please specify at least one role.');
    }

    // Get selected roles details
    const rolesResult = await this.db.query(
      'SELECT id, name FROM custom_roles WHERE id = ANY($1) AND tenant_id = $2',
      [roleIds, tenantId]
    );
    if (rolesResult.rows.length === 0) {
      throw new NotFoundException('Selected roles were not found.');
    }
    const roleNames = rolesResult.rows.map(r => r.name.toUpperCase());

    // Block assigning SUPER_ADMIN unless requester has SUPER_ADMIN role
    if (roleNames.includes('SUPER_ADMIN') && (!requesterRoles || !requesterRoles.includes('SUPER_ADMIN'))) {
      throw new ForbiddenException('You are not authorized to assign the SUPER_ADMIN role.');
    }

    // Fetch target user details
    const userRes = await this.db.query(
      'SELECT tenant_id, roles FROM users WHERE id = $1 AND tenant_id = $2 LIMIT 1',
      [userId, tenantId]
    );
    if (userRes.rows.length === 0) {
      throw new NotFoundException('User not found.');
    }
    const targetUser = userRes.rows[0];
    const targetUserRoles = targetUser.roles || [];

    // Block modifying SUPER_ADMIN user roles unless requester is SUPER_ADMIN
    if (targetUserRoles.includes('SUPER_ADMIN') && (!requesterRoles || !requesterRoles.includes('SUPER_ADMIN'))) {
      throw new ForbiddenException('You are not authorized to modify roles of a SUPER_ADMIN.');
    }

    // Demoting check: if new roles do not contain ADMIN, protect last admin lockout
    const isNewAdmin = roleNames.includes('ADMIN');
    if (!isNewAdmin) {
      await this.verifyLastAdminProtection(tenantId, userId, 'demote');
    }

    // Update user: link primary role_id (first item) and synchronize roles array
    await this.db.query(
      `UPDATE users 
       SET role_id = $1, roles = $2, updated_at = NOW() 
       WHERE id = $3 AND tenant_id = $4`,
      [roleIds[0], roleNames, userId, tenantId]
    );

    return { message: 'User roles assigned successfully.', roles: roleNames };
  }

  listAllPermissions() {
    return [
      // 1. Jobs Management
      { id: 'job:create', name: 'Create Jobs', group: 'Jobs Management' },
      { id: 'job:edit', name: 'Edit Jobs', group: 'Jobs Management' },
      { id: 'job:view', name: 'View Jobs', group: 'Jobs Management' },
      { id: 'job:publish_direct', name: 'Publish Jobs Directly (Bypass Approval Gate)', group: 'Jobs Management' },
      { id: 'job:approve', name: 'Approve & Activate Job Requisitions', group: 'Jobs Management' },
      { id: 'job:reject', name: 'Reject Job Requisitions with Feedback', group: 'Jobs Management' },
      { id: 'job:assign', name: 'Assign & Reassign Jobs to Recruiters/Pods', group: 'Jobs Management' },
      { id: 'job:assign_recruiter', name: 'Assign Direct Recruiter to Job', group: 'Jobs Management' },
      { id: 'job:assign_pod', name: 'Assign Pod to Job', group: 'Jobs Management' },

      // 2. Candidates Management
      { id: 'candidate:create', name: 'Create Candidates', group: 'Candidates Management' },
      { id: 'candidate:view', name: 'View Candidates & Resume Bank', group: 'Candidates Management' },

      // 3. Candidate Submissions & Tracking (General)
      { id: 'submission:view', name: 'View Submissions Tracker & Candidate Pipeline', group: 'Candidate Submissions & Sourcing' },
      { id: 'submission:create', name: 'Submit Candidate CV to Job Requisitions', group: 'Candidate Submissions & Sourcing' },
      { id: 'submission:edit', name: 'Edit Submissions (General Notes & Comments)', group: 'Candidate Submissions & Sourcing' },

      // 4. Internal Screening & Pre-Interview Gate (Zone A)
      { id: 'submission:internal_screening', name: 'Internal Screening Review & Approval Gate', group: 'Internal Screening & Review Gate' },
      { id: 'submission:edit_rate', name: 'Edit Candidate Pay Rate & CTC Margins', group: 'Internal Screening & Review Gate' },

      // 5. Active Interview Stages & Quality Audits (Zone B: L1, L2, L3)
      { id: 'submission:audit_rounds', name: 'Interview Stages (Master L1, L2, L3 Audits & Remarks)', group: 'Interview Rounds & Quality Audits (L1, L2, L3)' },
      { id: 'submission:audit_l1', name: 'Round 1 (L1) Screening & Interview Audit', group: 'Interview Rounds & Quality Audits (L1, L2, L3)' },
      { id: 'submission:audit_l2', name: 'Round 2 (L2) Technical Interview & Vetting', group: 'Interview Rounds & Quality Audits (L1, L2, L3)' },
      { id: 'submission:audit_l3', name: 'Round 3 (L3) Commercial & Final Readiness Audit', group: 'Interview Rounds & Quality Audits (L1, L2, L3)' },
      { id: 'submission:schedule_interview', name: 'Schedule Client & Internal Interviews', group: 'Interview Rounds & Quality Audits (L1, L2, L3)' },
      { id: 'submission:final_status', name: 'Final Placement Status (Offer & Join Outcome)', group: 'Interview Rounds & Quality Audits (L1, L2, L3)' },

      // 6. Clients & Placements
      { id: 'client:view', name: 'View Clients Directory', group: 'Clients & Placements' },
      { id: 'client:create', name: 'Create New Clients', group: 'Clients & Placements' },
      { id: 'client:edit', name: 'Edit Client Profiles & Terms', group: 'Clients & Placements' },
      { id: 'placement:view', name: 'View Placements & Revenue Margins', group: 'Clients & Placements' },
      { id: 'placement:create', name: 'Create & Finalize Placements', group: 'Clients & Placements' },
      { id: 'report:view', name: 'View Analytics & Performance Reports', group: 'Clients & Placements' },

      // 7. Pods Management
      { id: 'pod:create', name: 'Create Pods', group: 'Pods Management' },
      { id: 'pod:edit', name: 'Edit Pods & Assign Unassigned Jobs', group: 'Pods Management' },
      { id: 'pod:delete', name: 'Delete Pods', group: 'Pods Management' },
      { id: 'pod:view', name: 'View Pods', group: 'Pods Management' },
      { id: 'pod:reset_cycle', name: 'Reset Assignment Cycle', group: 'Pods Management' },
      { id: 'pod:overlap', name: 'Authorize Pod Assignment Overlaps', group: 'Pods Management' },

      // 8. Branch & Multi-Office Management
      { id: 'branch_admin:manage', name: 'Manage Branch Office & Staff', group: 'Branch & Multi-Office Management' },
      { id: 'candidate:search_all_branches', name: 'Search Candidates Across All Branches', group: 'Branch & Multi-Office Management' },
      { id: 'job:view_all_branches', name: 'View Jobs Across All Branches', group: 'Branch & Multi-Office Management' },
      { id: 'candidate:search_all_markets', name: 'Search Candidates Across All Markets (US + India)', group: 'Branch & Multi-Office Management' },

      // 9. Administration
      { id: 'tenant:settings', name: 'Manage Company Settings', group: 'Administration' },
      { id: 'user:manage', name: 'Manage Staff & Roles', group: 'Administration' },
    ];
  }

  // ─────────────────────────────────────────────────────────────
  // List all users pending approval (admin utility)
  // ─────────────────────────────────────────────────────────────
  async listPendingApprovals() {
    const result = await this.db.query(
      `SELECT u.id, u.email, u.full_name, u.roles, u.created_at, u.tenant_id, t.name as tenant_name, t.default_market, t.domain as tenant_domain
       FROM users u
       LEFT JOIN tenants t ON u.tenant_id = t.id
       WHERE u.is_approved = false
       ORDER BY u.created_at DESC`
    );
    return result.rows.map(row => ({
      id: row.id,
      email: row.email,
      fullName: row.full_name,
      roles: row.roles,
      createdAt: row.created_at,
      tenantId: row.tenant_id,
      tenantName: row.tenant_name || 'N/A',
      defaultMarket: row.default_market || 'US',
      tenantSubdomain: row.tenant_domain || '',
    }));
  }

  // ─────────────────────────────────────────────────────────────
  // Approve user and set tenant's market settings (admin utility)
  // ─────────────────────────────────────────────────────────────
  async approveUser(userId: string, market: string, subdomain?: string, userLimit?: number, maxBranches?: number) {
    const userResult = await this.db.query(
      'SELECT tenant_id FROM users WHERE id = $1 LIMIT 1',
      [userId]
    );
    if (userResult.rows.length === 0) {
      throw new NotFoundException(`User with ID ${userId} was not found.`);
    }
    const tenantId = userResult.rows[0].tenant_id;

    await this.db.query(
      'UPDATE users SET is_approved = true, is_active = true WHERE id = $1',
      [userId]
    );

    await this.db.query(
      "UPDATE tenants SET status = 'ACTIVE' WHERE id = $1",
      [tenantId]
    );

    if (market && (market === 'US' || market === 'IN')) {
      await this.db.query(
        'UPDATE tenants SET default_market = $1 WHERE id = $2',
        [market, tenantId]
      );
    }
    if (userLimit && userLimit > 0) {
      await this.db.query('UPDATE tenants SET user_limit = $1 WHERE id = $2', [userLimit, tenantId]);
    }
    if (maxBranches && maxBranches > 0) {
      await this.db.query('UPDATE tenants SET max_branches = $1 WHERE id = $2', [maxBranches, tenantId]);
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

    const subdomainExists = await this.db.query(
      'SELECT id FROM tenants WHERE domain = $1 UNION SELECT tenant_id as id FROM tenant_domains WHERE domain_name = $1 LIMIT 1',
      [dto.subdomain]
    );
    if (subdomainExists.rows.length > 0) {
      throw new ConflictException(`Subdomain "${dto.subdomain}" is already taken.`);
    }

    const emailExists = await this.db.query('SELECT id FROM users WHERE email = $1 LIMIT 1', [email]);
    if (emailExists.rows.length > 0) {
      throw new ConflictException(`Email "${email}" is already registered.`);
    }

    let basePrefix = companyName.replace(/[^a-zA-Z0-9]/g, '').substring(0, 4).toUpperCase();
    if (basePrefix.length < 2) basePrefix = 'COMP';
    let prefixCode = basePrefix;
    let counter = 1;
    while (true) {
      const prefixExists = await this.db.query('SELECT id FROM tenants WHERE prefix_code = $1 LIMIT 1', [prefixCode]);
      if (prefixExists.rows.length === 0) break;
      prefixCode = `${basePrefix.substring(0, 3)}${counter}`;
      counter++;
    }

    const tenantResult = await this.db.query(
      `INSERT INTO tenants (name, domain, status, default_market, user_limit, max_branches, prefix_code)
       VALUES ($1, $2, 'ACTIVE', $3, $4, $5, $6)
       RETURNING id, name, domain, status, user_limit, max_branches, default_market, prefix_code`,
      [companyName, dto.subdomain, market, userLimit, maxBranches, prefixCode]
    );
    const tenant = tenantResult.rows[0];

    await this.db.query(
      `INSERT INTO tenant_domains (tenant_id, domain_name, is_primary) VALUES ($1, $2, TRUE)`,
      [tenant.id, dto.subdomain]
    );

    const roleMap = await this.seedTenantRoles(tenant.id);
    const adminRoleId = roleMap['ADMIN'];

    const { hash, salt } = this.hashPassword(password);
    const userResult = await this.db.query(
      `INSERT INTO users (tenant_id, email, full_name, password_hash, salt, roles, is_active, is_approved, role_id)
       VALUES ($1, $2, $3, $4, $5, $6, true, true, $7)
       RETURNING id, email, full_name, roles, tenant_id, created_at, role_id`,
      [tenant.id, email, dto.adminFullName.trim(), hash, salt, ['ADMIN'], adminRoleId]
    );
    const user = userResult.rows[0];

    return {
      message: `Tenant "${companyName}" created and activated successfully!`,
      tenant,
      adminUser: {
        id: user.id,
        email: user.email,
        fullName: user.full_name,
        temporaryPassword: password,
      },
    };
  }

  // ─────────────────────────────────────────────────────────────
  // List all tenants in the system (admin utility)
  // ─────────────────────────────────────────────────────────────
  async listTenants() {
    const result = await this.db.query(
      `SELECT id, name, domain, status, default_market as "defaultMarket", user_limit as "userLimit", created_at as "createdAt"
       FROM tenants
       ORDER BY name ASC`
    );
    return result.rows;
  }

  async getTenantDetails(tenantId: string) {
    const tenantRes = await this.db.query(
      `SELECT id, name, domain, status, default_market as "defaultMarket", user_limit as "userLimit", created_at as "createdAt"
       FROM tenants WHERE id = $1 LIMIT 1`,
      [tenantId]
    );
    if (tenantRes.rows.length === 0) {
      throw new NotFoundException('Tenant not found');
    }
    const tenant = tenantRes.rows[0];

    const usersRes = await this.db.query(
      `SELECT u.id, u.email, u.full_name as "fullName", u.roles, u.is_active as "isActive", u.is_approved as "isApproved", u.created_at as "createdAt", cr.name as "roleName", cr.system_role as "systemRole"
       FROM users u
       LEFT JOIN custom_roles cr ON u.role_id = cr.id
       WHERE u.tenant_id = $1
       ORDER BY u.created_at DESC`,
      [tenantId]
    );

    const statsRes = await Promise.all([
      this.db.query(`SELECT COUNT(*) FROM jobs WHERE tenant_id = $1`, [tenantId]),
      this.db.query(`SELECT COUNT(*) FROM candidates WHERE tenant_id = $1`, [tenantId]),
      this.db.query(`SELECT COUNT(*) FROM recruiter_submissions WHERE tenant_id = $1`, [tenantId]),
    ]);

    return {
      tenant,
      users: usersRes.rows,
      stats: {
        totalJobs: parseInt(statsRes[0].rows[0].count, 10),
        totalCandidates: parseInt(statsRes[1].rows[0].count, 10),
        totalSubmissions: parseInt(statsRes[2].rows[0].count, 10),
      }
    };
  }

  // ─────────────────────────────────────────────────────────────
  // Update a tenant's status (admin utility)
  // ─────────────────────────────────────────────────────────────
  async updateTenantStatus(tenantId: string, status: string) {
    let upperStatus = status.toUpperCase().trim();
    if (upperStatus === 'SUSPENDED') upperStatus = 'INACTIVE';
    if (upperStatus !== 'ACTIVE' && upperStatus !== 'INACTIVE' && upperStatus !== 'PENDING') {
      throw new BadRequestException('Invalid tenant status. Must be ACTIVE, INACTIVE, or PENDING.');
    }
    await this.db.query(
      'UPDATE tenants SET status = $1, updated_at = NOW() WHERE id = $2',
      [upperStatus, tenantId]
    );
    return { message: 'Tenant status updated successfully.', status: upperStatus };
  }

  // ─────────────────────────────────────────────────────────────
  // Update a tenant's active user limit (admin utility)
  // ─────────────────────────────────────────────────────────────
  async updateTenantUserLimit(tenantId: string, limit: number) {
    if (isNaN(limit) || limit < 1) {
      throw new BadRequestException('Invalid user limit. Must be a positive integer.');
    }
    await this.db.query(
      'UPDATE tenants SET user_limit = $1, updated_at = NOW() WHERE id = $2',
      [limit, tenantId]
    );
    return { message: 'Tenant user limit updated successfully.', userLimit: limit };
  }

  async updateTenantBranchLimit(tenantId: string, limit: number) {
    if (isNaN(limit) || limit < 1) {
      throw new BadRequestException('Invalid branch limit. Must be a positive integer.');
    }
    await this.db.query(
      'UPDATE tenants SET max_branches = $1, updated_at = NOW() WHERE id = $2',
      [limit, tenantId]
    );
    return { message: 'Tenant max branches limit updated successfully.', maxBranches: limit };
  }

  // ─────────────────────────────────────────────────────────────
  // Update a tenant's default market preference (admin utility)
  // ─────────────────────────────────────────────────────────────
  async updateTenantMarket(tenantId: string, market: string) {
    if (market !== 'US' && market !== 'IN') {
      throw new BadRequestException('Invalid market type. Must be US or IN.');
    }
    await this.db.query(
      'UPDATE tenants SET default_market = $1, updated_at = NOW() WHERE id = $2',
      [market, tenantId]
    );
    return { message: 'Tenant staffing market updated successfully.', market };
  }

  // ─────────────────────────────────────────────────────────────
  // Update tenant's subdomain/domain (tenant admin utility)
  // ─────────────────────────────────────────────────────────────
  async updateTenantSubdomain(tenantId: string, subdomain: string) {
    if (!subdomain || !/^[a-z0-9-]+$/.test(subdomain)) {
      throw new BadRequestException('Subdomain must contain alphanumeric characters and hyphens only.');
    }

    // Check if subdomain is already taken by another tenant
    const exists = await this.db.query(
      'SELECT id FROM tenant_domains WHERE domain_name = $1 AND tenant_id <> $2 LIMIT 1',
      [subdomain, tenantId]
    );
    if (exists.rows.length > 0) {
      throw new ConflictException('Subdomain is already taken by another company.');
    }

    await this.db.query(
      'UPDATE tenants SET domain = $1, updated_at = NOW() WHERE id = $2',
      [subdomain, tenantId]
    );

    // Update primary subdomain mapping
    await this.db.query(
      'UPDATE tenant_domains SET domain_name = $1 WHERE tenant_id = $2 AND is_primary = TRUE',
      [subdomain, tenantId]
    );

    return { message: 'Subdomain updated successfully.', subdomain };
  }

  // ─────────────────────────────────────────────────────────────
  // Helpers: JWT signing (HS256, no external dependency)
  // ─────────────────────────────────────────────────────────────
  private signJwt(payload: Record<string, any>): string {
    const header = { alg: 'HS256', typ: 'JWT' };
    const now = Math.floor(Date.now() / 1000);
    const claims = { ...payload, iat: now, exp: now + TOKEN_TTL_SECONDS };

    const b64Header  = Buffer.from(JSON.stringify(header)).toString('base64url');
    const b64Payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
    const data       = `${b64Header}.${b64Payload}`;

    const sig = crypto
      .createHmac('sha256', this.jwtSecret)
      .update(data)
      .digest('base64url');

    return `${data}.${sig}`;
  }

  signInternalToken(user: any): { accessToken: string; expiresIn: number } {
    const payload = {
      sub: user.id,
      email: user.email,
      name: user.full_name,
      roles: user.roles || [],
      tenant_id: user.tenant_id,
    };
    const accessToken = this.signJwt(payload);
    return { accessToken, expiresIn: TOKEN_TTL_SECONDS };
  }

  verifyJwt(token: string): any {
    try {
      const parts = token.split('.');
      if (parts.length !== 3) return null;

      // Verify HS256 signature
      const data = `${parts[0]}.${parts[1]}`;
      const expectedSig = crypto
        .createHmac('sha256', this.jwtSecret)
        .update(data)
        .digest('base64url');

      if (expectedSig !== parts[2]) return null;

      // Decode and check expiry
      const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
      if (payload.exp && Math.floor(Date.now() / 1000) > payload.exp) return null;

      return payload;
    } catch {
      return null;
    }
  }

  // ─────────────────────────────────────────────────────────────
  // Helpers: Password hashing (SHA-256 + salt, no bcrypt dep)
  // ─────────────────────────────────────────────────────────────
  private hashPassword(password: string, existingSalt?: string): { hash: string; salt: string } {
    const salt = existingSalt || crypto.randomBytes(16).toString('hex');
    const hash = crypto
      .createHmac('sha256', salt)
      .update(password)
      .digest('hex');
    return { hash, salt };
  }

  // ─────────────────────────────────────────────────────────────
  // Helpers: Check tenant user seat limits (Ceipal standard)
  // ─────────────────────────────────────────────────────────────
  private async checkSeatLimit(tenantId: string) {
    // 1. Get the tenant user limit
    const tenantRes = await this.db.query(
      'SELECT user_limit FROM tenants WHERE id = $1 LIMIT 1',
      [tenantId]
    );
    if (tenantRes.rows.length === 0) {
      throw new NotFoundException('Tenant not found.');
    }
    const userLimit = tenantRes.rows[0].user_limit || 5;

    // 2. Count active and approved users for this tenant
    const activeRes = await this.db.query(
      'SELECT COUNT(*) as count FROM users WHERE tenant_id = $1 AND is_active = true AND is_approved = true',
      [tenantId]
    );
    const activeCount = parseInt(activeRes.rows[0].count, 10);

    if (activeCount >= userLimit) {
      throw new BadRequestException(
        `Seat limit reached. This workspace is limited to ${userLimit} active users. Please contact the platform administrator to purchase more seats.`
      );
    }
  }

  // ─────────────────────────────────────────────────────────────
  // Helpers: Protect last active administrator lockout
  // ─────────────────────────────────────────────────────────────
  private async verifyLastAdminProtection(tenantId: string, targetUserId: string, action: 'demote' | 'deactivate') {
    // 1. Check if target user currently has the ADMIN role
    const userRes = await this.db.query(
      "SELECT roles, is_active, is_approved FROM users WHERE id = $1 AND tenant_id = $2 LIMIT 1",
      [targetUserId, tenantId]
    );
    if (userRes.rows.length === 0) {
      return;
    }
    const user = userRes.rows[0];
    const hasAdmin = user.roles && user.roles.includes('ADMIN');

    if (hasAdmin && user.is_active && user.is_approved) {
      // 2. Count active and approved admins in this tenant
      const adminsRes = await this.db.query(
        "SELECT COUNT(*) as count FROM users WHERE tenant_id = $1 AND is_active = true AND is_approved = true AND 'ADMIN' = ANY(roles)",
        [tenantId]
      );
      const adminCount = parseInt(adminsRes.rows[0].count, 10);

      // If only 1 admin remains and it is the target user
      if (adminCount <= 1) {
        throw new BadRequestException(
          `Action blocked: You cannot ${action} the last active Administrator in this workspace. Please assign another active user as an Administrator first.`
        );
      }
    }
  }

  // ─── Custom Domain Helpers ────────────────────────────────────
  async getTenantDomains(tenantId: string) {
    const res = await this.db.query(
      `SELECT id, domain_name, is_primary, 
              CASE 
                WHEN is_primary = TRUE THEN 'VERIFIED'
                ELSE COALESCE(verification_status, 'PENDING')
              END as verification_status, 
              CASE 
                WHEN is_primary = TRUE THEN 'ACTIVE'
                ELSE COALESCE(ssl_status, 'PENDING')
              END as ssl_status, 
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

    // Check if domain is already mapped anywhere
    const exists = await this.db.query(
      'SELECT id FROM tenant_domains WHERE domain_name = $1 LIMIT 1',
      [normalizedDomain]
    );
    if (exists.rows.length > 0) {
      throw new ConflictException('Domain name is already registered by another workspace.');
    }

    const res = await this.db.query(
      `INSERT INTO tenant_domains (tenant_id, domain_name, is_primary, verification_status, ssl_status)
       VALUES ($1, $2, FALSE, 'PENDING', 'PENDING')
       RETURNING id, domain_name, is_primary, verification_status, ssl_status, created_at`,
      [tenantId, normalizedDomain]
    );
    return res.rows[0];
  }

  async deleteTenantDomain(tenantId: string, domainId: string) {
    // Check if it's the primary subdomain (cannot delete primary)
    const check = await this.db.query(
      'SELECT is_primary FROM tenant_domains WHERE id = $1 AND tenant_id = $2 LIMIT 1',
      [domainId, tenantId]
    );
    if (check.rows.length === 0) {
      throw new NotFoundException('Domain mapping not found.');
    }
    if (check.rows[0].is_primary) {
      throw new BadRequestException('Cannot delete the primary subdomain of the company workspace.');
    }

    await this.db.query(
      'DELETE FROM tenant_domains WHERE id = $1 AND tenant_id = $2',
      [domainId, tenantId]
    );
    return { success: true, message: 'Domain deleted successfully.' };
  }

  async isDomainRegistered(domainName: string): Promise<boolean> {
    const normalized = domainName.toLowerCase().trim();
    if (!normalized) return false;
    try {
      const res = await this.db.query(
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
  }) {
    this.logger.log(`Updating tenant settings for ${tenantId}: ${JSON.stringify(settings)}`);

    // Ensure columns exist on tenants table
    await this.db.query(`
      ALTER TABLE tenants ADD COLUMN IF NOT EXISTS job_assignment_mode VARCHAR(50) DEFAULT 'AUTO';
      ALTER TABLE tenants ADD COLUMN IF NOT EXISTS job_assignment_options JSONB DEFAULT '{"allowAuto":true,"allowAll":true,"allowUnassigned":true,"allowedPodIds":[]}';
    `).catch(() => {});

    const fields: string[] = [];
    const params: any[] = [tenantId];
    let paramIndex = 2;
    
    if (settings.podSystemEnabled !== undefined) {
      fields.push(`pod_system_enabled = $${paramIndex}`);
      params.push(settings.podSystemEnabled);
      paramIndex++;
    }

    if (settings.candidatePoolMode !== undefined) {
      const mode = settings.candidatePoolMode.trim().toUpperCase();
      if (!['COMBINED_MARKET', 'STRICT_BRANCH', 'ALL_BRANCHES'].includes(mode)) {
        throw new BadRequestException('Invalid candidate pool mode. Must be COMBINED_MARKET, STRICT_BRANCH, or ALL_BRANCHES.');
      }
      fields.push(`candidate_pool_mode = $${paramIndex}`);
      params.push(mode);
      paramIndex++;
    }

    if (settings.jobAssignmentMode !== undefined) {
      const mode = settings.jobAssignmentMode.trim().toUpperCase();
      if (!['AUTO', 'ADMIN_CONTROLLED'].includes(mode)) {
        throw new BadRequestException('Invalid job assignment mode. Must be AUTO or ADMIN_CONTROLLED.');
      }
      fields.push(`job_assignment_mode = $${paramIndex}`);
      params.push(mode);
      paramIndex++;
    }

    if (settings.jobAssignmentOptions !== undefined) {
      fields.push(`job_assignment_options = $${paramIndex}`);
      params.push(typeof settings.jobAssignmentOptions === 'string' ? settings.jobAssignmentOptions : JSON.stringify(settings.jobAssignmentOptions));
      paramIndex++;
    }
    
    if (fields.length === 0) {
      throw new BadRequestException('No valid setting fields provided.');
    }
    
    const sql = `UPDATE tenants SET ${fields.join(', ')}, updated_at = NOW() WHERE id = $1 RETURNING *`;
    const res = await this.db.query(sql, params);
    return res.rows[0];
  }

  // ─── Tenant Auth Policy Settings Helpers ───────────────────────
  async getTenantAuthPolicy(tenantIdOrSubdomain: string) {
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(tenantIdOrSubdomain);
    let tenantId = tenantIdOrSubdomain;
    if (!isUuid) {
      const res = await this.db.query(
        `SELECT tenant_id FROM tenant_domains WHERE LOWER(domain_name) = $1
         UNION SELECT id as tenant_id FROM tenants WHERE LOWER(domain) = $1 LIMIT 1`,
        [tenantIdOrSubdomain.toLowerCase()]
      );
      if (res.rows.length > 0) {
        tenantId = res.rows[0].tenant_id;
      } else {
        tenantId = DEFAULT_TENANT_ID;
      }
    }

    const result = await this.db.query(
      'SELECT * FROM tenant_auth_settings WHERE tenant_id = $1 LIMIT 1',
      [tenantId]
    );

    if (result.rows.length === 0) {
      return {
        tenantId,
        allowPasswordLogin: true,
        allowMicrosoftSso: true,
        allowGoogleSso: true,
        enforceSsoOnly: false,
        requireMfa: false,
        allowPersonalEmails: true,
        allowedEmailDomains: [],
        microsoftTenantId: null,
        microsoftClientId: null,
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
    };
  }

  async updateTenantAuthPolicy(tenantId: string, dto: any) {
    const result = await this.db.query(
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
        dto.allowPasswordLogin ?? true,
        dto.allowMicrosoftSso ?? true,
        dto.allowGoogleSso ?? true,
        dto.enforceSsoOnly ?? false,
        dto.requireMfa ?? false,
        dto.allowPersonalEmails ?? true,
        dto.allowedEmailDomains || [],
        dto.microsoftTenantId || null,
        dto.microsoftClientId || null,
        dto.microsoftClientSecret || null,
      ]
    );

    const row = result.rows[0];
    return {
      tenantId: row.tenant_id,
      allowPasswordLogin: row.allow_password_login,
      allowMicrosoftSso: row.allow_microsoft_sso,
      allowGoogleSso: row.allow_google_sso,
      enforceSsoOnly: row.enforce_sso_only,
      requireMfa: row.require_mfa,
      allowPersonalEmails: row.allow_personal_emails,
      allowedEmailDomains: row.allowed_email_domains,
      microsoftTenantId: row.microsoft_tenant_id,
      microsoftClientId: row.microsoft_client_id,
    };
  }

  // ─────────────────────────────────────────────────────────────
  // SSO Login: Zero-Trust Invite-Only Verification (Google & Microsoft)
  // ─────────────────────────────────────────────────────────────
  async ssoLogin(dto: SsoLoginDto) {
    const cleanEmail = (dto.email || '').trim().toLowerCase();
    const provider = (dto.provider || '').toLowerCase();
    this.logger.log(`SSO Login attempt for ${cleanEmail} via ${provider} [Subdomain: ${dto.subdomain || 'none'}]`);

    if (!cleanEmail || (provider !== 'google' && provider !== 'microsoft')) {
      throw new BadRequestException('Valid provider (google or microsoft) and email are required.');
    }

    // Resolve tenant ID context
    let targetTenantId = DEFAULT_TENANT_ID;
    if (dto.subdomain && dto.subdomain !== 'www' && dto.subdomain !== 'localhost' && dto.subdomain !== 'enfycon.com' && dto.subdomain !== 'enfyjobs.com') {
      const cleanSub = dto.subdomain.split(':')[0].replace(/^https?:\/\//, '').trim().toLowerCase();
      const domainMapping = await this.db.query(
        `SELECT tenant_id FROM tenant_domains WHERE LOWER(TRIM(domain_name)) = $1 OR LOWER(TRIM(domain_name)) = $2
         UNION
         SELECT id as tenant_id FROM tenants WHERE LOWER(TRIM(domain)) = $1 OR LOWER(TRIM(domain || '.enfyjobs.com')) = $1
         LIMIT 1`,
        [cleanSub, cleanSub.replace(/^www\./, '')]
      );
      if (domainMapping.rows.length > 0) {
        targetTenantId = domainMapping.rows[0].tenant_id;
      }
    }

    // ZERO-TRUST INVITE-ONLY GATE:
    // Query users table for this email and tenant
    const userRes = await this.db.query(
      `SELECT u.id, u.email, u.full_name, u.roles, u.is_active, u.is_approved, u.tenant_id, u.role_id, u.pod_id, u.branch_id, u.assigned_branch_ids, u.branch_roles, u.business_unit_id, u.profile_picture,
              t.name as tenant_name, t.default_market, t.domain as tenant_domain, t.status as tenant_status, t.pod_system_enabled,
              cr.system_role, b.name as branch_name, bu.name as business_unit_name
       FROM users u
       LEFT JOIN tenants t ON u.tenant_id = t.id
       LEFT JOIN custom_roles cr ON u.role_id = cr.id
       LEFT JOIN branches b ON u.branch_id = b.id
       LEFT JOIN business_units bu ON u.business_unit_id = bu.id
       WHERE LOWER(u.email) = $1 AND (u.tenant_id = $2 OR 'SUPER_ADMIN' = ANY(u.roles))
       ORDER BY (u.tenant_id = $2) DESC
       LIMIT 1`,
      [cleanEmail, targetTenantId]
    );

    if (userRes.rows.length === 0) {
      throw new UnauthorizedException(
        'Access Denied: You have not been invited to this workspace. Please contact your organization administrator.'
      );
    }

    const user = userRes.rows[0];

    // Enforce Tenant Active Status
    if (user.tenant_status && user.tenant_status !== 'ACTIVE') {
      throw new UnauthorizedException('Your company workspace is inactive. Contact the platform administrator.');
    }

    // Check if user is active
    if (!user.is_active) {
      throw new UnauthorizedException('Your account has been deactivated. Contact your administrator.');
    }

    if (!user.is_approved) {
      if (user.tenant_status === 'ACTIVE') {
        await this.db.query('UPDATE users SET is_approved = true WHERE id = $1', [user.id]);
        user.is_approved = true;
      } else {
        throw new UnauthorizedException('Your account is pending administrator approval.');
      }
    }

    // Enforce Tenant Auth Policy
    const policy = await this.getTenantAuthPolicy(user.tenant_id);
    if (provider === 'google' && !policy.allowGoogleSso) {
      throw new UnauthorizedException('Google Single Sign-On is disabled by your organization administrator.');
    }
    if (provider === 'microsoft' && !policy.allowMicrosoftSso) {
      throw new UnauthorizedException('Microsoft Single Sign-On is disabled by your organization administrator.');
    }

    // Check personal email restrictions
    const emailDomain = cleanEmail.split('@')[1]?.toLowerCase();
    const isPersonalDomain = ['gmail.com', 'googlemail.com', 'outlook.com', 'hotmail.com', 'live.com', 'yahoo.com', 'icloud.com'].includes(emailDomain);
    if (policy.allowPersonalEmails === false && isPersonalDomain) {
      throw new UnauthorizedException('Personal email addresses are not permitted for this organization. Please use your corporate email.');
    }

    if (policy.allowedEmailDomains && policy.allowedEmailDomains.length > 0) {
      if (!policy.allowedEmailDomains.map((d: string) => d.toLowerCase()).includes(emailDomain)) {
        throw new UnauthorizedException(`Logins with @${emailDomain} domain are not permitted for this organization.`);
      }
    }

    // Validate Microsoft Tenant ID (Azure Directory ID tid) if configured
    if (provider === 'microsoft' && policy.microsoftTenantId && dto.microsoftTenantId) {
      if (policy.microsoftTenantId.toLowerCase() !== dto.microsoftTenantId.toLowerCase()) {
        throw new UnauthorizedException('Your Microsoft Azure organization directory is not authorized for this workspace.');
      }
    }

    // Sync profile picture if provided
    if (dto.picture && !user.profile_picture) {
      await this.db.query('UPDATE users SET profile_picture = $1 WHERE id = $2', [dto.picture, user.id]).catch(() => {});
    }

    // Fetch dynamic permissions
    let permissions: string[] = [];
    if (user.role_id) {
      const permsResult = await this.db.query(
        'SELECT permission FROM role_permissions WHERE role_id = $1',
        [user.role_id]
      );
      permissions = permsResult.rows.map((row) => row.permission);
    }

    let systemRole = user.system_role || 'RECRUITER';
    if (user.roles && user.roles.includes('SUPER_ADMIN')) {
      systemRole = 'SUPER_ADMIN';
    }

    const token = this.signJwt({
      sub: user.id,
      email: user.email,
      fullName: user.full_name,
      roles: user.roles,
      tenantId: user.tenant_id || DEFAULT_TENANT_ID,
      defaultMarket: user.default_market || 'US',
      tenantDomain: user.tenant_domain || '',
      permissions,
      systemRole,
      podId: user.pod_id,
      branchId: user.branch_id,
      businessUnitId: user.business_unit_id,
      podSystemEnabled: user.pod_system_enabled !== false,
    });

    return {
      accessToken: token,
      expiresIn: TOKEN_TTL_SECONDS,
      tokenType: 'Bearer',
      user: {
        id: user.id,
        email: user.email,
        fullName: user.full_name,
        roles: user.roles,
        tenantId: user.tenant_id || DEFAULT_TENANT_ID,
        defaultMarket: user.default_market || 'US',
        tenantDomain: user.tenant_domain || '',
        permissions,
        systemRole,
        podId: user.pod_id,
        branchId: user.branch_id,
        assignedBranchIds: user.assigned_branch_ids && user.assigned_branch_ids.length > 0 ? user.assigned_branch_ids : (user.branch_id ? [user.branch_id] : []),
        branchRoles: user.branch_roles || {},
        branchName: user.branch_name || null,
        businessUnitId: user.business_unit_id,
        businessUnitName: user.business_unit_name || null,
        podSystemEnabled: user.pod_system_enabled !== false,
      },
    };
  }

  // ─────────────────────────────────────────────────────────────
  // User Invitation Lifecycle (Admin invites user)
  // ─────────────────────────────────────────────────────────────
  async inviteUser(dto: InviteUserDto, authHeader?: string) {
    const requester = await this.getRequesterInfoFromToken(authHeader);
    if (!requester.isAdmin && !requester.roles.includes('BRANCH_ADMIN')) {
      throw new ForbiddenException('Only Administrators can invite new users.');
    }

    const tenantId = requester.tenantId || DEFAULT_TENANT_ID;
    const cleanEmail = (dto.email || '').trim().toLowerCase();
    const fullName = (dto.fullName || '').trim();

    if (!cleanEmail || !fullName) {
      throw new BadRequestException('Email and full name are required.');
    }

    const emailParts = cleanEmail.split('@');
    if (emailParts.length !== 2 || !emailParts[0] || !emailParts[1]) {
      throw new BadRequestException('Invalid email address format.');
    }

    // Check if user is already in this tenant
    const existing = await this.db.query(
      'SELECT id, is_active FROM users WHERE LOWER(email) = $1 AND tenant_id = $2 LIMIT 1',
      [cleanEmail, tenantId]
    );
    if (existing.rows.length > 0) {
      throw new ConflictException('This user is already part of your company workspace.');
    }

    // Check seat limit
    await this.checkSeatLimit(tenantId);

    // Check tenant auth policy
    const policy = await this.getTenantAuthPolicy(tenantId);
    const emailDomain = emailParts[1].toLowerCase();
    const isPersonalDomain = ['gmail.com', 'googlemail.com', 'outlook.com', 'hotmail.com', 'live.com', 'yahoo.com', 'icloud.com'].includes(emailDomain);
    if (policy.allowPersonalEmails === false && isPersonalDomain) {
      throw new BadRequestException('Personal email addresses are not permitted for this organization.');
    }
    if (policy.allowedEmailDomains && policy.allowedEmailDomains.length > 0) {
      if (!policy.allowedEmailDomains.map((d: string) => d.toLowerCase()).includes(emailDomain)) {
        throw new BadRequestException(`Invitations for @${emailDomain} domain are not allowed by organization settings.`);
      }
    }

    // Resolve system role & custom role
    const systemRole = (dto.systemRole || 'RECRUITER').toUpperCase();
    let roleId = dto.roleId || null;
    if (!roleId) {
      const defaultRoleRes = await this.db.query(
        'SELECT id FROM custom_roles WHERE tenant_id = $1 AND (system_role = $2 OR name = $2) LIMIT 1',
        [tenantId, systemRole]
      );
      if (defaultRoleRes.rows.length > 0) {
        roleId = defaultRoleRes.rows[0].id;
      }
    }

    // Create user record in PostgreSQL
    const insertUserRes = await this.db.query(
      `INSERT INTO users (tenant_id, email, full_name, roles, role_id, branch_id, pod_id, is_active, is_approved)
       VALUES ($1, $2, $3, $4, $5, $6, $7, true, true)
       RETURNING id, email, full_name, roles, created_at`,
      [
        tenantId,
        cleanEmail,
        fullName,
        [systemRole],
        roleId,
        dto.branchId || null,
        dto.podId || null,
      ]
    );
    const newUser = insertUserRes.rows[0];

    // Generate 24-hour invitation token
    const invitationToken = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

    await this.db.query(
      `INSERT INTO user_invitations (tenant_id, email, full_name, role_id, system_role, branch_id, pod_id, invitation_token, token_expires_at, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       ON CONFLICT (tenant_id, email) DO UPDATE SET
         invitation_token = EXCLUDED.invitation_token,
         token_expires_at = EXCLUDED.token_expires_at,
         is_accepted = FALSE`,
      [
        tenantId,
        cleanEmail,
        fullName,
        roleId,
        systemRole,
        dto.branchId || null,
        dto.podId || null,
        invitationToken,
        expiresAt,
        requester.isAdmin ? 'Admin' : 'BranchAdmin',
      ]
    );

    // Fetch tenant details for email branding
    const tenantRes = await this.db.query(
      'SELECT name, domain FROM tenants WHERE id = $1 LIMIT 1',
      [tenantId]
    );
    const tenantName = tenantRes.rows[0]?.name || 'Enfycon Workspace';
    const tenantDomain = tenantRes.rows[0]?.domain || '';

    // Dispatch welcome email
    if (dto.sendEmailInvite !== false) {
      this.sendWelcomeEmail({
        to: cleanEmail,
        fullName,
        tenantName,
        subdomain: tenantDomain,
        invitationToken,
        roleName: systemRole,
      }).catch((err) => {
        this.logger.warn(`Failed to dispatch welcome email to ${cleanEmail}: ${err.message}`);
      });
    }

    return {
      success: true,
      message: 'User invited successfully.',
      user: newUser,
      invitationToken,
      expiresAt,
    };
  }

  async getInvitationDetails(token: string) {
    if (!token) throw new BadRequestException('Token is required.');
    const res = await this.db.query(
      `SELECT ui.id, ui.email, ui.full_name, ui.system_role, ui.token_expires_at, ui.is_accepted,
              t.name as tenant_name, t.domain as tenant_domain
       FROM user_invitations ui
       JOIN tenants t ON ui.tenant_id = t.id
       WHERE ui.invitation_token = $1 LIMIT 1`,
      [token]
    );
    if (res.rows.length === 0) {
      throw new NotFoundException('Invitation token is invalid or does not exist.');
    }
    const row = res.rows[0];
    const isExpired = new Date(row.token_expires_at).getTime() < Date.now();
    return {
      email: row.email,
      fullName: row.full_name,
      systemRole: row.system_role,
      tenantName: row.tenant_name,
      tenantDomain: row.tenant_domain,
      isExpired,
      isAccepted: row.is_accepted,
    };
  }

  async acceptInvite(dto: AcceptInviteDto) {
    if (!dto.token || !dto.password) {
      throw new BadRequestException('Token and password are required.');
    }
    if (dto.password.length < 8) {
      throw new BadRequestException('Password must be at least 8 characters long.');
    }

    const res = await this.db.query(
      `SELECT ui.*, t.domain as tenant_domain FROM user_invitations ui
       JOIN tenants t ON ui.tenant_id = t.id
       WHERE ui.invitation_token = $1 LIMIT 1`,
      [dto.token]
    );
    if (res.rows.length === 0) {
      throw new NotFoundException('Invitation token is invalid.');
    }
    const invite = res.rows[0];
    if (new Date(invite.token_expires_at).getTime() < Date.now()) {
      throw new BadRequestException('Invitation has expired. Please contact your administrator for a new invite.');
    }

    const { hash, salt } = this.hashPassword(dto.password);
    await this.db.query(
      `UPDATE users SET password_hash = $1, salt = $2, is_active = true, is_approved = true, updated_at = NOW()
       WHERE LOWER(email) = LOWER($3) AND tenant_id = $4`,
      [hash, salt, invite.email, invite.tenant_id]
    );

    await this.db.query(
      `UPDATE user_invitations SET is_accepted = true WHERE id = $1`,
      [invite.id]
    );

    return {
      success: true,
      message: 'Password created successfully! You can now log in.',
      email: invite.email,
      subdomain: invite.tenant_domain,
    };
  }

  async verifyCustomDomain(tenantId: string, domainName: string) {
    const normalized = (domainName || '').toLowerCase().trim();
    if (!normalized) throw new BadRequestException('Domain name is required.');

    const res = await this.db.query(
      'SELECT id, verification_token, verification_status FROM tenant_domains WHERE LOWER(domain_name) = $1 AND tenant_id = $2 LIMIT 1',
      [normalized, tenantId]
    );
    if (res.rows.length === 0) {
      throw new NotFoundException('Domain mapping not found.');
    }

    const isLocal = normalized.endsWith('.local') || normalized.includes('localhost') || (process.env.NODE_ENV !== 'production' && !normalized.includes('.'));
    if (isLocal) {
      await this.db.query(
        `UPDATE tenant_domains SET verification_status = 'VERIFIED', ssl_status = 'ACTIVE', verified_at = NOW()
         WHERE id = $1`,
        [res.rows[0].id]
      );
      return {
        success: true,
        verified: true,
        status: 'VERIFIED',
        domainName: normalized,
        sslStatus: 'ACTIVE',
        message: 'Domain verified in development mode.',
      };
    }

    // Authoritative DNS verification using Google (8.8.8.8) and Cloudflare (1.1.1.1) DNS servers
    const resolver = new dns.Resolver();
    resolver.setServers(['8.8.8.8', '1.1.1.1']);

    let dnsMatched = false;
    let matchDetail = '';

    // 1. Check CNAME record
    try {
      const cnames = await resolver.resolveCname(normalized);
      this.logger.log(`DNS check CNAME for ${normalized}: ${JSON.stringify(cnames)}`);
      const baseDomain = (process.env.BASE_DOMAIN || 'enfyjobs.com').toLowerCase();
      const validCname = cnames.some(c => {
        const cleanC = c.toLowerCase().replace(/\.$/, '');
        return cleanC.endsWith(baseDomain) || cleanC === baseDomain;
      });
      if (validCname) {
        dnsMatched = true;
        matchDetail = `CNAME points to ${cnames.join(', ')}`;
      }
    } catch (e: any) {
      this.logger.debug(`CNAME resolution not found for ${normalized}: ${e.message}`);
    }

    // 2. Check A record (IPv4)
    if (!dnsMatched) {
      try {
        const aRecords = await resolver.resolve4(normalized);
        this.logger.log(`DNS check A records for ${normalized}: ${JSON.stringify(aRecords)}`);
        const serverIp = process.env.VPS_IP || '13.55.100.200';
        if (aRecords.includes(serverIp)) {
          dnsMatched = true;
          matchDetail = `A record points to server IP ${serverIp}`;
        }
      } catch (e: any) {
        this.logger.debug(`A record resolution not found for ${normalized}: ${e.message}`);
      }
    }

    if (!dnsMatched) {
      await this.db.query(
        `UPDATE tenant_domains SET verification_status = 'PENDING', ssl_status = 'PENDING'
         WHERE id = $1`,
        [res.rows[0].id]
      );
      return {
        success: false,
        verified: false,
        status: 'PENDING',
        domainName: normalized,
        sslStatus: 'PENDING',
        message: `DNS records not detected yet for ${normalized}. Please ensure your CNAME points to enfyjobs.com (or an A record points to 13.55.100.200). Note that DNS propagation can take a few minutes.`,
      };
    }

    // Mark as VERIFIED and SSL ACTIVE
    await this.db.query(
      `UPDATE tenant_domains SET verification_status = 'VERIFIED', ssl_status = 'ACTIVE', verified_at = NOW()
       WHERE id = $1`,
      [res.rows[0].id]
    );

    return {
      success: true,
      verified: true,
      status: 'VERIFIED',
      domainName: normalized,
      sslStatus: 'ACTIVE',
      message: `DNS verified successfully (${matchDetail}) and SSL is active!`,
    };
  }

  private async sendWelcomeEmail(options: {
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
        tls: {
          rejectUnauthorized: false,
        },
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
        this.logger.log(`[MAILER] Welcome invitation email dispatched to ${options.to} from ${process.env.SMTP_FROM || fromAddress}`);
      } else {
        this.logger.log(`[MAILER] Welcome invitation email generated for ${options.to} (SMTP_HOST not set, logging only)`);
      }
    } catch (err: any) {
      this.logger.warn(`[MAILER] Could not dispatch welcome email to ${options.to}: ${err.message}`);
    }
  }

  private async sendMemberCredentialsEmail(options: {
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
            <a href="${workspaceLoginUrl}" style="display: inline-block; background-color: #4f46e5; color: #ffffff; padding: 12px 28px; text-decoration: none; border-radius: 8px; font-weight: bold; font-size: 15px; box-shadow: 0 4px 6px -1px rgba(79, 70, 229, 0.2);">
              Sign In to Your Workspace &rarr;
            </a>
          </div>

          <div style="border-top: 1px solid #e2e8f0; padding-top: 16px; margin-top: 24px;">
            <h4 style="margin: 0 0 8px 0; color: #334155; font-size: 13px;">📋 Quick Login Guide:</h4>
            <ol style="font-size: 13px; color: #64748b; line-height: 1.6; padding-left: 18px; margin: 0;">
              <li>Click the button above or navigate to <a href="${workspaceLoginUrl}" style="color: #4f46e5;">${workspaceLoginUrl}</a></li>
              <li>Enter your email (<strong style="color: #1e293b;">${options.to}</strong>) and password</li>
              <li>Or simply click <strong style="color: #1e293b;">Sign in with Microsoft / Google</strong> to access with corporate SSO.</li>
            </ol>
          </div>

          <hr style="border: none; border-top: 1px solid #f1f5f9; margin: 24px 0 16px 0;" />
          <p style="font-size: 11px; color: #94a3b8; text-align: center; margin: 0;">
            EnfySync AI Recruitment Platform &bull; ${options.tenantName}
          </p>
        </div>
      `;

      // Check if tenant has connected a direct email account (Model 1: BYOE)
      if (options.tenantId) {
        const accRes = await this.db.query(
          `SELECT id, provider, email_address, access_token, refresh_token, smtp_host, smtp_port, password, require_ssl
           FROM mass_mail.email_accounts 
           WHERE tenant_id = $1 AND is_active = true 
           ORDER BY is_default DESC, created_at DESC LIMIT 1`,
          [options.tenantId]
        );

        if (accRes.rows.length > 0) {
          const acc = accRes.rows[0];
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
              this.logger.log(`[AUTH_MAILER] Dispatched welcome credentials email via Tenant Microsoft 365 (${acc.email_address}) to ${options.to}`);
              return;
            } catch (graphErr: any) {
              this.logger.warn(`[AUTH_MAILER] Direct Microsoft dispatch failed (${graphErr.message}), falling back to SMTP relay.`);
            }
          } else if (acc.provider === 'smtp' && acc.smtp_host) {
            try {
              const customTransporter = nodemailer.createTransport({
                host: acc.smtp_host,
                port: acc.smtp_port || 587,
                secure: acc.require_ssl || acc.smtp_port === 465,
                auth: { user: acc.email_address, pass: acc.password },
                tls: { rejectUnauthorized: false },
              });
              await customTransporter.sendMail({
                from: `"${options.tenantName}" <${acc.email_address}>`,
                to: options.to,
                subject,
                html,
              });
              this.logger.log(`[AUTH_MAILER] Dispatched welcome credentials email via Tenant SMTP (${acc.email_address}) to ${options.to}`);
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
        tls: {
          rejectUnauthorized: false,
        },
      });

      if (process.env.SMTP_HOST) {
        await transporter.sendMail({
          from: process.env.SMTP_FROM || fromAddress,
          replyTo: replyTo,
          to: options.to,
          subject,
          html,
        });
        this.logger.log(`[AUTH_MAILER] Member credentials email dispatched to ${options.to} from ${process.env.SMTP_FROM || fromAddress}`);
      } else {
        this.logger.log(`[AUTH_MAILER] Member credentials email generated for ${options.to} (SMTP_HOST not set, logging only)`);
      }
    } catch (err: any) {
      this.logger.warn(`[AUTH_MAILER] Could not dispatch member credentials email to ${options.to}: ${err.message}`);
    }
  }

  private decodeTokenPayload(token: string): any {
    try {
      const parts = token.split('.');
      if (parts.length !== 3) return null;
      return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    } catch {
      return null;
    }
  }

  private async getRequesterInfoFromToken(authHeader?: string): Promise<{ roles: string[]; tenantId: string | null; isAdmin: boolean }> {
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return { roles: [], tenantId: null, isAdmin: false };
    }
    const token = authHeader.slice(7).trim();
    const payload = this.decodeTokenPayload(token);
    if (!payload) {
      return { roles: [], tenantId: null, isAdmin: false };
    }

    const email = (payload.email || payload.preferred_username || '').toLowerCase();
    const sub = payload.sub || '';

    let dbRoles: string[] = [];
    let dbTenantId: string | null = null;
    if (email || sub) {
      const userRes = await this.db.query(
        `SELECT tenant_id, roles FROM users WHERE email = $1 OR keycloak_id = $2 OR id::text = $3 LIMIT 1`,
        [email, sub, sub]
      );
      if (userRes.rows.length > 0) {
        dbRoles = userRes.rows[0].roles || [];
        dbTenantId = userRes.rows[0].tenant_id || null;
      }
    }

    let jwtRoles: string[] = payload.roles || [];
    if (payload.realm_access?.roles) {
      jwtRoles = [...jwtRoles, ...payload.realm_access.roles];
    }

    const allRoles = Array.from(new Set([...jwtRoles, ...dbRoles])).map((r) => r.toUpperCase());
    const tenantId = dbTenantId || payload.tenantId || null;
    const isAdmin = allRoles.includes('ADMIN') || allRoles.includes('SUPER_ADMIN');

    return { roles: allRoles, tenantId, isAdmin };
  }
}
