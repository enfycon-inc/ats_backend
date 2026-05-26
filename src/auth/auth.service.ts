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

      -- Ensure is_approved column exists on older tables
      ALTER TABLE users ADD COLUMN IF NOT EXISTS is_approved BOOLEAN NOT NULL DEFAULT true;

      -- Update any existing users with null value to true
      UPDATE users SET is_approved = true WHERE is_approved IS NULL;
    `;
    try {
      await this.db.query(ddl);
      this.logger.log('Users table verified/created.');
    } catch (err) {
      this.logger.error(`Failed to create users table: ${err.message}`);
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
            `UPDATE users SET roles = array_append(roles, 'SUPER_ADMIN'), is_approved = true, is_active = true WHERE id = $1`,
            [user.id],
          );
        } else {
          await this.db.query(
            `UPDATE users SET is_approved = true, is_active = true WHERE id = $1`,
            [user.id],
          );
        }
        this.logger.log(`✅ Platform SUPER_ADMIN already exists in DB (${adminEmail}) — skipping seed.`);
        return;
      }

      // First boot only: create the platform super admin
      const { hash, salt } = this.hashPassword(adminPassword);
      await this.db.query(
        `INSERT INTO users (tenant_id, email, full_name, password_hash, salt, roles, is_active, is_approved)
         VALUES ($1, $2, $3, $4, $5, $6, true, true)`,
        [DEFAULT_TENANT_ID, adminEmail, adminName, hash, salt, ['SUPER_ADMIN']],
      );
      this.logger.log(`🚀 Platform SUPER_ADMIN created: ${adminEmail}`);
    } catch (err) {
      this.logger.warn(`Could not seed SUPER_ADMIN: ${err.message}`);
    }
    // NOTE: All other users (ADMIN, RECRUITER, etc.) are created via the Admin UI
    // after tenant self-registration and approval. No hardcoded seeds needed.
  }

  // ─────────────────────────────────────────────────────────────
  // MOCK MODE: Login
  // ─────────────────────────────────────────────────────────────
  async login(dto: LoginDto) {
    this.logger.log(`Login attempt: ${dto.email}`);

    const result = await this.db.query(
      `SELECT u.id, u.email, u.full_name, u.password_hash, u.salt, u.roles, u.is_active, u.is_approved, u.tenant_id, t.default_market, t.domain as tenant_domain
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

    const token = this.signJwt({
      sub: user.id,
      email: user.email,
      fullName: user.full_name,
      roles: user.roles,
      tenantId: user.tenant_id || DEFAULT_TENANT_ID,
      defaultMarket: user.default_market || 'US',
      tenantDomain: user.tenant_domain || '',
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

    const validRoles = ['RECRUITER', 'ACCOUNT_MANAGER', 'DELIVERY_HEAD', 'ADMIN', 'SUPER_ADMIN', 'TRACKER'];
    const role = dto.role?.toUpperCase();
    if (!validRoles.includes(role)) {
      throw new BadRequestException(
        `Invalid role "${dto.role}". Must be one of: ${validRoles.join(', ')}`,
      );
    }

    const tenantId = dto.tenantId || DEFAULT_TENANT_ID;
    const { hash, salt } = this.hashPassword(dto.password);

    // New user registrations default to unapproved (is_approved = false)
    const result = await this.db.query(
      `INSERT INTO users (tenant_id, email, full_name, password_hash, salt, roles, is_active, is_approved)
       VALUES ($1, $2, $3, $4, $5, $6, true, false)
       RETURNING id, email, full_name, roles, tenant_id, created_at`,
      [tenantId, dto.email, dto.fullName, hash, salt, [role]],
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

    // 5. Create the first admin user for this tenant (is_approved = false)
    const { hash, salt } = this.hashPassword(dto.password);
    const userResult = await this.db.query(
      `INSERT INTO users (tenant_id, email, full_name, password_hash, salt, roles, is_active, is_approved)
       VALUES ($1, $2, $3, $4, $5, $6, true, false)
       RETURNING id, email, full_name, roles, tenant_id, created_at`,
      [tenant.id, dto.email, dto.fullName, hash, salt, ['ADMIN']],
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
      'SELECT id, roles, tenant_id, is_active FROM users WHERE keycloak_id = $1 LIMIT 1',
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

    const result = await this.db.query(
      `INSERT INTO users (keycloak_id, tenant_id, email, full_name, roles, is_active, is_approved)
       VALUES ($1, $2, $3, $4, $5, true, true)
       ON CONFLICT (keycloak_id) DO UPDATE SET
         email      = EXCLUDED.email,
         full_name  = EXCLUDED.full_name,
         roles      = $5,
         updated_at = NOW()
       RETURNING id, email, full_name, roles, tenant_id, is_active`,
      [data.keycloakId, tenantId, data.email, data.fullName, mergedRoles],
    );

    return result.rows[0];
  }

  // ─────────────────────────────────────────────────────────────
  async getProfile(userId: string) {
    const result = await this.db.query(
      `SELECT u.id, u.email, u.full_name, u.roles, u.tenant_id, u.is_active, u.created_at, u.updated_at, t.default_market, t.domain as tenant_domain
       FROM users u
       LEFT JOIN tenants t ON u.tenant_id = t.id
       WHERE u.id = $1 LIMIT 1`,
      [userId],
    );
    if (result.rows.length === 0) {
      throw new NotFoundException('User profile not found.');
    }
    const u = result.rows[0];
    return {
      id: u.id,
      email: u.email,
      fullName: u.full_name,
      roles: u.roles,
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
      `SELECT id, email, full_name, roles, is_active, created_at
       FROM users WHERE tenant_id = $1 ORDER BY full_name ASC`,
      [tenantId],
    );
    return result.rows.map((u) => ({
      id: u.id,
      email: u.email,
      fullName: u.full_name,
      roles: u.roles,
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
    const validRoles = ['RECRUITER', 'ACCOUNT_MANAGER', 'DELIVERY_HEAD', 'ADMIN', 'SUPER_ADMIN', 'TRACKER'];
    const normalized = roles.map((r) => r.toUpperCase());
    const invalid = normalized.filter((r) => !validRoles.includes(r));
    if (invalid.length > 0) {
      throw new BadRequestException(`Invalid roles: ${invalid.join(', ')}`);
    }
    await this.db.query(
      `UPDATE users SET roles = $1, updated_at = NOW() WHERE id = $2`,
      [normalized, userId],
    );
    return { message: 'User roles updated successfully.', roles: normalized };
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
