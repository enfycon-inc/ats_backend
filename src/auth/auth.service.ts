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
import { DatabaseService } from '../database/database.service';
import { LoginDto } from './dtos/login.dto';
import { RegisterDto } from './dtos/register.dto';
import { RegisterTenantDto } from './dtos/register-tenant.dto';

const DEFAULT_TENANT_ID = process.env.DEFAULT_TENANT_ID || 'd3b07384-d113-49c3-a555-9ee75c13ca33';

// Token TTL: 8 hours for mock (matches a typical work day)
const TOKEN_TTL_SECONDS = 60 * 60 * 8;

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * AuthService
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Handles ALL authentication logic for both mock and Keycloak modes.
 *
 * MOCK MODE (AUTH_PROVIDER=mock):
 *  - Users are stored in the `users` PostgreSQL table (created on boot).
 *  - Passwords are hashed with SHA-256 + salt (lightweight, no bcrypt dep needed).
 *  - Login returns a real, signed JWT containing the user's claims.
 *  - The frontend stores this token and sends it as Bearer on every request.
 *  - Feels identical to production from the frontend perspective.
 *
 * KEYCLOAK MODE (AUTH_PROVIDER=keycloak):
 *  - Direct grant / Token exchange via Keycloak protocol endpoint.
 *  - syncKeycloakUser() is called to upsert the user into the local `users` table from decoded JWT claims.
 * ─────────────────────────────────────────────────────────────────────────────
 */
@Injectable()
export class AuthService implements OnModuleInit {
  private readonly logger = new Logger(AuthService.name);
  private readonly jwtSecret: string;
  private readonly provider: string;

  constructor(private readonly db: DatabaseService) {
    this.jwtSecret =
      process.env.MOCK_JWT_SECRET || 'enfy-ats-dev-jwt-secret-change-me-in-prod';
    this.provider = (process.env.AUTH_PROVIDER || 'mock').toLowerCase();
  }

