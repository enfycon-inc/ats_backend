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

const DEFAULT_TENANT_ID = 'd3b07384-d113-49c3-a555-9ee75c13ca33';

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
    `;
    try {
      await this.db.query(ddl);
      this.logger.log('Users table verified/created.');
    } catch (err) {
      this.logger.error(`Failed to create users table: ${err.message}`);
    }
  }

  private async seedDefaultUsers() {
    const seeds = [
      { email: 'admin@enfycon.com',     fullName: 'Enfy Admin',        password: 'enfycon123', role: 'ADMIN' },
      { email: 'recruiter@enfycon.com', fullName: 'Enfy Recruiter',    password: 'enfycon123', role: 'RECRUITER' },
      { email: 'am@enfycon.com',        fullName: 'Enfy Acct Manager', password: 'enfycon123', role: 'ACCOUNT_MANAGER' },
      { email: 'dh@enfycon.com',        fullName: 'Enfy Delivery Head',password: 'enfycon123', role: 'DELIVERY_HEAD' },
      { email: 'tracker@enfycon.com',   fullName: 'Enfy Tracker',      password: 'enfycon123', role: 'TRACKER' },
    ];

    for (const seed of seeds) {
      try {
        const exists = await this.db.query(
          'SELECT id FROM users WHERE email = $1 LIMIT 1',
          [seed.email],
        );
        
        const { hash, salt } = this.hashPassword(seed.password);

        if (exists.rows.length > 0) {
          // If seed user exists, update password hash to ensure sync
          await this.db.query(
            'UPDATE users SET password_hash = $1, salt = $2, roles = $3 WHERE email = $4',
            [hash, salt, [seed.role], seed.email]
          );
          continue;
        }

        await this.db.query(
          `INSERT INTO users (tenant_id, email, full_name, password_hash, salt, roles, is_active, is_approved)
           VALUES ($1, $2, $3, $4, $5, $6, true, true)`,
          [DEFAULT_TENANT_ID, seed.email, seed.fullName, hash, salt, [seed.role]],
        );
        this.logger.log(`Seeded user: ${seed.email} [${seed.role}]`);
      } catch (err) {
        this.logger.warn(`Could not seed ${seed.email}: ${err.message}`);
      }
    }
  }

  // ─────────────────────────────────────────────────────────────
  // MOCK MODE: Login
  // ─────────────────────────────────────────────────────────────
  async login(dto: LoginDto) {
    this.logger.log(`Login attempt: ${dto.email}`);

    const result = await this.db.query(
      `SELECT id, email, full_name, password_hash, salt, roles, is_active, tenant_id
       FROM users WHERE email = $1 LIMIT 1`,
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

    const validRoles = ['RECRUITER', 'ACCOUNT_MANAGER', 'DELIVERY_HEAD', 'ADMIN', 'TRACKER'];
    const role = dto.role?.toUpperCase();
    if (!validRoles.includes(role)) {
      throw new BadRequestException(
        `Invalid role "${dto.role}". Must be one of: ${validRoles.join(', ')}`,
      );
    }

    const tenantId = dto.tenantId || DEFAULT_TENANT_ID;
    const { hash, salt } = this.hashPassword(dto.password);

    const result = await this.db.query(
      `INSERT INTO users (tenant_id, email, full_name, password_hash, salt, roles, is_active, is_approved)
       VALUES ($1, $2, $3, $4, $5, $6, true, true)
       RETURNING id, email, full_name, roles, tenant_id, created_at`,
      [tenantId, dto.email, dto.fullName, hash, salt, [role]],
    );

    const user = result.rows[0];
    return {
      message: 'User registered successfully.',
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
  // Get current user profile from DB
  // ─────────────────────────────────────────────────────────────
  async getProfile(userId: string) {
    const result = await this.db.query(
      `SELECT id, email, full_name, roles, tenant_id, is_active, created_at, updated_at
       FROM users WHERE id = $1 LIMIT 1`,
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
    const validRoles = ['RECRUITER', 'ACCOUNT_MANAGER', 'DELIVERY_HEAD', 'ADMIN', 'TRACKER'];
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
