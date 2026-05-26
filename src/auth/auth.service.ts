import {
  Injectable,
  Logger,
  OnModuleInit,
  UnauthorizedException,
  ConflictException,
  NotFoundException,
  BadRequestException,
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
 *  - login() is NOT used — the frontend redirects to Keycloak.
 *  - syncKeycloakUser() is called by JwtAuthGuard on every request to upsert
 *    the user into the local `users` table from the decoded JWT claims.
 *
 * Default seed users (created on boot in mock mode):
 *  Role             | Email                            | Password
 *  ──────────────── | ─────────────────────────────── | ────────────────────
 *  ADMIN            | admin@enfycon.com                | enfycon123
 *  RECRUITER        | recruiter@enfycon.com            | enfycon123
 *  ACCOUNT_MANAGER  | am@enfycon.com                   | enfycon123
 *  DELIVERY_HEAD    | dh@enfycon.com                   | enfycon123
 *  TRACKER          | tracker@enfycon.com              | enfycon123
 * ─────────────────────────────────────────────────────────────────────────────
 */
@Injectable()
export class AuthService implements OnModuleInit {
  private readonly logger = new Logger(AuthService.name);
  private readonly jwtSecret: string;
  private readonly provider: string;

  constructor(private readonly db: DatabaseService) {
    this.jwtSecret =
      process.env.MOCK_JWT_SECRET || 'enfy-ats-dev-secret-change-in-prod';
    this.provider = (process.env.AUTH_PROVIDER || 'mock').toLowerCase();
  }

  // ─────────────────────────────────────────────────────────────
  // Module boot: ensure users table exists and seed defaults
  // ─────────────────────────────────────────────────────────────
  async onModuleInit() {
    await this.ensureUsersTable();
    if (this.provider === 'mock') {
      await this.seedDefaultUsers();
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

      -- Update any existing users with null value to true
      UPDATE users SET is_approved = true WHERE is_approved IS NULL;
    `;
    try {
      await this.db.query(ddl);
      this.logger.log('Users and RBAC tables verified/created.');
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
  // MOCK MODE: Login
  // ─────────────────────────────────────────────────────────────
  async login(dto: LoginDto) {
    this.logger.log(`Login attempt: ${dto.email}`);

    const result = await this.db.query(
      `SELECT u.id, u.email, u.full_name, u.password_hash, u.salt, u.roles, u.is_active, u.is_approved, u.tenant_id, u.role_id, t.default_market, t.domain as tenant_domain
       FROM users u
       LEFT JOIN tenants t ON u.tenant_id = t.id
       WHERE u.email = $1 LIMIT 1`,
      [dto.email],
    );

    if (result.rows.length === 0) {
      throw new UnauthorizedException('Invalid email or password.');
    }

    const user = result.rows[0];

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

    const { hash } = this.hashPassword(dto.password, user.salt);
    if (hash !== user.password_hash) {
      throw new UnauthorizedException('Invalid email or password.');
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

    const token = this.signJwt({
      sub: user.id,
      email: user.email,
      fullName: user.full_name,
      roles: user.roles,
      tenantId: user.tenant_id || DEFAULT_TENANT_ID,
      defaultMarket: user.default_market || 'US',
      tenantDomain: user.tenant_domain || '',
      permissions,
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
      },
    };
  }

  // ─────────────────────────────────────────────────────────────
  // MOCK MODE: Register new user
  // ─────────────────────────────────────────────────────────────
  async register(dto: RegisterDto) {
    this.logger.log(`Registering user: ${dto.email} [${dto.role}]`);

    const exists = await this.db.query(
      'SELECT id FROM users WHERE email = $1 LIMIT 1',
      [dto.email],
    );
    if (exists.rows.length > 0) {
      throw new ConflictException(
        `Email ${dto.email} is already registered.`,
      );
    }

    const role = dto.role?.toUpperCase() || 'RECRUITER';
    const tenantId = dto.tenantId || DEFAULT_TENANT_ID;

    // Find the dynamic role ID corresponding to the requested role name
    let roleId = null;
    const roleResult = await this.db.query(
      'SELECT id FROM custom_roles WHERE tenant_id = $1 AND UPPER(name) = $2 LIMIT 1',
      [tenantId, role]
    );
    if (roleResult.rows.length > 0) {
      roleId = roleResult.rows[0].id;
    }

    const { hash, salt } = this.hashPassword(dto.password);

    // New user registrations default to unapproved (is_approved = false)
    const result = await this.db.query(
      `INSERT INTO users (tenant_id, email, full_name, password_hash, salt, roles, is_active, is_approved, role_id)
       VALUES ($1, $2, $3, $4, $5, $6, true, false, $7)
       RETURNING id, email, full_name, roles, tenant_id, created_at, role_id`,
      [tenantId, dto.email, dto.fullName, hash, salt, [role], roleId],
    );

    const user = result.rows[0];
    return {
      message: 'User registered successfully. Pending administrator approval.',
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
    this.logger.log(`New tenant registration: ${dto.companyName} [${dto.subdomain}] by ${dto.email}`);

    // 1. Validate subdomain format
    if (!dto.subdomain || !/^[a-z0-9-]+$/.test(dto.subdomain)) {
      throw new BadRequestException('Subdomain must contain only lowercase letters, numbers, and hyphens.');
    }

    // 2. Check subdomain uniqueness
    const subdomainExists = await this.db.query(
      'SELECT id FROM tenants WHERE domain = $1 LIMIT 1',
      [dto.subdomain],
    );
    if (subdomainExists.rows.length > 0) {
      throw new ConflictException(`Subdomain "${dto.subdomain}" is already taken. Please choose another.`);
    }

    // 3. Check email uniqueness
    const emailExists = await this.db.query(
      'SELECT id FROM users WHERE email = $1 LIMIT 1',
      [dto.email],
    );
    if (emailExists.rows.length > 0) {
      throw new ConflictException(`Email "${dto.email}" is already registered.`);
    }

    // 4. Create the new tenant (status = PENDING until admin approves)
    const tenantResult = await this.db.query(
      `INSERT INTO tenants (name, domain, status, default_market)
       VALUES ($1, $2, 'PENDING', 'US')
       RETURNING id, name, domain, status`,
      [dto.companyName, dto.subdomain],
    );
    const tenant = tenantResult.rows[0];

    // 5. Seed the default custom roles & permissions for this new company tenant
    const roleMap = await this.seedTenantRoles(tenant.id);
    const adminRoleId = roleMap['ADMIN'];

    // 6. Create the first admin user for this tenant (is_approved = false)
    const { hash, salt } = this.hashPassword(dto.password);
    const userResult = await this.db.query(
      `INSERT INTO users (tenant_id, email, full_name, password_hash, salt, roles, is_active, is_approved, role_id)
       VALUES ($1, $2, $3, $4, $5, $6, true, false, $7)
       RETURNING id, email, full_name, roles, tenant_id, created_at, role_id`,
      [tenant.id, dto.email, dto.fullName, hash, salt, ['ADMIN'], adminRoleId],
    );
    const user = userResult.rows[0];

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
      'SELECT id, roles, tenant_id, is_active, role_id FROM users WHERE keycloak_id = $1 LIMIT 1',
      [data.keycloakId],
    );

    const internalRoles = ['TRACKER']; // roles assigned internally, not from Keycloak
    const preservedRoles = existing.rows.length > 0
      ? (existing.rows[0].roles || []).filter((r: string) => internalRoles.includes(r))
      : [];

    const mergedRoles = Array.from(new Set([...normalizedRoles, ...preservedRoles]));

    const tenantId = existing.rows.length > 0
      ? existing.rows[0].tenant_id
      : DEFAULT_TENANT_ID;

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

    const result = await this.db.query(
      `INSERT INTO users (keycloak_id, tenant_id, email, full_name, roles, is_active, is_approved, role_id)
       VALUES ($1, $2, $3, $4, $5, true, true, $6)
       ON CONFLICT (keycloak_id) DO UPDATE SET
         email      = EXCLUDED.email,
         full_name  = EXCLUDED.full_name,
         roles      = $5,
         role_id    = COALESCE(users.role_id, $6),
         updated_at = NOW()
       RETURNING id, email, full_name, roles, tenant_id, is_active, role_id`,
      [data.keycloakId, tenantId, data.email, data.fullName, mergedRoles, roleId],
    );

    const dbUser = result.rows[0];

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
      `SELECT u.id, u.email, u.full_name, u.roles, u.tenant_id, u.is_active, u.created_at, u.updated_at, u.role_id, t.default_market, t.domain as tenant_domain
       FROM users u
       LEFT JOIN tenants t ON u.tenant_id = t.id
       WHERE u.id = $1 LIMIT 1`,
      [userId],
    );
    if (result.rows.length === 0) {
      throw new NotFoundException('User profile not found.');
    }
    const u = result.rows[0];

    // Load custom role details and permissions
    let roleName = u.roles[0] || 'RECRUITER';
    let permissions: string[] = [];
    if (u.role_id) {
      const roleRes = await this.db.query(
        'SELECT name FROM custom_roles WHERE id = $1 LIMIT 1',
        [u.role_id]
      );
      if (roleRes.rows.length > 0) {
        roleName = roleRes.rows[0].name;
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
      permissions,
      tenantId: u.tenant_id,
      isActive: u.is_active,
      createdAt: u.created_at,
      defaultMarket: u.default_market || 'US',
      tenantDomain: u.tenant_domain || '',
    };
  }

  // ─────────────────────────────────────────────────────────────
  // List all users (admin utility)
  // ─────────────────────────────────────────────────────────────
  async listUsers(tenantId: string) {
    const result = await this.db.query(
      `SELECT u.id, u.email, u.full_name, u.roles, u.is_active, u.created_at, u.role_id, r.name as role_name
       FROM users u 
       LEFT JOIN custom_roles r ON u.role_id = r.id
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
    }));
  }

  // ─────────────────────────────────────────────────────────────
  // Update user active status (admin utility)
  // ─────────────────────────────────────────────────────────────
  async setUserActive(userId: string, isActive: boolean, requesterId: string) {
    if (userId === requesterId && !isActive) {
      throw new BadRequestException('You cannot deactivate your own account.');
    }
    await this.db.query(
      `UPDATE users SET is_active = $1, updated_at = NOW() WHERE id = $2`,
      [isActive, userId],
    );
    return { message: `User ${isActive ? 'activated' : 'deactivated'} successfully.` };
  }

  // ─────────────────────────────────────────────────────────────
  // Update user roles (admin utility)
  // ─────────────────────────────────────────────────────────────
  async updateUserRoles(userId: string, roles: string[]) {
    const normalized = roles.map((r) => r.toUpperCase());
    await this.db.query(
      `UPDATE users SET roles = $1, updated_at = NOW() WHERE id = $2`,
      [normalized, userId],
    );
    return { message: 'User roles updated successfully.', roles: normalized };
  }

  // ─────────────────────────────────────────────────────────────
  // ENTERPRISE GRANULAR RBAC CRUD & PERMISSIONS MANAGEMENT (Ceipal style)
  // ─────────────────────────────────────────────────────────────
  async seedTenantRoles(tenantId: string): Promise<Record<string, string>> {
    const DEFAULT_PERMISSIONS = {
      ADMIN: [
        'job:create', 'job:edit', 'job:view',
        'candidate:create', 'candidate:view',
        'submission:create', 'submission:edit',
        'tenant:settings', 'user:manage'
      ],
      RECRUITER: [
        'candidate:create', 'candidate:view',
        'submission:create', 'submission:view',
        'job:view'
      ],
      ACCOUNT_MANAGER: [
        'job:create', 'job:edit', 'job:view',
        'candidate:view', 'submission:view', 'submission:edit'
      ],
      DELIVERY_HEAD: [
        'job:view', 'candidate:view', 'submission:view', 'submission:edit'
      ],
      TRACKER: [
        'submission:view', 'candidate:view'
      ],
      SUPER_ADMIN: [
        'job:create', 'job:edit', 'job:view',
        'candidate:create', 'candidate:view',
        'submission:create', 'submission:edit',
        'tenant:settings', 'user:manage', 'platform:manage'
      ]
    };

    const roleMap: Record<string, string> = {};

    for (const [roleName, permissions] of Object.entries(DEFAULT_PERMISSIONS)) {
      // 1. Insert role
      const roleRes = await this.db.query(`
        INSERT INTO custom_roles (tenant_id, name, description, is_system)
        VALUES ($1, $2, $3, true)
        ON CONFLICT (tenant_id, name) DO UPDATE SET name = EXCLUDED.name
        RETURNING id
      `, [tenantId, roleName, `Default system role for ${roleName.toLowerCase().replace('_', ' ')}s.`]);
      
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
    const rolesRes = await this.db.query(
      'SELECT id, name, description, is_system as "isSystem" FROM custom_roles WHERE tenant_id = $1 ORDER BY name ASC',
      [tenantId]
    );
    const roles = rolesRes.rows;

    const result = [];
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

  async createCustomRole(tenantId: string, name: string, description: string, permissions: string[]) {
    const nameUpper = name.toUpperCase().trim();
    if (['SUPER_ADMIN', 'ADMIN', 'RECRUITER', 'ACCOUNT_MANAGER', 'DELIVERY_HEAD', 'TRACKER'].includes(nameUpper)) {
      throw new BadRequestException('Role name conflicts with a default system role.');
    }

    const exists = await this.db.query(
      'SELECT id FROM custom_roles WHERE tenant_id = $1 AND UPPER(name) = $2 LIMIT 1',
      [tenantId, nameUpper]
    );
    if (exists.rows.length > 0) {
      throw new ConflictException(`A role with name "${name}" already exists.`);
    }

    const roleRes = await this.db.query(
      `INSERT INTO custom_roles (tenant_id, name, description, is_system)
       VALUES ($1, $2, $3, false)
       RETURNING id, name, description, is_system as "isSystem"`,
      [tenantId, name, description]
    );
    const role = roleRes.rows[0];

    for (const perm of permissions) {
      await this.db.query(
        'INSERT INTO role_permissions (role_id, permission) VALUES ($1, $2)',
        [role.id, perm]
      );
    }

    return {
      ...role,
      permissions
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

  async assignUserRole(tenantId: string, userId: string, roleId: string) {
    const roleResult = await this.db.query(
      'SELECT id, name FROM custom_roles WHERE id = $1 AND tenant_id = $2 LIMIT 1',
      [roleId, tenantId]
    );
    if (roleResult.rows.length === 0) {
      throw new NotFoundException('Role not found.');
    }
    const roleName = roleResult.rows[0].name;

    // Update user: link role_id and synchronize standard roles list for backward-compatibility
    await this.db.query(
      `UPDATE users 
       SET role_id = $1, roles = $2, updated_at = NOW() 
       WHERE id = $3 AND tenant_id = $4`,
      [roleId, [roleName], userId, tenantId]
    );

    return { message: 'User role assigned successfully.', role: roleName };
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
    ];
  }

  // ─────────────────────────────────────────────────────────────
  // List all users pending approval (admin utility)
  // ─────────────────────────────────────────────────────────────
  async listPendingApprovals() {
    const result = await this.db.query(
      `SELECT u.id, u.email, u.full_name, u.roles, u.created_at, u.tenant_id, t.name as tenant_name, t.default_market
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
    }));
  }

  // ─────────────────────────────────────────────────────────────
  // Approve user and set tenant's market settings (admin utility)
  // ─────────────────────────────────────────────────────────────
  async approveUser(userId: string, market: string) {
    const userResult = await this.db.query(
      'SELECT tenant_id FROM users WHERE id = $1 LIMIT 1',
      [userId]
    );
    if (userResult.rows.length === 0) {
      throw new NotFoundException(`User with ID ${userId} was not found.`);
    }
    const tenantId = userResult.rows[0].tenant_id;

    // Approve the user
    await this.db.query(
      'UPDATE users SET is_approved = true, is_active = true WHERE id = $1',
      [userId]
    );

    // Approve the tenant (activate status)
    await this.db.query(
      "UPDATE tenants SET status = 'ACTIVE' WHERE id = $1",
      [tenantId]
    );

    // Configure tenant market if provided
    if (market && (market === 'US' || market === 'IN')) {
      await this.db.query(
        'UPDATE tenants SET default_market = $1 WHERE id = $2',
        [market, tenantId]
      );
    }

    return { message: 'User approved successfully and tenant market configured.' };
  }

  // ─────────────────────────────────────────────────────────────
  // List all tenants in the system (admin utility)
  // ─────────────────────────────────────────────────────────────
  async listTenants() {
    const result = await this.db.query(
      `SELECT id, name, domain, status, default_market as "defaultMarket", created_at as "createdAt"
       FROM tenants
       ORDER BY name ASC`
    );
    return result.rows;
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
      'SELECT id FROM tenants WHERE domain = $1 AND id <> $2 LIMIT 1',
      [subdomain, tenantId]
    );
    if (exists.rows.length > 0) {
      throw new ConflictException('Subdomain is already taken by another company.');
    }

    await this.db.query(
      'UPDATE tenants SET domain = $1, updated_at = NOW() WHERE id = $2',
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
}