  // ─────────────────────────────────────────────────────────────
  // Module boot: ensure users table exists and seed defaults
  // ─────────────────────────────────────────────────────────────
  async onModuleInit() {
    await this.ensureUsersTable();
    
    // Sync all existing tenants with new system permissions
    try {
      const tenantsResult = await this.db.query('SELECT id FROM tenants');
      for (const tenant of tenantsResult.rows) {
        await this.seedTenantRoles(tenant.id);
      }
      this.logger.log('All tenant default roles and permissions successfully synchronized.');
    } catch (err) {
      this.logger.error(`Failed to synchronize tenant roles: ${err.message}`);
    }

    await this.seedDefaultUsers();

    if (this.provider === 'keycloak') {
      const adminEmail = process.env.PLATFORM_ADMIN_EMAIL;
      const adminPassword = process.env.PLATFORM_ADMIN_PASSWORD;
      const adminName = process.env.PLATFORM_ADMIN_NAME || 'Platform Super Admin';
      if (adminEmail && adminPassword) {
        this.logger.log(`[BOOT] Syncing Platform Super Admin (${adminEmail}) into Keycloak on startup...`);
        await this.provisionUserInKeycloak({
          email: adminEmail,
          password: adminPassword,
          fullName: adminName,
          tenantId: DEFAULT_TENANT_ID,
        });
      } else {
        this.logger.warn(`[BOOT] PLATFORM_ADMIN_EMAIL or PLATFORM_ADMIN_PASSWORD not set in environment — skipping Keycloak Super Admin sync.`);
      }
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
      UPDATE custom_roles SET system_role = 'TRACKER' WHERE name = 'TRACKER';
      UPDATE custom_roles SET system_role = 'POD_LEAD' WHERE name = 'POD_LEAD';

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

      -- Add branch_id and business_unit_id to users
      ALTER TABLE users ADD COLUMN IF NOT EXISTS branch_id UUID REFERENCES branches(id) ON DELETE SET NULL;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS business_unit_id UUID REFERENCES business_units(id) ON DELETE SET NULL;

      -- Update any existing users with null value to true
      UPDATE users SET is_approved = true WHERE is_approved IS NULL;

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
    this.logger.log(`Login attempt for ${dto.email} [Provider: ${this.provider}]`);

    const result = await this.db.query(
      `SELECT u.id, u.email, u.full_name, u.password_hash, u.salt, u.roles, u.is_active, u.is_approved, u.tenant_id, u.role_id, u.pod_id, u.branch_id, u.business_unit_id, t.default_market, t.domain as tenant_domain, t.status as tenant_status, t.pod_system_enabled, cr.system_role, b.name as branch_name, bu.name as business_unit_name
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

    // Check if user is active/approved
    if (!user.is_active) {
      throw new UnauthorizedException(
        'Your account has been deactivated. Contact your administrator.',
      );
    }

    if (!user.is_approved) {
      throw new UnauthorizedException(
        'Your account is pending approval by the administrator.',
      );
    }

    // Enforce tenant active status check
    if (user.tenant_status && user.tenant_status !== 'ACTIVE') {
      throw new UnauthorizedException(
        'Your company workspace is inactive. Contact the platform administrator.',
      );
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

    // Validate subdomain context
    const isSuperAdmin = user.roles && user.roles.includes('SUPER_ADMIN');
    if (isSuperAdmin && dto.subdomain && dto.subdomain !== 'www' && dto.subdomain !== 'localhost' && dto.subdomain !== 'enfycon.com') {
      throw new UnauthorizedException('Super Administrators can only log in from the main domain.');
    }

    if (!isSuperAdmin && dto.subdomain && dto.subdomain !== 'www' && dto.subdomain !== 'localhost' && dto.subdomain !== 'enfycon.com') {
      const cleanSubdomain = dto.subdomain.trim().toLowerCase();
      const domainMapping = await this.db.query(
        `SELECT tenant_id FROM tenant_domains WHERE LOWER(domain_name) = $1
         UNION
         SELECT id as tenant_id FROM tenants WHERE LOWER(domain) = $1
         LIMIT 1`,
        [cleanSubdomain]
      );
      if (domainMapping.rows.length > 0) {
        const mappedTenantId = domainMapping.rows[0].tenant_id;
        if (user.tenant_id !== mappedTenantId) {
          throw new UnauthorizedException('User does not belong to this company workspace.');
        }
      } else {
        throw new UnauthorizedException('Workspace not found.');
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

    // ── KEYCLOAK MODE AUTHENTICATION ──────────────────────────
    if (this.provider === 'keycloak') {
      const issuer = process.env.KEYCLOAK_ISSUER;
      if (!issuer) {
        throw new Error('[AuthService] AUTH_PROVIDER=keycloak but KEYCLOAK_ISSUER is not set in .env');
      }

      try {
        const params = new URLSearchParams();
        params.append('grant_type', 'password');
        params.append('client_id', process.env.KEYCLOAK_CLIENT_ID || 'ats-frontend');
        if (process.env.KEYCLOAK_CLIENT_SECRET) {
          params.append('client_secret', process.env.KEYCLOAK_CLIENT_SECRET);
        }
        params.append('username', dto.email);
        params.append('password', dto.password);

        let tokenUrl = `${issuer}/protocol/openid-connect/token`;
        let res: Response;
        try {
          res = await fetch(tokenUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: params.toString(),
          });
        } catch (fetchErr: any) {
          const fallbackHost = tokenUrl.includes('localhost') ? 'keycloak' : 'localhost';
          const fallbackUrl = tokenUrl.includes('localhost') 
            ? tokenUrl.replace('localhost', 'keycloak') 
            : tokenUrl.replace('keycloak', 'localhost');
          
          this.logger.warn(`Fetch to Keycloak at ${tokenUrl} failed (${fetchErr.message}). Retrying fallback endpoint: ${fallbackUrl}`);
          try {
            res = await fetch(fallbackUrl, {
              method: 'POST',
              headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
              body: params.toString(),
            });
          } catch (retryErr: any) {
            throw new UnauthorizedException(`Keycloak server unreachable at ${tokenUrl} or ${fallbackUrl}.`);
          }
        }

        if (!res || !res.ok) {
          // Check if user exists in PostgreSQL DB with valid password
          const { hash } = this.hashPassword(dto.password, user.salt);
          if (hash === user.password_hash) {
            this.logger.log(`User ${dto.email} has valid local DB credentials but is missing in Keycloak. Auto-provisioning...`);
            const provisioned = await this.provisionUserInKeycloak({
              email: user.email,
              password: dto.password,
              fullName: user.full_name,
              tenantId: user.tenant_id,
            });

            if (provisioned) {
              try {
                res = await fetch(tokenUrl, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                  body: params.toString(),
                });
              } catch (retryErr: any) {}
            }
          }
        }

        if (!res || !res.ok) {
          const errBody = res ? await res.text().catch(() => '') : '';
          this.logger.warn(`Keycloak auth failed for ${dto.email}: Status ${res?.status} - ${errBody}`);
          throw new UnauthorizedException('Invalid email or password.');
        }

        const tokenData = await res.json();
        const keycloakToken = tokenData.access_token;

        await this.syncKeycloakUser({
          keycloakId: user.id,
          email: user.email,
          fullName: user.full_name,
          roles: user.roles || [],
        });

        return {
          accessToken: keycloakToken,
          refreshToken: tokenData.refresh_token,
          expiresIn: tokenData.expires_in,
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
            branchName: user.branch_name || null,
            businessUnitId: user.business_unit_id || null,
            businessUnitName: user.business_unit_name || null,
            podSystemEnabled: user.pod_system_enabled ?? true,
          },
        };
      } catch (err: any) {
        if (err instanceof UnauthorizedException) throw err;
        this.logger.error(`Keycloak direct grant exception for ${dto.email}: ${err.message}`);
        throw new UnauthorizedException('Keycloak authentication server unreachable or rejected credentials.');
      }
    }

    // ── MOCK MODE AUTHENTICATION ─────────────────────────────
    const { hash } = this.hashPassword(dto.password, user.salt);
    if (hash !== user.password_hash) {
      throw new UnauthorizedException('Invalid email or password.');
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
        branchName: user.branch_name || null,
        businessUnitId: user.business_unit_id,
        businessUnitName: user.business_unit_name || null,
        podSystemEnabled: user.pod_system_enabled !== false,
      },
    };
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

    // Verify if requester is a tenant admin or super admin
    let requesterIsAdmin = false;
    let requesterTenantId: string | null = null;
    let requesterRoles: string[] = [];
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.slice(7).trim();
      const payload = this.verifyJwt(token);
      if (payload) {
        requesterRoles = payload.roles || [];
        requesterIsAdmin = requesterRoles.includes('ADMIN') || requesterRoles.includes('SUPER_ADMIN');
        requesterTenantId = payload.tenantId || null;
      }
    }

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

    if (this.provider === 'keycloak') {
      await this.provisionUserInKeycloak({
        email: user.email,
        password: password,
        fullName: user.full_name,
        tenantId: user.tenant_id,
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

    if (this.provider === 'keycloak') {
      await this.provisionUserInKeycloak({
        email: user.email,
        password: password,
        fullName: user.full_name,
        tenantId: tenant.id,
      });
    }

    return {
      message: 'Company registered successfully! Your account is pending platform administrator approval. You will be notified once approved.',
      tenant: {
        id: tenant.id,
        name: tenant.name,
        subdomain: tenant.domain,
        workspaceUrl: `${tenant.domain}.enfycon.com`,
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

    // Load custom role permissions dynamically
    let permissions: string[] = [];
    if (dbUser.role_id) {
      const permsRes = await this.db.query(
        'SELECT permission FROM role_permissions WHERE role_id = $1',
        [dbUser.role_id]
      );
      permissions = permsRes.rows.map(row => row.permission);
    }

    return {
      ...dbUser,
      permissions
    };
  }

  // ─────────────────────────────────────────────────────────────
  async getProfile(userId: string) {
    const result = await this.db.query(
      `SELECT u.id, u.email, u.full_name, u.roles, u.tenant_id, u.is_active, u.created_at, u.updated_at, u.role_id, u.pod_id, u.branch_id, u.business_unit_id, t.name as tenant_name, t.default_market, t.domain as tenant_domain, t.user_limit as user_limit, t.pod_system_enabled, t.candidate_pool_mode, b.name as branch_name, bu.name as business_unit_name
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
    if (u.role_id) {
      const roleRes = await this.db.query(
        'SELECT name, system_role FROM custom_roles WHERE id = $1 LIMIT 1',
        [u.role_id]
      );
      if (roleRes.rows.length > 0) {
        roleName = roleRes.rows[0].name;
        systemRole = roleRes.rows[0].system_role || systemRole;
      }

      const permsRes = await this.db.query(
        'SELECT permission FROM role_permissions WHERE role_id = $1',
        [u.role_id]
      );
      permissions = permsRes.rows.map(row => row.permission);
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
      branchName: u.branch_name || null,
      businessUnitId: u.business_unit_id,
      businessUnitName: u.business_unit_name || null,
      podSystemEnabled: u.pod_system_enabled !== false,
      candidatePoolMode: u.candidate_pool_mode || 'COMBINED_MARKET',
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
      `SELECT u.id, u.email, u.full_name, u.roles, u.is_active, u.created_at, u.role_id, u.pod_id, u.branch_id, u.business_unit_id, r.name as role_name, b.name as branch_name, bu.name as business_unit_name
       FROM users u 
       LEFT JOIN custom_roles r ON u.role_id = r.id
       LEFT JOIN branches b ON u.branch_id = b.id
       LEFT JOIN business_units bu ON u.business_unit_id = bu.id
       WHERE u.tenant_id = $1 ORDER BY u.full_name ASC`,
      [tenantId],
    );
    return result.rows.map((u) => ({
      id: u.id,
      email: u.email,
      fullName: u.full_name,
      roles: u.roles,
      roleId: u.role_id,
      roleName: u.role_name || u.roles[0] || 'RECRUITER',
      isActive: u.is_active,
      createdAt: u.created_at,
      podId: u.pod_id,
      branchId: u.branch_id,
      branchName: u.branch_name || null,
      businessUnitId: u.business_unit_id,
      businessUnitName: u.business_unit_name || null,
    }));
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

    // Find the custom role ID corresponding to the first role in the new list
    let roleId = null;
    if (normalized.length > 0) {
      const primaryRole = normalized[0];
      const roleResult = await this.db.query(
        'SELECT id FROM custom_roles WHERE tenant_id = $1 AND UPPER(name) = $2 LIMIT 1',
        [tenantId, primaryRole]
      );
      if (roleResult.rows.length > 0) {
        roleId = roleResult.rows[0].id;
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
    dto: { fullName?: string; email?: string; password?: string; branchId?: string; businessUnitId?: string; roles?: string[] },
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

    if (dto.branchId !== undefined) {
      branchId = dto.branchId || null;
    }

    if (dto.businessUnitId !== undefined) {
      businessUnitId = dto.businessUnitId || null;
    }

    await this.db.query(
      `UPDATE users
       SET full_name = $1, email = $2, password_hash = $3, salt = $4, branch_id = $5, business_unit_id = $6, updated_at = NOW()
       WHERE id = $7`,
      [fullName, email, hash, salt, branchId, businessUnitId, userId]
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
        'job:create', 'job:edit', 'job:view',
        'candidate:create', 'candidate:view',
        'submission:create', 'submission:edit',
        'tenant:settings', 'user:manage',
        'pod:create', 'pod:edit', 'pod:delete', 'pod:view', 'pod:reset_cycle'
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
        'pod:create', 'pod:edit', 'pod:delete', 'pod:view', 'pod:reset_cycle'
      ],
      TRACKER: [
        'submission:view', 'candidate:view'
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

    const result: any[] = [];
    for (const role of roles) {
      const permsRes = await this.db.query(
        'SELECT permission FROM role_permissions WHERE role_id = $1',
        [role.id]
      );
      result.push({
        ...role,
        permissions: permsRes.rows.map(row => row.permission)
      });
    }
    return result;
  }

  async createCustomRole(tenantId: string, name: string, description: string, permissions: string[], systemRole?: string) {
    const nameUpper = name.toUpperCase().trim();
    if (['SUPER_ADMIN', 'ADMIN', 'BRANCH_ADMIN', 'RECRUITER', 'ACCOUNT_MANAGER', 'DELIVERY_HEAD', 'TRACKER', 'POD_LEAD'].includes(nameUpper)) {
      throw new BadRequestException('Role name conflicts with a default system role.');
    }

    const resolvedSystemRole = systemRole?.toUpperCase().trim() || 'RECRUITER';
    if (!['ADMIN', 'BRANCH_ADMIN', 'ACCOUNT_MANAGER', 'RECRUITER', 'DELIVERY_HEAD', 'TRACKER', 'POD_LEAD'].includes(resolvedSystemRole)) {
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
        TRACKER: [
          'submission:view', 'candidate:view'
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

  async deleteCustomRole(tenantId: string, roleId: string) {
    const roleResult = await this.db.query(
      'SELECT id, is_system FROM custom_roles WHERE id = $1 AND tenant_id = $2 LIMIT 1',
      [roleId, tenantId]
    );
    if (roleResult.rows.length === 0) {
      throw new NotFoundException('Role not found.');
    }
    if (roleResult.rows[0].is_system) {
      throw new BadRequestException('You cannot delete default system roles.');
    }

    // Re-assign users under this role to RECRUITER fallback role
    const fallbackRes = await this.db.query(
      "SELECT id FROM custom_roles WHERE tenant_id = $1 AND name = 'RECRUITER' LIMIT 1",
      [tenantId]
    );
    const fallbackRoleId = fallbackRes.rows[0]?.id;

    if (fallbackRoleId) {
      await this.db.query(
        'UPDATE users SET role_id = $1 WHERE role_id = $2',
        [fallbackRoleId, roleId]
      );
    }

    await this.db.query('DELETE FROM custom_roles WHERE id = $1', [roleId]);
    return { message: 'Custom role deleted successfully.' };
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
      { id: 'job:create', name: 'Create Jobs', group: 'Jobs Management' },
      { id: 'job:edit', name: 'Edit Jobs', group: 'Jobs Management' },
      { id: 'job:view', name: 'View Jobs', group: 'Jobs Management' },
      { id: 'candidate:create', name: 'Create Candidates', group: 'Candidates' },
      { id: 'candidate:view', name: 'View Candidates', group: 'Candidates' },
      { id: 'submission:create', name: 'Create Submissions', group: 'Submissions' },
      { id: 'submission:edit', name: 'Edit Submissions', group: 'Submissions' },
      { id: 'tenant:settings', name: 'Manage Company Settings', group: 'Administration' },
      { id: 'user:manage', name: 'Manage Staff & Roles', group: 'Administration' },
      { id: 'pod:create', name: 'Create Pods', group: 'Pods Management' },
      { id: 'pod:edit', name: 'Edit Pods & Assign Unassigned Jobs', group: 'Pods Management' },
      { id: 'pod:delete', name: 'Delete Pods', group: 'Pods Management' },
      { id: 'pod:view', name: 'View Pods', group: 'Pods Management' },
      { id: 'pod:reset_cycle', name: 'Reset Assignment Cycle', group: 'Pods Management' },
      { id: 'pod:overlap', name: 'Authorize Pod Assignment Overlaps', group: 'Pods Management' },
      { id: 'branch_admin:manage', name: 'Manage Branch Office & Staff', group: 'Branch & Multi-Office Management' },
      { id: 'candidate:search_all_branches', name: 'Search Candidates Across All Branches', group: 'Branch & Multi-Office Management' },
      { id: 'job:view_all_branches', name: 'View Jobs Across All Branches', group: 'Branch & Multi-Office Management' },
      { id: 'candidate:search_all_markets', name: 'Search Candidates Across All Markets (US + India)', group: 'Branch & Multi-Office Management' },
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

  private verifyJwt(token: string): any {
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
      'SELECT id, domain_name, is_primary, created_at FROM tenant_domains WHERE tenant_id = $1 ORDER BY created_at ASC',
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
      `INSERT INTO tenant_domains (tenant_id, domain_name, is_primary)
       VALUES ($1, $2, FALSE)
       RETURNING id, domain_name, is_primary, created_at`,
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
    return { message: 'Domain mapping deleted successfully.' };
  }

  async updateTenantSettings(tenantId: string, settings: { podSystemEnabled?: boolean; candidatePoolMode?: string }) {
    this.logger.log(`Updating tenant settings for ${tenantId}: ${JSON.stringify(settings)}`);
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
        allowMicrosoftSso: false,
        allowGoogleSso: false,
        enforceSsoOnly: false,
        requireMfa: false,
        allowedEmailDomains: [],
        microsoftClientId: null,
      };
    }

    const row = result.rows[0];
    return {
      tenantId: row.tenant_id,
      allowPasswordLogin: row.allow_password_login ?? true,
      allowMicrosoftSso: row.allow_microsoft_sso ?? false,
      allowGoogleSso: row.allow_google_sso ?? false,
      enforceSsoOnly: row.enforce_sso_only ?? false,
      requireMfa: row.require_mfa ?? false,
      allowedEmailDomains: row.allowed_email_domains || [],
      microsoftClientId: row.microsoft_client_id || null,
    };
  }

  async updateTenantAuthPolicy(tenantId: string, dto: any) {
    const result = await this.db.query(
      `INSERT INTO tenant_auth_settings (
         tenant_id, allow_password_login, allow_microsoft_sso, allow_google_sso, enforce_sso_only, require_mfa, allowed_email_domains, microsoft_client_id, microsoft_client_secret
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (tenant_id) DO UPDATE SET
         allow_password_login    = EXCLUDED.allow_password_login,
         allow_microsoft_sso     = EXCLUDED.allow_microsoft_sso,
         allow_google_sso        = EXCLUDED.allow_google_sso,
         enforce_sso_only        = EXCLUDED.enforce_sso_only,
         require_mfa             = EXCLUDED.require_mfa,
         allowed_email_domains   = EXCLUDED.allowed_email_domains,
         microsoft_client_id     = EXCLUDED.microsoft_client_id,
         microsoft_client_secret = COALESCE(EXCLUDED.microsoft_client_secret, tenant_auth_settings.microsoft_client_secret),
         updated_at              = NOW()
       RETURNING *`,
      [
        tenantId,
        dto.allowPasswordLogin ?? true,
        dto.allowMicrosoftSso ?? false,
        dto.allowGoogleSso ?? false,
        dto.enforceSsoOnly ?? false,
        dto.requireMfa ?? false,
        dto.allowedEmailDomains || [],
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
      allowedEmailDomains: row.allowed_email_domains,
      microsoftClientId: row.microsoft_client_id,
    };
  }
}
