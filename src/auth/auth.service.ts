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
        branch_id     UUID REFERENCES branches(id) ON DELETE CASCADE,
        name          VARCHAR(100) NOT NULL,
        description   TEXT,
        is_system     BOOLEAN NOT NULL DEFAULT false,
        created_at    TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at    TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );

      -- Ensure branch_id, system_role, and base_role_id columns exist on custom_roles
      ALTER TABLE custom_roles ADD COLUMN IF NOT EXISTS branch_id UUID REFERENCES branches(id) ON DELETE CASCADE;
      ALTER TABLE custom_roles ADD COLUMN IF NOT EXISTS system_role VARCHAR(50) DEFAULT 'RECRUITER';
      ALTER TABLE custom_roles ADD COLUMN IF NOT EXISTS base_role_id UUID REFERENCES custom_roles(id) ON DELETE SET NULL;
      ALTER TABLE custom_roles DROP CONSTRAINT IF EXISTS custom_roles_tenant_id_name_key;
      CREATE UNIQUE INDEX IF NOT EXISTS idx_custom_roles_branch_name 
        ON custom_roles (tenant_id, branch_id, UPPER(name)) 
        WHERE is_system = false AND branch_id IS NOT NULL;
      CREATE UNIQUE INDEX IF NOT EXISTS idx_custom_roles_system_name 
        ON custom_roles (tenant_id, UPPER(name)) 
        WHERE is_system = true;

      -- Update system_role mappings for default system roles
      UPDATE custom_roles SET system_role = 'ADMIN' WHERE name = 'ADMIN';
      UPDATE custom_roles SET system_role = 'SUPER_ADMIN' WHERE name = 'SUPER_ADMIN';
      UPDATE custom_roles SET system_role = 'BRANCH_ADMIN' WHERE name = 'BRANCH_ADMIN';
      UPDATE custom_roles SET system_role = 'ACCOUNT_MANAGER' WHERE name = 'ACCOUNT_MANAGER';
      UPDATE custom_roles SET system_role = 'DELIVERY_HEAD' WHERE name = 'DELIVERY_HEAD';
      UPDATE custom_roles SET system_role = 'POD_LEAD' WHERE name = 'POD_LEAD';

      -- Link custom roles to their corresponding base system role ID
      UPDATE custom_roles cr
      SET base_role_id = (
        SELECT sr.id FROM custom_roles sr
        WHERE sr.tenant_id = cr.tenant_id
          AND sr.is_system = true
          AND (
            UPPER(sr.name) = UPPER(cr.system_role)
            OR UPPER(REPLACE(sr.name, '_', '')) = UPPER(REPLACE(cr.system_role, '_', ''))
          )
        LIMIT 1
      )
      WHERE cr.is_system = false AND cr.base_role_id IS NULL;

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
        first_name    VARCHAR(128),
        last_name     VARCHAR(128),
        full_name     VARCHAR(255) NOT NULL,
        is_active     BOOLEAN NOT NULL DEFAULT true,
        is_approved   BOOLEAN NOT NULL DEFAULT true,
        profile_picture TEXT,
        created_at    TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at    TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );

      -- Ensure password_hash and salt columns are dropped (Keycloak is single source of truth)
      ALTER TABLE users DROP COLUMN IF EXISTS password_hash CASCADE;
      ALTER TABLE users DROP COLUMN IF EXISTS salt CASCADE;

      -- 4. Add first_name and last_name if not exists
      ALTER TABLE users ADD COLUMN IF NOT EXISTS first_name VARCHAR(128);
      ALTER TABLE users ADD COLUMN IF NOT EXISTS last_name VARCHAR(128);

      -- 5. Add role_id and assigned_role_ids to users if not exists
      ALTER TABLE users ADD COLUMN IF NOT EXISTS role_id UUID REFERENCES custom_roles(id) ON DELETE SET NULL;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS assigned_role_ids UUID[] DEFAULT '{}';

      -- 6. Drop redundant legacy roles column if it still exists
      ALTER TABLE users DROP COLUMN IF EXISTS roles CASCADE;

      -- Ensure is_approved column exists on older tables
      ALTER TABLE users ADD COLUMN IF NOT EXISTS is_approved BOOLEAN NOT NULL DEFAULT true;

      -- Add branch_id, assigned_branch_ids, branch_roles, business_unit_id, and job_reviewer_id to users
      ALTER TABLE users ADD COLUMN IF NOT EXISTS branch_id UUID REFERENCES branches(id) ON DELETE SET NULL;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS assigned_branch_ids UUID[] DEFAULT '{}';
      ALTER TABLE users ADD COLUMN IF NOT EXISTS branch_roles JSONB DEFAULT '{}';
      ALTER TABLE users ADD COLUMN IF NOT EXISTS business_unit_id UUID REFERENCES business_units(id) ON DELETE SET NULL;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS job_reviewer_id UUID REFERENCES users(id) ON DELETE SET NULL;

      -- Update any existing users with null value to true
      UPDATE users SET is_approved = true WHERE is_approved IS NULL;

      -- Auto-populate first_name and last_name from full_name if empty
      UPDATE users
      SET first_name = split_part(full_name, ' ', 1),
          last_name = SUBSTRING(full_name FROM POSITION(' ' IN full_name) + 1)
      WHERE (first_name IS NULL OR last_name IS NULL) AND full_name IS NOT NULL;

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
      await this.syncUserRoleIdsFromCustomRoles();
    } catch (err) {
      this.logger.error(`Failed to create users/RBAC tables: ${err.message}`);
    }
  }

  private async syncUserRoleIdsFromCustomRoles() {
    try {
      const usersRes = await this.db.query('SELECT * FROM users');
      const rolesRes = await this.db.query('SELECT * FROM custom_roles');

      const ROLE_RANK: Record<string, number> = {
        SUPER_ADMIN: 100,
        ADMIN: 90,
        BRANCH_ADMIN: 80,
        DELIVERY_HEAD: 70,
        ACCOUNT_MANAGER: 60,
        POD_LEAD: 50,
        RECRUITER: 40,
      };

      for (const user of usersRes.rows) {
        const tenantRoles = rolesRes.rows.filter((r: any) => r.tenant_id === user.tenant_id);
        const roleById: Record<string, any> = {};
        const roleByName: Record<string, any> = {};
        for (const r of tenantRoles) {
          roleById[r.id] = r;
          roleByName[r.name.toUpperCase().trim()] = r;
          if (r.system_role) {
            roleByName[r.system_role.toUpperCase().trim()] = r;
            roleByName[r.system_role.replace(/_/g, ' ').toUpperCase().trim()] = r;
          }
        }

        const resolvedRoleIds = new Set<string>();

        if (user.role_id && roleById[user.role_id]) {
          resolvedRoleIds.add(user.role_id);
        }

        if (Array.isArray(user.assigned_role_ids)) {
          user.assigned_role_ids.forEach((rid: string) => {
            if (roleById[rid]) resolvedRoleIds.add(rid);
          });
        }

        const rawBranchRoles = user.branch_roles || {};
        const normalizedBranchRoles: Record<string, string[]> = {};

        if (rawBranchRoles && typeof rawBranchRoles === 'object') {
          for (const [branchId, rList] of Object.entries(rawBranchRoles)) {
            if (Array.isArray(rList)) {
              const validBranchRoleIds: string[] = [];
              for (const item of rList) {
                if (!item) continue;
                if (roleById[item]) {
                  validBranchRoleIds.push(item);
                  resolvedRoleIds.add(item);
                } else {
                  const nameKey = String(item).toUpperCase().trim();
                  const matched = roleByName[nameKey] || tenantRoles.find((r: any) => r.name.toUpperCase().trim() === nameKey || (r.system_role && r.system_role.toUpperCase().trim() === nameKey));
                  if (matched) {
                    validBranchRoleIds.push(matched.id);
                    resolvedRoleIds.add(matched.id);
                  }
                }
              }
              if (validBranchRoleIds.length > 0) {
                normalizedBranchRoles[branchId] = Array.from(new Set(validBranchRoleIds));
              }
            }
          }
        }

        if (resolvedRoleIds.size === 0) {
          const defaultRole = tenantRoles.find((r: any) => r.name === 'RECRUITER' || r.system_role === 'RECRUITER') || tenantRoles[0];
          if (defaultRole) {
            resolvedRoleIds.add(defaultRole.id);
          }
        }

        const assignedRoleObjs = Array.from(resolvedRoleIds).map((id) => roleById[id]).filter(Boolean);
        let bestRoleObj: any = null;
        let highestRank = -1;

        for (const r of assignedRoleObjs) {
          const sysKey = (r.system_role || r.name || '').toUpperCase().replace(/[\s-_]+/g, '');
          const matchedKey = Object.keys(ROLE_RANK).find(k => k.replace(/_/g, '') === sysKey) || '';
          const rank = ROLE_RANK[matchedKey] || 30;
          if (rank > highestRank) {
            highestRank = rank;
            bestRoleObj = r;
          }
        }

        const finalRoleId = bestRoleObj ? bestRoleObj.id : (user.role_id || Array.from(resolvedRoleIds)[0] || null);
        const finalAssignedRoleIds = Array.from(resolvedRoleIds);

        await this.db.query(
          `UPDATE users
           SET role_id = $1,
               assigned_role_ids = $2::uuid[],
               branch_roles = $3::jsonb,
               updated_at = NOW()
           WHERE id = $4`,
          [finalRoleId, finalAssignedRoleIds, JSON.stringify(normalizedBranchRoles), user.id]
        );
      }
      this.logger.log('User role IDs and branch roles auto-synchronized with custom_roles.');
    } catch (err: any) {
      this.logger.warn(`Failed to auto-sync user role IDs: ${err.message}`);
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
        'SELECT id, role_id, assigned_role_ids FROM users WHERE email = $1 LIMIT 1',
        [adminEmail],
      );

      if (exists.rows.length > 0) {
        const user = exists.rows[0];
        const assignedRoleIds = Array.isArray(user.assigned_role_ids) ? [...user.assigned_role_ids] : [];
        if (superAdminRoleId && !assignedRoleIds.includes(superAdminRoleId)) {
          assignedRoleIds.push(superAdminRoleId);
        }
        await this.db.query(
          `UPDATE users SET is_approved = true, is_active = true, role_id = $1, assigned_role_ids = $2::uuid[] WHERE id = $3`,
          [superAdminRoleId, assignedRoleIds, user.id],
        );
        this.logger.log(`✅ Platform SUPER_ADMIN already exists in DB (${adminEmail}) — skipping seed.`);
        return;
      }

      // First boot only: create the platform super admin
      await this.db.query(
        `INSERT INTO users (tenant_id, email, full_name, is_active, is_approved, role_id)
         VALUES ($1, $2, $3, true, true, $4)`,
        [DEFAULT_TENANT_ID, adminEmail, adminName, superAdminRoleId],
      );
      this.logger.log(`🚀 Platform SUPER_ADMIN created: ${adminEmail}`);
    } catch (err) {
      this.logger.warn(`Could not seed SUPER_ADMIN: ${err.message}`);
    }
  }

  // ─────────────────────────────────────────────────────────────
  // LOGIN IMPLEMENTATION (Keycloak is the single source of truth)
  // ─────────────────────────────────────────────────────────────
  async login(dto: LoginDto) {
    this.logger.log(`Login attempt for ${dto.email} [Provider: Keycloak]`);

    const result = await this.db.query(
      `SELECT u.id, u.email, u.first_name, u.last_name, u.full_name, u.is_active, u.is_approved, u.tenant_id, u.role_id, u.assigned_role_ids, u.pod_id, u.branch_id, u.assigned_branch_ids, u.branch_roles, u.business_unit_id, t.default_market, t.domain as tenant_domain, t.status as tenant_status, t.pod_system_enabled, cr.system_role, cr.name as role_name, b.name as branch_name, bu.name as business_unit_name
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

    // Fetch dynamic permissions and roles assigned across all user custom roles
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    const userRoleIds = new Set<string>();
    const legacyRoleNames = new Set<string>();

    if (user.role_id) {
      if (uuidRegex.test(user.role_id)) userRoleIds.add(user.role_id);
      else legacyRoleNames.add(user.role_id);
    }
    if (Array.isArray(user.assigned_role_ids)) {
      user.assigned_role_ids.forEach((rid: string) => {
        if (rid) {
          if (uuidRegex.test(rid)) userRoleIds.add(rid);
          else legacyRoleNames.add(rid);
        }
      });
    }
    if (user.branch_roles && typeof user.branch_roles === 'object') {
      Object.values(user.branch_roles).forEach((bRoleList: any) => {
        if (Array.isArray(bRoleList)) {
          bRoleList.forEach((rid: string) => {
            if (rid) {
              if (uuidRegex.test(rid)) userRoleIds.add(rid);
              else legacyRoleNames.add(rid);
            }
          });
        }
      });
    }

    let permissions: string[] = [];
    let dynamicRoles: string[] = [];

    if (legacyRoleNames.size > 0) {
      const legacyRes = await this.db.query(
        'SELECT id, name FROM custom_roles WHERE tenant_id = $1 AND (UPPER(name) = ANY($2) OR system_role = ANY($2))',
        [user.tenant_id, Array.from(legacyRoleNames).map(r => r.toUpperCase())]
      ).catch(() => ({ rows: [] }));
      legacyRes.rows.forEach((r: any) => userRoleIds.add(r.id));
    }

    if (userRoleIds.size > 0) {
      const validUuids = Array.from(userRoleIds).filter(id => uuidRegex.test(id));
      if (validUuids.length > 0) {
        const [permsResult, rolesResult] = await Promise.all([
          this.db.query(
            'SELECT DISTINCT permission FROM role_permissions WHERE role_id = ANY($1::uuid[])',
            [validUuids]
          ).catch(() => ({ rows: [] })),
          this.db.query(
            'SELECT id, name, system_role FROM custom_roles WHERE id = ANY($1::uuid[])',
            [validUuids]
          ).catch(() => ({ rows: [] }))
        ]);
        permissions = permsResult.rows.map((row: any) => row.permission);
        dynamicRoles = Array.from(new Set(rolesResult.rows.map((row: any) => row.name)));
      }
    }
    if (dynamicRoles.length === 0 && user.role_name) {
      dynamicRoles = [user.role_name];
    }
    if (dynamicRoles.length === 0) {
      dynamicRoles = [user.system_role || 'RECRUITER'];
    }

    // Validate subdomain / custom domain context
    const isSuperAdmin = dynamicRoles.includes('SUPER_ADMIN');
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

    // Resolve systemRole
    let systemRole = user.system_role || 'RECRUITER';
    if (dynamicRoles.includes('SUPER_ADMIN')) {
      systemRole = 'SUPER_ADMIN';
    }

    // ── KEYCLOAK AUTHENTICATION (SINGLE SOURCE OF TRUTH) ───────────────────
    let keycloakToken: string | null = null;
    let refreshToken: string | null = null;
    let expiresIn: number = 36000;

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

    try {
      let res = await fetch(tokenUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params.toString(),
      });

      if (!res.ok && res.status !== 401 && res.status !== 400) {
        const altUrl = tokenUrl.includes('localhost')
          ? tokenUrl.replace('localhost', 'keycloak')
          : tokenUrl.replace('keycloak', 'localhost');
        res = await fetch(altUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: params.toString(),
        });
      }

      if (res.ok) {
        const tokenData = await res.json();
        keycloakToken = tokenData.access_token;
        refreshToken = tokenData.refresh_token;
        expiresIn = tokenData.expires_in || 36000;

        await this.syncKeycloakUser({
          keycloakId: user.id,
          email: user.email,
          fullName: user.full_name,
          roles: dynamicRoles,
        }).catch(() => {});
      } else {
        this.logger.warn(`Keycloak direct grant rejected credentials for ${dto.email} (status ${res.status})`);
        throw new UnauthorizedException('Invalid email or password.');
      }
    } catch (kcErr: any) {
      if (kcErr instanceof UnauthorizedException) {
        throw kcErr;
      }
      this.logger.error(`Keycloak direct grant error for ${dto.email}: ${kcErr.message}`);
      throw new UnauthorizedException('Authentication failed or invalid credentials.');
    }

    if (!keycloakToken) {
      throw new UnauthorizedException('Invalid email or password.');
    }

    return {
      accessToken: keycloakToken,
      refreshToken: refreshToken || keycloakToken,
      expiresIn,
      tokenType: 'Bearer',
      user: {
        id: user.id,
        email: user.email,
        firstName: user.first_name || '',
        lastName: user.last_name || '',
        fullName: user.full_name,
        roles: dynamicRoles,
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
        refreshToken: tokenData.refresh_token || refreshToken,
        expiresIn: tokenData.expires_in || 36000,
      };
    }

    // ── Seamless DB fallback if Keycloak session has expired or is unavailable ──
    try {
      const parts = refreshToken.split('.');
      if (parts.length === 3) {
        const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
        const userEmail = payload.email || payload.preferred_username;
        const keycloakSub = payload.sub;

        if (userEmail || keycloakSub) {
          const userRes = await this.db.query(
            `SELECT u.*, cr.system_role
             FROM users u
             LEFT JOIN custom_roles cr ON cr.id = u.role_id
             WHERE u.email = $1 OR u.id::text = $2
             LIMIT 1`,
            [userEmail, keycloakSub],
          );

          if (userRes.rows.length > 0) {
            const user = userRes.rows[0];
            if (user.is_active) {
              const freshToken = this.signInternalToken(user);
              this.logger.log(`[Auth] Seamlessly refreshed token via DB fallback for user ${user.email}`);
              return {
                accessToken: freshToken.accessToken,
                refreshToken: freshToken.accessToken,
                expiresIn: freshToken.expiresIn,
              };
            }
          }
        }
      }
    } catch (e: any) {
      this.logger.warn(`Fallback token refresh error: ${e.message}`);
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
    const firstName = (dto.firstName || (dto.fullName ? dto.fullName.trim().split(/\s+/)[0] : '') || '').trim();
    const lastName = (dto.lastName || (dto.fullName ? dto.fullName.trim().split(/\s+/).slice(1).join(' ') : '') || '').trim();
    const fullName = (dto.fullName || `${firstName} ${lastName}`).trim();
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

    if (isApproved) {
      await this.checkSeatLimit(tenantId);
    }

    // Find the dynamic role ID corresponding to the requested role name or role ID
    let roleId = null;
    let roleName = role;
    const roleResult = await this.db.query(
      'SELECT id, name FROM custom_roles WHERE tenant_id = $1 AND (id::text = $2 OR UPPER(name) = $2 OR system_role = $2) LIMIT 1',
      [tenantId, role.toUpperCase()]
    );
    if (roleResult.rows.length > 0) {
      roleId = roleResult.rows[0].id;
      roleName = roleResult.rows[0].name;
    }
    const assignedRoleIds = roleId ? [roleId] : [];

    // If direct invite, user starts as active & approved immediately. Else pending.
    const result = await this.db.query(
      `INSERT INTO users (tenant_id, email, first_name, last_name, full_name, is_active, is_approved, role_id, assigned_role_ids)
       VALUES ($1, $2, $3, $4, $5, true, $6, $7, $8::uuid[])
       RETURNING id, email, first_name, last_name, full_name, tenant_id, created_at, role_id, assigned_role_ids`,
      [tenantId, email, firstName, lastName, fullName, isApproved, roleId, assignedRoleIds],
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
            roleName: roleName,
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
        firstName: user.first_name,
        lastName: user.last_name,
        fullName: user.full_name,
        roles: [roleName],
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
    const firstName = fullName.split(/\s+/)[0] || '';
    const lastName = fullName.split(/\s+/).slice(1).join(' ') || '';
    const assignedRoleIds = adminRoleId ? [adminRoleId] : [];
    const userResult = await this.db.query(
      `INSERT INTO users (tenant_id, email, first_name, last_name, full_name, is_active, is_approved, role_id, assigned_role_ids)
       VALUES ($1, $2, $3, $4, $5, true, false, $6, $7::uuid[])
       RETURNING id, email, first_name, last_name, full_name, tenant_id, created_at, role_id`,
      [tenant.id, email, firstName, lastName, fullName, adminRoleId, assignedRoleIds],
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
        firstName: user.first_name,
        lastName: user.last_name,
        fullName: user.full_name,
        roles: ['ADMIN'],
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
      'SELECT id, tenant_id, is_active, role_id, assigned_role_ids, branch_roles, first_name, last_name, full_name FROM users WHERE keycloak_id = $1 OR email = $2 LIMIT 1',
      [data.keycloakId, data.email],
    );

    let tenantId = existing.rows.length > 0
      ? existing.rows[0].tenant_id
      : DEFAULT_TENANT_ID;

    // Synchronize Keycloak role name to dynamic custom role ID
    let roleId = existing.rows.length > 0 ? existing.rows[0].role_id : null;
    let dynamicRoles: string[] = [];
    if (normalizedRoles.length > 0) {
      const roleResult = await this.db.query(
        'SELECT id, name FROM custom_roles WHERE tenant_id = $1 AND (UPPER(name) = ANY($2) OR system_role = ANY($2))',
        [tenantId, normalizedRoles]
      );
      if (roleResult.rows.length > 0) {
        if (!roleId) roleId = roleResult.rows[0].id;
        dynamicRoles = Array.from(new Set(roleResult.rows.map(r => r.name)));
      }
    }
    if (dynamicRoles.length === 0 && normalizedRoles.length > 0) {
      dynamicRoles = normalizedRoles;
    }

    const firstName = data.fullName ? data.fullName.trim().split(/\s+/)[0] : '';
    const lastName = data.fullName ? data.fullName.trim().split(/\s+/).slice(1).join(' ') : '';
    const fullName = data.fullName ? data.fullName.trim() : `${firstName} ${lastName}`.trim();
    const assignedRoleIds = roleId ? [roleId] : [];

    let dbUser: any;
    if (existing.rows.length > 0) {
      const existingUser = existing.rows[0];
      const updateRes = await this.db.query(
        `UPDATE users
         SET keycloak_id = $1,
             first_name  = COALESCE(NULLIF($2, ''), first_name),
             last_name   = COALESCE(NULLIF($3, ''), last_name),
             full_name   = COALESCE($4, full_name),
             role_id     = COALESCE(users.role_id, $5),
             assigned_role_ids = CASE WHEN cardinality(assigned_role_ids) = 0 THEN $6::uuid[] ELSE assigned_role_ids END,
             updated_at  = NOW()
         WHERE id = $7
         RETURNING id, email, first_name, last_name, full_name, tenant_id, is_active, role_id, assigned_role_ids`,
        [data.keycloakId, firstName, lastName, fullName, roleId, assignedRoleIds, existingUser.id],
      );
      dbUser = updateRes.rows[0];
    } else {
      const insertRes = await this.db.query(
        `INSERT INTO users (keycloak_id, tenant_id, email, first_name, last_name, full_name, is_active, is_approved, role_id, assigned_role_ids)
         VALUES ($1, $2, $3, $4, $5, $6, true, true, $7, $8::uuid[])
         RETURNING id, email, first_name, last_name, full_name, tenant_id, is_active, role_id, assigned_role_ids`,
        [data.keycloakId, tenantId, data.email, firstName, lastName, fullName, roleId, assignedRoleIds],
      );
      dbUser = insertRes.rows[0];
    }

    // Load custom role permissions dynamically across assigned role ID and all user roles
    let permissions: string[] = [];
    const permsRes = await this.db.query(
      `SELECT DISTINCT rp.permission 
       FROM custom_roles cr
       JOIN role_permissions rp ON rp.role_id = cr.id
       WHERE (cr.tenant_id = $1 OR cr.tenant_id IS NULL) 
         AND (cr.id = $2 OR UPPER(cr.name) = ANY($3) OR UPPER(cr.system_role) = ANY($3))`,
      [dbUser.tenant_id || DEFAULT_TENANT_ID, dbUser.role_id || null, normalizedRoles]
    );
    permissions = permsRes.rows.map(row => row.permission);

    return {
      ...dbUser,
      roles: dynamicRoles,
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
      `SELECT u.id, u.email, u.first_name, u.last_name, u.full_name, u.tenant_id, u.is_active, u.created_at, u.updated_at,
              u.role_id, u.assigned_role_ids, u.pod_id, u.branch_id, u.assigned_branch_ids, u.branch_roles,
              u.business_unit_id, u.job_reviewer_id, rev.full_name as job_reviewer_name,
              t.name as tenant_name, t.default_market, t.domain as tenant_domain, t.user_limit as user_limit,
              t.pod_system_enabled, t.candidate_pool_mode, t.job_assignment_mode, t.job_assignment_options,
              b.name as branch_name, bu.name as business_unit_name
       FROM users u
       LEFT JOIN tenants t ON u.tenant_id = t.id
       LEFT JOIN branches b ON u.branch_id = b.id
       LEFT JOIN business_units bu ON u.business_unit_id = bu.id
       LEFT JOIN users rev ON u.job_reviewer_id = rev.id
       WHERE u.id = $1 LIMIT 1`,
      [userId],
    );
    if (result.rows.length === 0) {
      throw new NotFoundException('User profile not found.');
    }
    const u = result.rows[0];

    // Query tenant roles to build ID-to-role lookup
    const rolesRes = await this.db.query(
      `SELECT cr.id, cr.name, cr.is_system, cr.system_role, cr.base_role_id
       FROM custom_roles cr
       WHERE cr.tenant_id = $1`,
      [u.tenant_id]
    );

    const roleById: Record<string, any> = {};
    const roleByName: Record<string, any> = {};
    for (const r of rolesRes.rows) {
      roleById[r.id] = r;
      roleByName[r.name.toUpperCase()] = r;
      if (r.system_role) roleByName[r.system_role.toUpperCase()] = r;
    }

    // Query role permissions indexed by role ID
    const rolePermsRes = await this.db.query(
      `SELECT rp.role_id, rp.permission
       FROM role_permissions rp
       JOIN custom_roles cr ON cr.id = rp.role_id
       WHERE cr.tenant_id = $1`,
      [u.tenant_id]
    ).catch(() => ({ rows: [] }));

    const rolePermMap: Record<string, Set<string>> = {};
    for (const row of rolePermsRes.rows) {
      if (!rolePermMap[row.role_id]) rolePermMap[row.role_id] = new Set();
      rolePermMap[row.role_id].add(row.permission);
    }

    const userRoleIds = new Set<string>();
    if (u.role_id) userRoleIds.add(u.role_id);
    if (Array.isArray(u.assigned_role_ids)) {
      u.assigned_role_ids.forEach((rid: string) => userRoleIds.add(rid));
    }

    if (u.branch_roles && typeof u.branch_roles === 'object') {
      Object.values(u.branch_roles).forEach((bRoleList: any) => {
        if (Array.isArray(bRoleList)) {
          bRoleList.forEach((item: string) => {
            if (roleById[item]) {
              userRoleIds.add(item);
            } else if (roleByName[String(item).toUpperCase()]) {
              userRoleIds.add(roleByName[String(item).toUpperCase()].id);
            }
          });
        }
      });
    }

    // Compute effective permissions purely from assigned role IDs in role_permissions (respecting custom restrictions)
    const userPerms = new Set<string>();
    userRoleIds.forEach((rId) => {
      if (rolePermMap[rId]) {
        rolePermMap[rId].forEach((p) => userPerms.add(p));
      }
    });

    const canReview = userPerms.has('submission:internal_screening') || userPerms.has('job:approve') || userPerms.has('job:reject') || userPerms.has('job:publish_direct');
    const permissionsArray = Array.from(userPerms);

    // Collect all assigned role objects to determine highest ranking primary role and clean deduplicated roles array
    const assignedRoleObjs: any[] = [];
    userRoleIds.forEach((rId) => {
      if (roleById[rId]) {
        assignedRoleObjs.push(roleById[rId]);
      }
    });

    const ROLE_RANK: Record<string, number> = {
      SUPER_ADMIN: 100,
      ADMIN: 90,
      BRANCH_ADMIN: 80,
      DELIVERY_HEAD: 70,
      ACCOUNT_MANAGER: 60,
      POD_LEAD: 50,
      RECRUITER: 40,
    };

    let bestRoleObj: any = null;
    let highestRank = -1;

    for (const r of assignedRoleObjs) {
      const sysKey = (r.system_role || r.name || '').toUpperCase().replace(/[\s-_]+/g, '');
      const matchedKey = Object.keys(ROLE_RANK).find(k => k.replace(/_/g, '') === sysKey) || '';
      const rank = ROLE_RANK[matchedKey] || 30;
      if (rank > highestRank) {
        highestRank = rank;
        bestRoleObj = r;
      }
    }

    const roleName = bestRoleObj?.name || (u.role_id ? roleById[u.role_id]?.name : null) || 'RECRUITER';
    const systemRole = bestRoleObj?.system_role || (u.role_id ? roleById[u.role_id]?.system_role : null) || 'RECRUITER';
    const baseRoleId = bestRoleObj?.base_role_id || (u.role_id ? roleById[u.role_id]?.base_role_id : null) || null;

    // Clean & deduplicate role names by canonical key
    const seenCanonicalRoles = new Set<string>();
    const cleanRoles: string[] = [];
    for (const r of assignedRoleObjs) {
      const cKey = r.name.toUpperCase().replace(/[\s-_]+/g, '');
      if (!seenCanonicalRoles.has(cKey)) {
        seenCanonicalRoles.add(cKey);
        cleanRoles.push(r.name);
      }
    }

    return {
      id: u.id,
      email: u.email,
      firstName: u.first_name || '',
      lastName: u.last_name || '',
      fullName: u.full_name,
      roles: cleanRoles.length > 0 ? cleanRoles : [roleName],
      roleId: bestRoleObj?.id || u.role_id,
      assignedRoleIds: Array.from(userRoleIds),
      roleName,
      systemRole,
      baseRoleId,
      permissions: permissionsArray,
      canReview,
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
      jobReviewerId: u.job_reviewer_id || null,
      jobReviewerName: u.job_reviewer_name || null,
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
  async listUsers(tenantId: string, scopedBranchId?: string | null) {
    // Build WHERE clause: scope to branch if caller is a Branch Admin
    const branchFilter = scopedBranchId
      ? `AND (u.branch_id = $2 OR $2 = ANY(COALESCE(u.assigned_branch_ids, '{}')::uuid[]))`
      : '';
    const queryParams: any[] = scopedBranchId ? [tenantId, scopedBranchId] : [tenantId];

    const result = await this.db.query(
      `SELECT u.id, u.email, u.first_name, u.last_name, u.full_name, u.is_active, u.is_approved, u.created_at,
              u.role_id, u.assigned_role_ids, u.pod_id, u.branch_id, u.assigned_branch_ids, u.branch_roles,
              u.business_unit_id, u.job_reviewer_id,
              rev.full_name as job_reviewer_name,
              r.name as role_name, r.system_role as system_role, r.base_role_id as base_role_id,
              b.name as branch_name, bu.name as business_unit_name
       FROM users u 
       LEFT JOIN custom_roles r ON u.role_id = r.id
       LEFT JOIN branches b ON u.branch_id = b.id
       LEFT JOIN business_units bu ON u.business_unit_id = bu.id
       LEFT JOIN users rev ON u.job_reviewer_id = rev.id
       WHERE u.tenant_id = $1 ${branchFilter} ORDER BY u.full_name ASC`,
      queryParams,
    );

    // Query all custom & system roles for this tenant
    const rolesRes = await this.db.query(
      `SELECT cr.id, cr.name, cr.is_system, cr.system_role, cr.base_role_id
       FROM custom_roles cr
       WHERE cr.tenant_id = $1`,
      [tenantId]
    );

    // Build role lookup map by ID and by uppercase Name for backward compatibility
    const roleById: Record<string, any> = {};
    const roleByName: Record<string, any> = {};
    for (const r of rolesRes.rows) {
      roleById[r.id] = r;
      roleByName[r.name.toUpperCase()] = r;
      if (r.system_role) roleByName[r.system_role.toUpperCase()] = r;
    }

    // Query all role permissions indexed by role ID (UUID)
    const rolePermsRes = await this.db.query(
      `SELECT rp.role_id, rp.permission
       FROM role_permissions rp
       JOIN custom_roles cr ON cr.id = rp.role_id
       WHERE cr.tenant_id = $1`,
      [tenantId]
    ).catch(() => ({ rows: [] }));

    const rolePermMap: Record<string, Set<string>> = {};
    for (const row of rolePermsRes.rows) {
      if (!rolePermMap[row.role_id]) rolePermMap[row.role_id] = new Set();
      rolePermMap[row.role_id].add(row.permission);
    }

    return result.rows.map((u) => {
      const userRoleIds = new Set<string>();
      if (u.role_id) userRoleIds.add(u.role_id);
      if (Array.isArray(u.assigned_role_ids)) {
        u.assigned_role_ids.forEach((rid: string) => userRoleIds.add(rid));
      }

      // Ingest branch_roles (supporting role IDs or role names)
      if (u.branch_roles && typeof u.branch_roles === 'object') {
        Object.values(u.branch_roles).forEach((bRoleList: any) => {
          if (Array.isArray(bRoleList)) {
            bRoleList.forEach((item: string) => {
              if (roleById[item]) {
                userRoleIds.add(item);
              } else if (roleByName[String(item).toUpperCase()]) {
                userRoleIds.add(roleByName[String(item).toUpperCase()].id);
              }
            });
          }
        });
      }

      // Compute effective permissions purely from assigned role IDs in role_permissions (respecting custom restrictions)
      const userPerms = new Set<string>();
      userRoleIds.forEach((rId) => {
        if (rolePermMap[rId]) {
          rolePermMap[rId].forEach((p) => userPerms.add(p));
        }
      });

      const canReview = userPerms.has('submission:internal_screening') || userPerms.has('job:approve') || userPerms.has('job:reject') || userPerms.has('job:publish_direct');
      const permissionsArray = Array.from(userPerms);

      // Collect all assigned role objects to determine highest ranking primary role and clean deduplicated roles array
      const assignedRoleObjs: any[] = [];
      userRoleIds.forEach((rId) => {
        if (roleById[rId]) {
          assignedRoleObjs.push(roleById[rId]);
        }
      });

      const ROLE_RANK: Record<string, number> = {
        SUPER_ADMIN: 100,
        ADMIN: 90,
        BRANCH_ADMIN: 80,
        DELIVERY_HEAD: 70,
        ACCOUNT_MANAGER: 60,
        POD_LEAD: 50,
        RECRUITER: 40,
      };

      let bestRoleObj: any = null;
      let highestRank = -1;

      for (const r of assignedRoleObjs) {
        const sysKey = (r.system_role || r.name || '').toUpperCase().replace(/[\s-_]+/g, '');
        const matchedKey = Object.keys(ROLE_RANK).find(k => k.replace(/_/g, '') === sysKey) || '';
        const rank = ROLE_RANK[matchedKey] || 30;
        if (rank > highestRank) {
          highestRank = rank;
          bestRoleObj = r;
        }
      }

      const primaryRole = bestRoleObj?.name || u.role_name || 'RECRUITER';
      const systemRole = bestRoleObj?.system_role || u.system_role || 'RECRUITER';
      const baseRoleId = bestRoleObj?.base_role_id || u.base_role_id || null;

      // Clean & deduplicate role names by canonical key
      const seenCanonicalRoles = new Set<string>();
      const cleanRoles: string[] = [];
      for (const r of assignedRoleObjs) {
        const cKey = r.name.toUpperCase().replace(/[\s-_]+/g, '');
        if (!seenCanonicalRoles.has(cKey)) {
          seenCanonicalRoles.add(cKey);
          cleanRoles.push(r.name);
        }
      }

      return {
        id: u.id,
        email: u.email,
        firstName: u.first_name || '',
        lastName: u.last_name || '',
        fullName: u.full_name,
        roles: cleanRoles.length > 0 ? cleanRoles : [primaryRole],
        roleId: bestRoleObj?.id || u.role_id,
        assignedRoleIds: Array.from(userRoleIds),
        roleName: primaryRole,
        systemRole: systemRole,
        baseRoleId: baseRoleId,
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
        jobReviewerId: u.job_reviewer_id || null,
        jobReviewerName: u.job_reviewer_name || null,
        permissions: permissionsArray,
        canReview: canReview,
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
      `SELECT u.tenant_id, u.role_id, u.assigned_role_ids, cr.name as role_name, cr.system_role
       FROM users u
       LEFT JOIN custom_roles cr ON cr.id = u.role_id
       WHERE u.id = $1 LIMIT 1`,
      [userId]
    );
    if (userRes.rows.length === 0) {
      throw new NotFoundException('User not found.');
    }
    const targetUser = userRes.rows[0];
    const isTargetSuperAdmin = targetUser.system_role === 'SUPER_ADMIN' || targetUser.role_name === 'SUPER_ADMIN';
    const tenantId = targetUser.tenant_id;

    // Block modifying SUPER_ADMIN user roles unless requester is SUPER_ADMIN
    if (isTargetSuperAdmin && (!requesterRoles || !requesterRoles.includes('SUPER_ADMIN'))) {
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

    // Find all custom role IDs corresponding to assigned roles in the list
    const customRolesRes = await this.db.query(
      `SELECT id, name FROM custom_roles 
       WHERE tenant_id = $1 AND (UPPER(name) = ANY($2::text[]) OR system_role = ANY($2::text[]) OR id::text = ANY($2::text[]))
       ORDER BY (is_system = false) DESC, created_at DESC`,
      [tenantId, normalized]
    );
    const roleIds: string[] = customRolesRes.rows.map((r: any) => r.id);
    const cleanRoleNames: string[] = Array.from(new Set(customRolesRes.rows.map((r: any) => r.name)));
    const roleId = roleIds[0] || null;

    await this.db.query(
      `UPDATE users SET role_id = $1, assigned_role_ids = $2::uuid[], updated_at = NOW() WHERE id = $3`,
      [roleId, roleIds, userId],
    );
    return { message: 'User roles updated successfully.', roles: cleanRoleNames.length > 0 ? cleanRoleNames : normalized };
  }

  async updateUserDetails(
    userId: string,
    dto: { firstName?: string; lastName?: string; fullName?: string; email?: string; password?: string; roleId?: string; assignedRoleIds?: string[]; branchId?: string; assignedBranchIds?: string[]; branchRoles?: Record<string, string[]>; businessUnitId?: string; roles?: string[]; jobReviewerId?: string | null },
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

    let firstName = dto.firstName !== undefined ? dto.firstName.trim() : (user.first_name || '');
    let lastName = dto.lastName !== undefined ? dto.lastName.trim() : (user.last_name || '');
    let fullName = user.full_name;

    if (dto.firstName !== undefined || dto.lastName !== undefined) {
      fullName = `${firstName} ${lastName}`.trim();
    } else if (dto.fullName && dto.fullName.trim().length >= 2) {
      fullName = dto.fullName.trim();
      firstName = fullName.split(/\s+/)[0] || '';
      lastName = fullName.split(/\s+/).slice(1).join(' ') || '';
    }

    let email = user.email;
    let branchId = user.branch_id;
    let businessUnitId = user.business_unit_id;
    let jobReviewerId = user.job_reviewer_id;

    if (dto.email && dto.email.trim().toLowerCase() !== user.email) {
      const cleanEmail = dto.email.trim().toLowerCase();
      const dup = await this.db.query('SELECT id FROM users WHERE email = $1 AND id <> $2 LIMIT 1', [cleanEmail, userId]);
      if (dup.rows.length > 0) {
        throw new ConflictException(`Email ${cleanEmail} is already registered to another user.`);
      }
      email = cleanEmail;
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

    if (dto.jobReviewerId !== undefined) {
      jobReviewerId = dto.jobReviewerId && dto.jobReviewerId.trim().length > 0 ? dto.jobReviewerId.trim() : null;
    }

    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    const combinedRoleIds = new Set<string>();

    if (dto.branchRoles !== undefined) {
      Object.values(branchRoles).forEach((rList: any) => {
        if (Array.isArray(rList)) {
          rList.forEach((rid: string) => {
            if (rid && uuidRegex.test(rid)) combinedRoleIds.add(rid);
          });
        }
      });
    } else {
      if (user.role_id && uuidRegex.test(user.role_id)) combinedRoleIds.add(user.role_id);
      if (Array.isArray(user.assigned_role_ids)) {
        user.assigned_role_ids.forEach((rid: string) => {
          if (rid && uuidRegex.test(rid)) combinedRoleIds.add(rid);
        });
      }
    }

    if (dto.roleId && uuidRegex.test(dto.roleId)) {
      combinedRoleIds.add(dto.roleId);
    }

    let primaryRoleId = user.role_id;
    if (dto.roleId && uuidRegex.test(dto.roleId)) {
      primaryRoleId = dto.roleId;
    } else if (branchId && branchRoles[branchId] && Array.isArray(branchRoles[branchId]) && branchRoles[branchId].length > 0) {
      primaryRoleId = branchRoles[branchId][0];
    } else if (combinedRoleIds.size > 0 && (!primaryRoleId || !combinedRoleIds.has(primaryRoleId))) {
      primaryRoleId = Array.from(combinedRoleIds)[0];
    }

    await this.db.query(
      `UPDATE users
       SET first_name = $1, last_name = $2, full_name = $3, email = $4, branch_id = $5, assigned_branch_ids = $6, branch_roles = $7, business_unit_id = $8, job_reviewer_id = $9, role_id = $10, assigned_role_ids = $11::uuid[], updated_at = NOW()
       WHERE id = $12`,
      [firstName, lastName, fullName, email, branchId, assignedBranchIds, JSON.stringify(branchRoles), businessUnitId, jobReviewerId, primaryRoleId, Array.from(combinedRoleIds), userId]
    );

    if (dto.roles && Array.isArray(dto.roles) && dto.roles.length > 0) {
      await this.updateUserRoles(userId, dto.roles, requester.roles || []);
    }

    if (dto.password && dto.password.length >= 8) {
      this.provisionUserInKeycloak({
        email,
        password: dto.password,
        fullName,
        tenantId: user.tenant_id,
      }).catch((err) => {
        this.logger.warn(`Keycloak password update note: ${err.message}`);
      });
    }

    return this.getProfile(userId);
  }

  async bulkSetJobReviewer(tenantId: string, userIds: string[], reviewerId: string | null) {
    if (!Array.isArray(userIds) || userIds.length === 0) {
      throw new BadRequestException('userIds array is required.');
    }
    const cleanReviewerId = reviewerId && reviewerId.trim().length > 0 ? reviewerId.trim() : null;
    await this.db.query(
      `UPDATE users SET job_reviewer_id = $1, updated_at = NOW() WHERE id = ANY($2::uuid[]) AND tenant_id = $3`,
      [cleanReviewerId, userIds, tenantId]
    );
    return { success: true, count: userIds.length, reviewerId: cleanReviewerId };
  }

  // ─────────────────────────────────────────────────────────────
  // ENTERPRISE GRANULAR RBAC CRUD & PERMISSIONS MANAGEMENT (Ceipal style)
  // ─────────────────────────────────────────────────────────────
  async seedTenantRoles(tenantId: string): Promise<Record<string, string>> {
    const DEFAULT_PERMISSIONS: Record<string, string[]> = {
      ADMIN: [
        'job:create', 'job:edit', 'job:view', 'job:publish_direct', 'job:approve', 'job:reject',
        'job:assign', 'job:assign_recruiter', 'job:assign_pod',
        'candidate:create', 'candidate:view',
        'submission:create', 'submission:view', 'submission:edit', 'submission:internal_screening', 'submission:audit_rounds', 'submission:audit_l1', 'submission:audit_l2', 'submission:audit_l3', 'submission:final_status', 'submission:approve_client', 'submission:schedule_interview', 'submission:edit_rate',
        'client:view', 'client:create', 'client:direct_add', 'client:edit', 'client:approve', 'client:reject', 'client:delete',
        'placement:view', 'placement:create', 'report:view',
        'tenant:settings', 'user:manage',
        'pod:create', 'pod:edit', 'pod:delete', 'pod:view', 'pod:reset_cycle', 'pod:overlap',
        'branch:create', 'branch:edit', 'branch:delete',
        'branch_admin:manage', 'candidate:search_all_branches', 'job:view_all_branches', 'candidate:search_all_markets'
      ],
      BRANCH_ADMIN: [
        'job:create', 'job:view', 'job:edit', 'job:publish_direct', 'job:approve', 'job:reject',
        'job:assign', 'job:assign_recruiter', 'job:assign_pod',
        'candidate:create', 'candidate:view',
        'submission:create', 'submission:view', 'submission:internal_screening', 'submission:audit_rounds', 'submission:audit_l1', 'submission:audit_l2', 'submission:audit_l3', 'submission:final_status', 'submission:approve_client', 'submission:schedule_interview', 'submission:edit_rate', 'submission:edit',
        'client:view', 'client:create', 'client:direct_add', 'client:edit', 'client:approve', 'client:reject',
        'placement:view', 'placement:create', 'report:view',
        // Branch Admin can manage/edit their own branch and assign users — CANNOT create or delete branches
        'branch:edit', 'branch_admin:manage', 'branch:assign_user', 'branch:assign_manager', 'user:manage', 'pod:view', 'pod:edit'
      ],
      RECRUITER: [
        'candidate:create', 'candidate:view',
        'submission:create', 'submission:view', 'submission:edit',
        'job:view',
        'client:view',
        'pod:view'
      ],
      ACCOUNT_MANAGER: [
        'job:create', 'job:edit', 'job:view', 'job:publish_direct', 'job:approve', 'job:reject',
        'job:assign_recruiter',
        'candidate:view', 'candidate:create',
        'submission:view', 'submission:create', 'submission:audit_rounds', 'submission:audit_l1', 'submission:audit_l2', 'submission:audit_l3', 'submission:final_status', 'submission:schedule_interview', 'submission:edit_rate', 'submission:edit',
        'pod:view',
        'client:view', 'client:create', 'client:direct_add', 'client:edit',
        'placement:view', 'placement:create',
        'report:view'
      ],
      DELIVERY_HEAD: [
        'job:view', 'job:edit', 'job:approve', 'job:reject',
        'job:assign', 'job:assign_recruiter', 'job:assign_pod',
        'candidate:view', 'candidate:create',
        'submission:view', 'submission:create', 'submission:internal_screening', 'submission:audit_rounds', 'submission:audit_l1', 'submission:audit_l2', 'submission:audit_l3', 'submission:final_status', 'submission:approve_client', 'submission:schedule_interview', 'submission:edit_rate', 'submission:edit',
        'client:view', 'client:create', 'client:edit', 'client:approve', 'client:reject',
        'pod:create', 'pod:edit', 'pod:delete', 'pod:view', 'pod:reset_cycle', 'pod:overlap',
        'candidate:search_all_branches', 'job:view_all_branches', 'candidate:search_all_markets',
        'placement:view', 'report:view'
      ],
      POD_LEAD: [
        'job:view', 'job:edit', 'job:approve', 'job:reject',
        'candidate:view', 'candidate:create',
        'submission:view', 'submission:create', 'submission:internal_screening', 'submission:schedule_interview', 'submission:edit',
        'client:view',
        'pod:view', 'pod:edit', 'report:view'
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
      // 1. Check or insert system role
      let roleRes = await this.db.query(
        "SELECT id FROM custom_roles WHERE tenant_id = $1 AND UPPER(name) = UPPER($2) AND is_system = true LIMIT 1",
        [tenantId, roleName]
      );
      let roleId: string;
      if (roleRes.rows.length === 0) {
        const ins = await this.db.query(`
          INSERT INTO custom_roles (tenant_id, branch_id, name, description, is_system, system_role)
          VALUES ($1, NULL, $2, $3, true, $4)
          RETURNING id
        `, [
          tenantId,
          roleName,
          `Default system role for ${roleName.toLowerCase().replace('_', ' ')}s.`,
          roleName,
        ]);
        roleId = ins.rows[0].id;
      } else {
        roleId = roleRes.rows[0].id;
        await this.db.query(
          "UPDATE custom_roles SET system_role = $1, description = $2 WHERE id = $3",
          [roleName, `Default system role for ${roleName.toLowerCase().replace('_', ' ')}s.`, roleId]
        );
      }
      
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

  private async ensureRolesTableBranchColumn(): Promise<void> {
    await this.db.query(`
      ALTER TABLE custom_roles ADD COLUMN IF NOT EXISTS branch_id UUID REFERENCES branches(id) ON DELETE CASCADE;
      ALTER TABLE custom_roles ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES users(id) ON DELETE SET NULL;
      UPDATE custom_roles cr
      SET branch_id = (
        SELECT id FROM branches b WHERE b.tenant_id = cr.tenant_id ORDER BY b.created_at ASC LIMIT 1
      )
      WHERE cr.branch_id IS NULL AND cr.is_system = false;
    `).catch(() => {});
  }

  async listRoles(tenantId: string, branchId?: string, includeSystem = false) {
    await this.ensureRolesTableBranchColumn();
    let sql = `
      SELECT cr.id, cr.tenant_id, cr.branch_id as "branchId", b.name as "branchName",
             cr.name, cr.description, cr.is_system as "isSystem", cr.system_role as "systemRole",
             cr.base_role_id as "baseRoleId", sr.name as "baseRoleName",
             cr.created_at as "createdAt", cr.updated_at as "updatedAt",
             cr.created_by as "createdById", u.full_name as "createdByName", u.email as "createdByEmail"
      FROM custom_roles cr
      LEFT JOIN branches b ON b.id = cr.branch_id
      LEFT JOIN users u ON u.id = cr.created_by
      LEFT JOIN custom_roles sr ON cr.base_role_id = sr.id
      WHERE cr.tenant_id = $1
    `;
    const params: any[] = [tenantId];

    if (!includeSystem) {
      sql += ' AND cr.is_system = false';
    } else if (tenantId !== DEFAULT_TENANT_ID) {
      sql += " AND cr.name <> 'SUPER_ADMIN'";
    }

    if (branchId) {
      params.push(branchId);
      sql += ` AND (cr.branch_id = $${params.length}::uuid OR (cr.is_system = true AND cr.branch_id IS NULL))`;
    }

    sql += ' ORDER BY (cr.is_system = false) DESC, cr.name ASC';
    const rolesRes = await this.db.query(sql, params);
    const roles = rolesRes.rows;

    const DEFAULT_PERMS: Record<string, string[]> = {
      ADMIN: [
        'job:create', 'job:edit', 'job:view', 'job:publish_direct', 'job:approve', 'job:reject',
        'job:assign', 'job:assign_recruiter', 'job:assign_pod',
        'candidate:create', 'candidate:view',
        'submission:view', 'submission:create', 'submission:internal_screening', 'submission:audit_rounds', 'submission:audit_l1', 'submission:audit_l2', 'submission:audit_l3', 'submission:final_status', 'submission:approve_client', 'submission:schedule_interview', 'submission:edit_rate', 'submission:edit',
        'client:view', 'client:create', 'client:direct_add', 'client:edit', 'client:approve', 'client:reject', 'client:delete',
        'tenant:settings', 'user:manage',
        'pod:create', 'pod:edit', 'pod:delete', 'pod:view', 'pod:reset_cycle', 'pod:overlap',
        'branch_admin:manage', 'candidate:search_all_branches', 'job:view_all_branches', 'candidate:search_all_markets',
        'placement:view', 'placement:create', 'report:view'
      ],
      BRANCH_ADMIN: [
        'job:create', 'job:view', 'job:edit', 'job:publish_direct', 'job:approve', 'job:reject',
        'job:assign', 'job:assign_recruiter', 'job:assign_pod',
        'candidate:create', 'candidate:view',
        'submission:create', 'submission:view', 'submission:internal_screening', 'submission:audit_rounds', 'submission:audit_l1', 'submission:audit_l2', 'submission:audit_l3', 'submission:final_status', 'submission:approve_client', 'submission:schedule_interview', 'submission:edit_rate', 'submission:edit',
        'client:view', 'client:create', 'client:direct_add', 'client:edit', 'client:approve', 'client:reject',
        'branch_admin:manage', 'user:manage', 'pod:view', 'pod:edit',
        'placement:view', 'placement:create', 'report:view'
      ],
      RECRUITER: [
        'candidate:create', 'candidate:view',
        'submission:create', 'submission:view', 'submission:edit',
        'job:view',
        'client:view',
        'pod:view'
      ],
      ACCOUNT_MANAGER: [
        'job:create', 'job:edit', 'job:view', 'job:publish_direct', 'job:approve', 'job:reject',
        'job:assign_recruiter',
        'candidate:view', 'candidate:create',
        'submission:view', 'submission:create', 'submission:audit_rounds', 'submission:audit_l1', 'submission:audit_l2', 'submission:audit_l3', 'submission:final_status', 'submission:schedule_interview', 'submission:edit_rate', 'submission:edit',
        'pod:view',
        'client:view', 'client:create', 'client:direct_add', 'client:edit',
        'placement:view', 'placement:create',
        'report:view'
      ],
      DELIVERY_HEAD: [
        'job:view', 'job:edit', 'job:approve', 'job:reject',
        'job:assign', 'job:assign_recruiter', 'job:assign_pod',
        'candidate:view', 'candidate:create',
        'submission:view', 'submission:create', 'submission:internal_screening', 'submission:audit_rounds', 'submission:audit_l1', 'submission:audit_l2', 'submission:audit_l3', 'submission:final_status', 'submission:approve_client', 'submission:schedule_interview', 'submission:edit_rate', 'submission:edit',
        'client:view', 'client:create', 'client:edit', 'client:approve', 'client:reject',
        'pod:create', 'pod:edit', 'pod:delete', 'pod:view', 'pod:reset_cycle', 'pod:overlap',
        'candidate:search_all_branches', 'job:view_all_branches', 'candidate:search_all_markets',
        'placement:view', 'report:view'
      ],
      POD_LEAD: [
        'job:view', 'job:edit', 'job:approve', 'job:reject',
        'candidate:view', 'candidate:create',
        'submission:view', 'submission:create', 'submission:internal_screening', 'submission:schedule_interview', 'submission:edit',
        'client:view',
        'pod:view', 'pod:edit', 'report:view'
      ]
    };

    // Track covered archetypes across custom roles
    const coveredArchetypes = new Set<string>();
    for (const r of roles) {
      if (!r.isSystem) {
        if (r.systemRole) coveredArchetypes.add(r.systemRole.toUpperCase().replace(/[\s-_]/g, ''));
        if (r.baseRoleName) coveredArchetypes.add(r.baseRoleName.toUpperCase().replace(/[\s-_]/g, ''));
        if (r.name) coveredArchetypes.add(r.name.toUpperCase().replace(/[\s-_]/g, ''));
      }
    }

    const result: any[] = [];
    for (const role of roles) {
      const baseSysRole = (role.systemRole || role.name || '').toUpperCase();
      const defaultPerms = DEFAULT_PERMS[baseSysRole] || [];

      // Fetch dynamic permissions assigned to role
      const permsRes = await this.db.query(
        'SELECT permission FROM role_permissions WHERE role_id = $1',
        [role.id]
      );
      const rolePerms = permsRes.rows.map(row => row.permission);

      // Clean role display name if it's the raw ADMIN system role
      let displayName = role.name;
      if (role.isSystem && (role.name === 'ADMIN' || role.name === 'TENANT_ADMIN')) {
        displayName = 'Tenant Admin';
      }

      result.push({
        ...role,
        name: displayName,
        permissions: role.isSystem && defaultPerms.length > 0 ? (rolePerms.length > 0 ? rolePerms : defaultPerms) : rolePerms,
        isExactSubstitution: !role.isSystem,
        replacesSystemRole: !role.isSystem && role.systemRole ? baseSysRole : null,
      });
    }

    // Suppress system roles that are already superseded by custom roles in the branch
    return result.filter(r => {
      if (r.isSystem) {
        const sysNorm = (r.systemRole || '').toUpperCase().replace(/[\s-_]/g, '');
        const nameNorm = (r.name || '').toUpperCase().replace(/[\s-_]/g, '');
        if (coveredArchetypes.has(sysNorm) || coveredArchetypes.has(nameNorm)) {
          return false;
        }
        if (branchId && (nameNorm === 'ADMIN' || nameNorm === 'TENANTADMIN' || nameNorm === 'SUPERADMIN')) {
          return false;
        }
      }
      return true;
    });
  }

  async getAssignableRolePool(tenantId: string, branchId?: string) {
    const allRoles = await this.listRoles(tenantId, branchId, true);
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

  async createCustomRole(
    tenantId: string,
    name: string,
    description: string,
    permissions: string[],
    systemRole?: string,
    branchId?: string,
    createdById?: string,
    baseRoleId?: string,
  ) {
    await this.ensureRolesTableBranchColumn();
    const nameUpper = name.toUpperCase().trim();
    if (nameUpper === 'SUPER_ADMIN') {
      throw new BadRequestException('Role name SUPER_ADMIN is reserved for the root system administrator.');
    }

    let resolvedBaseRoleId = baseRoleId || null;
    let resolvedSystemRole = systemRole?.toUpperCase().trim() || 'RECRUITER';

    if (resolvedBaseRoleId) {
      const baseRoleRes = await this.db.query(
        'SELECT id, name, system_role FROM custom_roles WHERE id = $1 AND tenant_id = $2 LIMIT 1',
        [resolvedBaseRoleId, tenantId]
      );
      if (baseRoleRes.rows.length > 0) {
        resolvedSystemRole = baseRoleRes.rows[0].system_role || baseRoleRes.rows[0].name;
      }
    } else {
      const baseRoleRes = await this.db.query(
        'SELECT id FROM custom_roles WHERE tenant_id = $1 AND is_system = true AND (UPPER(name) = $2 OR UPPER(system_role) = $2) LIMIT 1',
        [tenantId, resolvedSystemRole]
      );
      resolvedBaseRoleId = baseRoleRes.rows[0]?.id || null;
    }

    if (!['ADMIN', 'BRANCH_ADMIN', 'ACCOUNT_MANAGER', 'RECRUITER', 'DELIVERY_HEAD', 'POD_LEAD'].includes(resolvedSystemRole)) {
      throw new BadRequestException('Invalid base system role selected.');
    }

    let effectiveBranchId = branchId || null;
    if (!effectiveBranchId) {
      const defaultBranchRes = await this.db.query(
        'SELECT id FROM branches WHERE tenant_id = $1 ORDER BY created_at ASC LIMIT 1',
        [tenantId]
      );
      effectiveBranchId = defaultBranchRes.rows[0]?.id || null;
    }

    const DEFAULT_PERMISSIONS: Record<string, string[]> = {
      ADMIN: [
        'job:create', 'job:edit', 'job:view', 'job:publish_direct', 'job:approve', 'job:reject',
        'job:assign', 'job:assign_recruiter', 'job:assign_pod',
        'candidate:create', 'candidate:view',
        'submission:view', 'submission:create', 'submission:internal_screening', 'submission:audit_rounds', 'submission:audit_l1', 'submission:audit_l2', 'submission:audit_l3', 'submission:final_status', 'submission:approve_client', 'submission:schedule_interview', 'submission:edit_rate', 'submission:edit',
        'client:view', 'client:create', 'client:direct_add', 'client:edit', 'client:approve', 'client:reject', 'client:delete',
        'tenant:settings', 'user:manage',
        'pod:create', 'pod:edit', 'pod:delete', 'pod:view', 'pod:reset_cycle', 'pod:overlap',
        'branch_admin:manage', 'candidate:search_all_branches', 'job:view_all_branches', 'candidate:search_all_markets',
        'placement:view', 'placement:create', 'report:view'
      ],
      BRANCH_ADMIN: [
        'job:create', 'job:view', 'job:edit', 'job:publish_direct', 'job:approve', 'job:reject',
        'job:assign', 'job:assign_recruiter', 'job:assign_pod',
        'candidate:create', 'candidate:view',
        'submission:create', 'submission:view', 'submission:internal_screening', 'submission:audit_rounds', 'submission:audit_l1', 'submission:audit_l2', 'submission:audit_l3', 'submission:final_status', 'submission:approve_client', 'submission:schedule_interview', 'submission:edit_rate', 'submission:edit',
        'client:view', 'client:create', 'client:direct_add', 'client:edit', 'client:approve', 'client:reject',
        'branch_admin:manage', 'user:manage', 'pod:view', 'pod:edit',
        'placement:view', 'placement:create', 'report:view'
      ],
      RECRUITER: [
        'candidate:create', 'candidate:view',
        'submission:create', 'submission:view', 'submission:edit',
        'job:view',
        'client:view',
        'pod:view'
      ],
      ACCOUNT_MANAGER: [
        'job:create', 'job:edit', 'job:view', 'job:publish_direct', 'job:approve', 'job:reject',
        'job:assign_recruiter',
        'candidate:view', 'candidate:create',
        'submission:view', 'submission:create', 'submission:audit_rounds', 'submission:audit_l1', 'submission:audit_l2', 'submission:audit_l3', 'submission:final_status', 'submission:schedule_interview', 'submission:edit_rate', 'submission:edit',
        'pod:view',
        'client:view', 'client:create', 'client:direct_add', 'client:edit',
        'placement:view', 'placement:create',
        'report:view'
      ],
      DELIVERY_HEAD: [
        'job:view', 'job:edit', 'job:approve', 'job:reject',
        'job:assign', 'job:assign_recruiter', 'job:assign_pod',
        'candidate:view', 'candidate:create',
        'submission:view', 'submission:create', 'submission:internal_screening', 'submission:audit_rounds', 'submission:audit_l1', 'submission:audit_l2', 'submission:audit_l3', 'submission:final_status', 'submission:approve_client', 'submission:schedule_interview', 'submission:edit_rate', 'submission:edit',
        'client:view', 'client:create', 'client:edit', 'client:approve', 'client:reject',
        'pod:create', 'pod:edit', 'pod:delete', 'pod:view', 'pod:reset_cycle', 'pod:overlap',
        'candidate:search_all_branches', 'job:view_all_branches', 'candidate:search_all_markets',
        'placement:view', 'report:view'
      ],
      POD_LEAD: [
        'job:view', 'job:edit', 'job:approve', 'job:reject',
        'candidate:view', 'candidate:create',
        'submission:view', 'submission:create', 'submission:internal_screening', 'submission:schedule_interview', 'submission:edit',
        'client:view',
        'pod:view', 'pod:edit', 'report:view'
      ]
    };

    // Allowed base archetype ceiling
    const allowedBaseCeiling = new Set(DEFAULT_PERMISSIONS[resolvedSystemRole] || DEFAULT_PERMISSIONS.RECRUITER);

    // Determine default permissions for the selected base template if none or generic defaults are provided.
    let resolvedPermissions = permissions || [];
    if (
      resolvedPermissions.length === 0 || 
      (resolvedPermissions.length === 2 && resolvedPermissions.includes('job:view') && resolvedPermissions.includes('candidate:view'))
    ) {
      resolvedPermissions = DEFAULT_PERMISSIONS[resolvedSystemRole] || ['job:view', 'candidate:view'];
    }

    // Enforce permission ceiling: custom roles can NEVER have extra permissions beyond their base system archetype
    resolvedPermissions = resolvedPermissions.filter(p => allowedBaseCeiling.has(p));

    const exists = await this.db.query(
      'SELECT id FROM custom_roles WHERE tenant_id = $1 AND UPPER(name) = $2 AND is_system = false AND (branch_id = $3::uuid OR ($3::uuid IS NULL AND branch_id IS NULL)) LIMIT 1',
      [tenantId, nameUpper, effectiveBranchId]
    );
    if (exists.rows.length > 0) {
      throw new ConflictException(`A custom role with name "${name}" already exists in this branch.`);
    }

    const roleRes = await this.db.query(
      `INSERT INTO custom_roles (tenant_id, branch_id, name, description, is_system, system_role, base_role_id, created_by)
       VALUES ($1, $2, $3, $4, false, $5, $6, $7)
       RETURNING id, tenant_id, branch_id as "branchId", name, description, is_system as "isSystem", system_role as "systemRole", base_role_id as "baseRoleId", created_at as "createdAt", updated_at as "updatedAt", created_by as "createdById"`,
      [tenantId, effectiveBranchId, name, description, resolvedSystemRole, resolvedBaseRoleId, createdById || null]
    );
    const role = roleRes.rows[0];

    for (const perm of resolvedPermissions) {
      await this.db.query(
        'INSERT INTO role_permissions (role_id, permission) VALUES ($1, $2)',
        [role.id, perm]
      );
    }

    let branchName = null;
    if (effectiveBranchId) {
      const bRes = await this.db.query('SELECT name FROM branches WHERE id = $1', [effectiveBranchId]);
      branchName = bRes.rows[0]?.name || null;
    }

    return {
      ...role,
      branchName,
      permissions: resolvedPermissions
    };
  }

  async updateCustomRole(
    tenantId: string,
    roleId: string,
    body: { name?: string; description?: string; systemRole?: string; baseRoleId?: string; branchId?: string; permissions?: string[] },
    userId?: string,
  ) {
    await this.ensureRolesTableBranchColumn();
    const roleResult = await this.db.query(
      'SELECT id, name, is_system, branch_id, base_role_id FROM custom_roles WHERE id = $1 AND tenant_id = $2 LIMIT 1',
      [roleId, tenantId]
    );
    if (roleResult.rows.length === 0) {
      throw new NotFoundException('Role not found.');
    }
    const existingRole = roleResult.rows[0];
    if (existingRole.is_system) {
      throw new BadRequestException('Default system archetype templates cannot be modified directly.');
    }

    const updates: string[] = ['updated_at = NOW()'];
    const params: any[] = [roleId, tenantId];

    if (body.name !== undefined) {
      const nameUpper = body.name.toUpperCase().trim();
      if (nameUpper === 'SUPER_ADMIN') {
        throw new BadRequestException('Role name SUPER_ADMIN is reserved.');
      }
      const targetBranchId = body.branchId !== undefined ? body.branchId : existingRole.branch_id;
      const exists = await this.db.query(
        'SELECT id FROM custom_roles WHERE tenant_id = $1 AND UPPER(name) = $2 AND is_system = false AND (branch_id = $3::uuid OR ($3::uuid IS NULL AND branch_id IS NULL)) AND id <> $4 LIMIT 1',
        [tenantId, nameUpper, targetBranchId, roleId]
      );
      if (exists.rows.length > 0) {
        throw new ConflictException(`A custom role with name "${body.name}" already exists in this branch.`);
      }
      params.push(body.name.trim());
      updates.push(`name = $${params.length}`);
    }

    if (body.description !== undefined) {
      params.push(body.description);
      updates.push(`description = $${params.length}`);
    }

    if (body.baseRoleId !== undefined) {
      params.push(body.baseRoleId || null);
      updates.push(`base_role_id = $${params.length}`);
    }

    if (body.systemRole !== undefined) {
      const resolvedSystemRole = body.systemRole.toUpperCase().trim();
      if (!['ADMIN', 'BRANCH_ADMIN', 'ACCOUNT_MANAGER', 'RECRUITER', 'DELIVERY_HEAD', 'POD_LEAD'].includes(resolvedSystemRole)) {
        throw new BadRequestException('Invalid base system role selected.');
      }
      params.push(resolvedSystemRole);
      updates.push(`system_role = $${params.length}`);
    }

    if (body.branchId !== undefined) {
      params.push(body.branchId);
      updates.push(`branch_id = $${params.length}::uuid`);
    }

    if (updates.length > 1) {
      await this.db.query(
        `UPDATE custom_roles SET ${updates.join(', ')} WHERE id = $1 AND tenant_id = $2`,
        params
      );

      // Cascade role name rename to users.roles and users.branch_roles across the tenant
      if (body.name !== undefined && body.name.trim() !== existingRole.name) {
        const oldName = existingRole.name;
        const newName = body.name.trim();

        const usersToUpdate = await this.db.query(
          'SELECT id, branch_roles FROM users WHERE tenant_id = $1',
          [tenantId]
        );

        for (const u of usersToUpdate.rows) {
          let needsUpdate = false;
          let branchRoles: Record<string, string[]> = u.branch_roles || {};

          for (const [bId, rList] of Object.entries(branchRoles)) {
            if (Array.isArray(rList) && rList.some((r: string) => r.toUpperCase() === oldName.toUpperCase())) {
              branchRoles[bId] = rList.map((r: string) => r.toUpperCase() === oldName.toUpperCase() ? roleId : r);
              needsUpdate = true;
            }
          }

          if (needsUpdate) {
            await this.db.query(
              'UPDATE users SET branch_roles = $1::jsonb, updated_at = NOW() WHERE id = $2',
              [JSON.stringify(branchRoles), u.id]
            );
          }
        }
      }
    }

    if (body.permissions && Array.isArray(body.permissions)) {
      await this.updateRolePermissions(tenantId, roleId, body.permissions);
    }

    return { message: 'Custom role updated successfully.', roleId };
  }

  async updateRolePermissions(tenantId: string, roleId: string, permissions: string[]) {
    const roleResult = await this.db.query(
      'SELECT id, is_system, system_role, base_role_id FROM custom_roles WHERE id = $1 AND tenant_id = $2 LIMIT 1',
      [roleId, tenantId]
    );
    if (roleResult.rows.length === 0) {
      throw new NotFoundException('Role not found.');
    }
    const role = roleResult.rows[0];

    const DEFAULT_PERMISSIONS: Record<string, string[]> = {
      ADMIN: [
        'job:create', 'job:edit', 'job:view', 'job:publish_direct', 'job:approve', 'job:reject',
        'job:assign', 'job:assign_recruiter', 'job:assign_pod',
        'candidate:create', 'candidate:view',
        'submission:view', 'submission:create', 'submission:internal_screening', 'submission:audit_rounds', 'submission:audit_l1', 'submission:audit_l2', 'submission:audit_l3', 'submission:final_status', 'submission:approve_client', 'submission:schedule_interview', 'submission:edit_rate', 'submission:edit',
        'client:view', 'client:create', 'client:direct_add', 'client:edit', 'client:approve', 'client:reject', 'client:delete',
        'tenant:settings', 'user:manage',
        'pod:create', 'pod:edit', 'pod:delete', 'pod:view', 'pod:reset_cycle', 'pod:overlap',
        'branch_admin:manage', 'candidate:search_all_branches', 'job:view_all_branches', 'candidate:search_all_markets',
        'placement:view', 'placement:create', 'report:view'
      ],
      BRANCH_ADMIN: [
        'job:create', 'job:view', 'job:edit', 'job:publish_direct', 'job:approve', 'job:reject',
        'job:assign', 'job:assign_recruiter', 'job:assign_pod',
        'candidate:create', 'candidate:view',
        'submission:create', 'submission:view', 'submission:internal_screening', 'submission:audit_rounds', 'submission:audit_l1', 'submission:audit_l2', 'submission:audit_l3', 'submission:final_status', 'submission:approve_client', 'submission:schedule_interview', 'submission:edit_rate', 'submission:edit',
        'client:view', 'client:create', 'client:direct_add', 'client:edit', 'client:approve', 'client:reject',
        'branch_admin:manage', 'user:manage', 'pod:view', 'pod:edit',
        'placement:view', 'placement:create', 'report:view'
      ],
      RECRUITER: [
        'candidate:create', 'candidate:view',
        'submission:create', 'submission:view', 'submission:edit',
        'job:view',
        'client:view',
        'pod:view'
      ],
      ACCOUNT_MANAGER: [
        'job:create', 'job:edit', 'job:view', 'job:publish_direct', 'job:approve', 'job:reject',
        'job:assign_recruiter',
        'candidate:view', 'candidate:create',
        'submission:view', 'submission:create', 'submission:audit_rounds', 'submission:audit_l1', 'submission:audit_l2', 'submission:audit_l3', 'submission:final_status', 'submission:schedule_interview', 'submission:edit_rate', 'submission:edit',
        'pod:view',
        'client:view', 'client:create', 'client:direct_add', 'client:edit',
        'placement:view', 'placement:create',
        'report:view'
      ],
      DELIVERY_HEAD: [
        'job:view', 'job:edit', 'job:approve', 'job:reject',
        'job:assign', 'job:assign_recruiter', 'job:assign_pod',
        'candidate:view', 'candidate:create',
        'submission:view', 'submission:create', 'submission:internal_screening', 'submission:audit_rounds', 'submission:audit_l1', 'submission:audit_l2', 'submission:audit_l3', 'submission:final_status', 'submission:approve_client', 'submission:schedule_interview', 'submission:edit_rate', 'submission:edit',
        'client:view', 'client:create', 'client:edit', 'client:approve', 'client:reject',
        'pod:create', 'pod:edit', 'pod:delete', 'pod:view', 'pod:reset_cycle', 'pod:overlap',
        'candidate:search_all_branches', 'job:view_all_branches', 'candidate:search_all_markets',
        'placement:view', 'report:view'
      ],
      POD_LEAD: [
        'job:view', 'job:edit', 'job:approve', 'job:reject',
        'candidate:view', 'candidate:create',
        'submission:view', 'submission:create', 'submission:internal_screening', 'submission:schedule_interview', 'submission:edit',
        'client:view',
        'pod:view', 'pod:edit', 'report:view'
      ]
    };

    const sysKey = (role.system_role || 'RECRUITER').toUpperCase();
    const allowedCeiling = new Set(DEFAULT_PERMISSIONS[sysKey] || DEFAULT_PERMISSIONS.RECRUITER);
    const filteredPermissions = role.is_system ? permissions : permissions.filter(p => allowedCeiling.has(p));

    // Update permissions in database
    await this.db.query('DELETE FROM role_permissions WHERE role_id = $1', [roleId]);
    for (const perm of filteredPermissions) {
      await this.db.query(
        'INSERT INTO role_permissions (role_id, permission) VALUES ($1, $2)',
        [roleId, perm]
      );
    }

    return { message: 'Permissions updated successfully.', permissions: filteredPermissions };
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

      // Replace role ID in users.assigned_role_ids array
      await this.db.query(
        `UPDATE users SET assigned_role_ids = array_replace(assigned_role_ids, $1::uuid, $2::uuid) WHERE tenant_id = $3 AND $1::uuid = ANY(assigned_role_ids)`,
        [roleId, targetRole.id, tenantId]
      ).catch(() => {});
    } else {
      // Remove role ID from users.assigned_role_ids array
      await this.db.query(
        `UPDATE users SET assigned_role_ids = array_remove(assigned_role_ids, $1::uuid) WHERE tenant_id = $2 AND $1::uuid = ANY(assigned_role_ids)`,
        [roleId, tenantId]
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


  async assignUserRoles(tenantId: string, userId: string, roleIds: string[], requesterRoles: string[], append: boolean = false) {
    if (!roleIds || roleIds.length === 0) {
      throw new BadRequestException('Please specify at least one role.');
    }

    // Get selected roles details
    const rolesResult = await this.db.query(
      'SELECT id, name, branch_id FROM custom_roles WHERE id = ANY($1) AND tenant_id = $2',
      [roleIds, tenantId]
    );
    if (rolesResult.rows.length === 0) {
      throw new NotFoundException('Selected roles were not found.');
    }
    const newRolesData = rolesResult.rows;
    const newRoleNames = newRolesData.map(r => r.name);

    // Block assigning SUPER_ADMIN unless requester has SUPER_ADMIN role
    const newRoleNamesUpper = newRoleNames.map(r => r.toUpperCase());
    if (newRoleNamesUpper.includes('SUPER_ADMIN') && (!requesterRoles || !requesterRoles.includes('SUPER_ADMIN'))) {
      throw new ForbiddenException('You are not authorized to assign the SUPER_ADMIN role.');
    }

    // Fetch target user details
    const userRes = await this.db.query(
      'SELECT tenant_id, roles, role_id, assigned_role_ids, branch_roles FROM users WHERE id = $1 AND tenant_id = $2 LIMIT 1',
      [userId, tenantId]
    );
    if (userRes.rows.length === 0) {
      throw new NotFoundException('User not found.');
    }
    const targetUser = userRes.rows[0];
    const targetUserRoles = Array.isArray(targetUser.roles) ? targetUser.roles : [];
    const targetAssignedRoleIds = Array.isArray(targetUser.assigned_role_ids) ? targetUser.assigned_role_ids : [];
    const targetBranchRoles = targetUser.branch_roles || {};

    // Block modifying SUPER_ADMIN user roles unless requester is SUPER_ADMIN
    if (targetUserRoles.includes('SUPER_ADMIN') && (!requesterRoles || !requesterRoles.includes('SUPER_ADMIN'))) {
      throw new ForbiddenException('You are not authorized to modify roles of a SUPER_ADMIN.');
    }

    // Determine final combined roles array
    let finalRoles: string[];
    let finalAssignedRoleIds: string[];
    let finalBranchRoles: any;

    if (append) {
      finalRoles = [...targetUserRoles];
      finalAssignedRoleIds = [...targetAssignedRoleIds];
      finalBranchRoles = { ...targetBranchRoles };
      
      for (const r of newRolesData) {
        if (!finalRoles.includes(r.name)) finalRoles.push(r.name);
        if (!finalAssignedRoleIds.includes(r.id)) finalAssignedRoleIds.push(r.id);
        if (r.branch_id) {
          const bList = Array.isArray(finalBranchRoles[r.branch_id]) ? finalBranchRoles[r.branch_id] : [];
          if (!bList.includes(r.id)) finalBranchRoles[r.branch_id] = [...bList, r.id];
        }
      }
    } else {
      finalRoles = newRoleNames;
      finalAssignedRoleIds = newRolesData.map(r => r.id);
      finalBranchRoles = {};
      for (const r of newRolesData) {
        if (r.branch_id) {
          const bList = Array.isArray(finalBranchRoles[r.branch_id]) ? finalBranchRoles[r.branch_id] : [];
          if (!bList.includes(r.id)) finalBranchRoles[r.branch_id] = [...bList, r.id];
        }
      }
    }

    // Demoting check: if new roles do not contain ADMIN, protect last admin lockout
    const isNewAdmin = finalRoles.some(r => r.toUpperCase() === 'ADMIN');
    if (!isNewAdmin) {
      await this.verifyLastAdminProtection(tenantId, userId, 'demote');
    }

    // Update user: link primary role_id (first item) and synchronize roles array
    await this.db.query(
      `UPDATE users 
       SET role_id = $1, roles = $2, assigned_role_ids = $3, branch_roles = $4, updated_at = NOW() 
       WHERE id = $5 AND tenant_id = $6`,
      [roleIds[0] || targetUser.role_id, finalRoles, finalAssignedRoleIds, JSON.stringify(finalBranchRoles), userId, tenantId]
    );

    return { message: 'User roles assigned successfully.', roles: finalRoles };
  }

  async batchAssignUsersToRole(tenantId: string, roleId: string, userIds: string[], requesterRoles: string[]) {
    if (!userIds || userIds.length === 0) {
      throw new BadRequestException('Please provide at least one user ID.');
    }

    const roleRes = await this.db.query(
      'SELECT id, name, is_system, system_role FROM custom_roles WHERE id = $1 AND tenant_id = $2 LIMIT 1',
      [roleId, tenantId]
    );
    if (roleRes.rows.length === 0) {
      throw new NotFoundException('Target custom role not found.');
    }
    const targetRole = roleRes.rows[0];

    let assignedCount = 0;
    for (const userId of userIds) {
      const uRes = await this.db.query(
        'SELECT id, roles, role_id FROM users WHERE id = $1 AND tenant_id = $2 LIMIT 1',
        [userId, tenantId]
      );
      if (uRes.rows.length === 0) continue;
      const user = uRes.rows[0];
      const currentRoles: string[] = user.roles || [];

      // Add targetRole.name if not present
      const hasRole = currentRoles.some(r => r.toUpperCase() === targetRole.name.toUpperCase());
      const updatedRoles = hasRole ? currentRoles : [...currentRoles, targetRole.name];

      await this.db.query(
        `UPDATE users 
         SET role_id = $1, roles = $2, updated_at = NOW() 
         WHERE id = $3 AND tenant_id = $4`,
        [targetRole.id, updatedRoles, userId, tenantId]
      );
      assignedCount++;
    }

    return { message: `Successfully assigned ${assignedCount} user(s) to role "${targetRole.name}".`, count: assignedCount };
  }

  async unassignUserFromRole(tenantId: string, roleId: string, userId: string) {
    const roleRes = await this.db.query(
      'SELECT id, name, is_system, system_role FROM custom_roles WHERE id = $1 AND tenant_id = $2 LIMIT 1',
      [roleId, tenantId]
    );
    if (roleRes.rows.length === 0) {
      throw new NotFoundException('Role not found.');
    }
    const role = roleRes.rows[0];

    const uRes = await this.db.query(
      'SELECT id, roles, role_id FROM users WHERE id = $1 AND tenant_id = $2 LIMIT 1',
      [userId, tenantId]
    );
    if (uRes.rows.length === 0) {
      throw new NotFoundException('User not found.');
    }
    const user = uRes.rows[0];
    const currentRoles: string[] = user.roles || [];

    // Filter out this role name
    let remainingRoles = currentRoles.filter(r => r.toUpperCase() !== role.name.toUpperCase());

    // If no roles remain, fallback to RECRUITER
    if (remainingRoles.length === 0) {
      remainingRoles = ['RECRUITER'];
    }

    // Find next valid custom role ID if current role_id was this role
    let nextRoleId = user.role_id === role.id ? null : user.role_id;
    if (!nextRoleId && remainingRoles.length > 0) {
      const nextRoleRes = await this.db.query(
        'SELECT id FROM custom_roles WHERE tenant_id = $1 AND (name = $2 OR UPPER(name) = UPPER($2)) LIMIT 1',
        [tenantId, remainingRoles[0]]
      );
      nextRoleId = nextRoleRes.rows[0]?.id || null;
    }

    await this.db.query(
      `UPDATE users 
       SET role_id = $1, roles = $2, updated_at = NOW() 
       WHERE id = $3 AND tenant_id = $4`,
      [nextRoleId, remainingRoles, userId, tenantId]
    );

    return { message: `Removed user from role "${role.name}".`, remainingRoles };
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
      { id: 'client:create', name: 'Create New Clients (Pending Approval)', group: 'Clients & Placements' },
      { id: 'client:direct_add', name: 'Direct Add Clients (Bypass Approval Gate)', group: 'Clients & Placements' },
      { id: 'client:edit', name: 'Edit Client Profiles & Terms', group: 'Clients & Placements' },
      { id: 'client:approve', name: 'Approve & Activate Client Accounts', group: 'Clients & Placements' },
      { id: 'client:reject', name: 'Reject Client Accounts with Feedback', group: 'Clients & Placements' },
      { id: 'client:delete', name: 'Delete Client Accounts', group: 'Clients & Placements' },
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
      { id: 'branch:create', name: 'Create New Branch Locations', group: 'Branch & Multi-Office Management' },
      { id: 'branch:edit', name: 'Edit Branch Operating Hours, Timezone & Policies', group: 'Branch & Multi-Office Management' },
      { id: 'branch:delete', name: 'Delete Branch Office Locations', group: 'Branch & Multi-Office Management' },
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
      `SELECT u.id, u.email, u.first_name, u.last_name, u.full_name, u.created_at, u.tenant_id, 
              COALESCE(cr.name, 'Staff') as role_name,
              t.name as tenant_name, t.default_market, t.domain as tenant_domain
       FROM users u
       LEFT JOIN tenants t ON u.tenant_id = t.id
       LEFT JOIN custom_roles cr ON u.role_id = cr.id
       WHERE u.is_approved = false
       ORDER BY u.created_at DESC`
    );
    return result.rows.map(row => ({
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

    const adminFullName = dto.adminFullName.trim();
    const firstName = adminFullName.split(/\s+/)[0] || '';
    const lastName = adminFullName.split(/\s+/).slice(1).join(' ') || '';
    const assignedRoleIds = adminRoleId ? [adminRoleId] : [];
    const userResult = await this.db.query(
      `INSERT INTO users (tenant_id, email, first_name, last_name, full_name, is_active, is_approved, role_id, assigned_role_ids)
       VALUES ($1, $2, $3, $4, $5, true, true, $6, $7::uuid[])
       RETURNING id, email, first_name, last_name, full_name, tenant_id, created_at, role_id`,
      [tenant.id, email, firstName, lastName, adminFullName, adminRoleId, assignedRoleIds]
    );
    const user = userResult.rows[0];

    await this.provisionUserInKeycloak({
      email: user.email,
      password: password,
      fullName: user.full_name,
      tenantId: tenant.id,
    });

    return {
      message: `Tenant "${companyName}" created and activated successfully!`,
      tenant,
      adminUser: {
        id: user.id,
        email: user.email,
        firstName: user.first_name,
        lastName: user.last_name,
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
      `SELECT u.id, u.email, u.first_name as "firstName", u.last_name as "lastName", u.full_name as "fullName", u.is_active as "isActive", u.is_approved as "isApproved", u.created_at as "createdAt", cr.name as "roleName", cr.system_role as "systemRole"
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
      `SELECT u.role_id, u.assigned_role_ids, cr.name as role_name, cr.system_role, u.is_active, u.is_approved 
       FROM users u
       LEFT JOIN custom_roles cr ON cr.id = u.role_id
       WHERE u.id = $1 AND u.tenant_id = $2 LIMIT 1`,
      [targetUserId, tenantId]
    );
    if (userRes.rows.length === 0) {
      return;
    }
    const user = userRes.rows[0];
    const hasAdmin = user.system_role === 'ADMIN' || user.role_name === 'ADMIN';

    if (hasAdmin && user.is_active && user.is_approved) {
      // 2. Count active and approved admins in this tenant
      const adminsRes = await this.db.query(
        `SELECT COUNT(*) as count 
         FROM users u
         LEFT JOIN custom_roles cr ON cr.id = u.role_id
         WHERE u.tenant_id = $1 AND u.is_active = true AND u.is_approved = true 
           AND (cr.system_role = 'ADMIN' OR cr.name = 'ADMIN')`,
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
      `SELECT u.id, u.email, u.first_name, u.last_name, u.full_name, u.is_active, u.is_approved, u.tenant_id, u.role_id, u.assigned_role_ids, u.pod_id, u.branch_id, u.assigned_branch_ids, u.branch_roles, u.business_unit_id, u.profile_picture,
              t.name as tenant_name, t.default_market, t.domain as tenant_domain, t.status as tenant_status, t.pod_system_enabled,
              cr.system_role, cr.name as role_name, b.name as branch_name, bu.name as business_unit_name
       FROM users u
       LEFT JOIN tenants t ON u.tenant_id = t.id
       LEFT JOIN custom_roles cr ON u.role_id = cr.id
       LEFT JOIN branches b ON u.branch_id = b.id
       LEFT JOIN business_units bu ON u.business_unit_id = bu.id
       WHERE LOWER(u.email) = $1 AND (u.tenant_id = $2 OR cr.system_role = 'SUPER_ADMIN' OR cr.name = 'SUPER_ADMIN')
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

    // Fetch dynamic permissions and roles
    const userRoleIds = new Set<string>();
    if (user.role_id) userRoleIds.add(user.role_id);
    if (Array.isArray(user.assigned_role_ids)) {
      user.assigned_role_ids.forEach((rid: string) => userRoleIds.add(rid));
    }
    let permissions: string[] = [];
    let dynamicRoles: string[] = [];
    if (userRoleIds.size > 0) {
      const [permsResult, rolesResult] = await Promise.all([
        this.db.query(
          'SELECT DISTINCT permission FROM role_permissions WHERE role_id = ANY($1::uuid[])',
          [Array.from(userRoleIds)]
        ).catch(() => ({ rows: [] })),
        this.db.query(
          'SELECT id, name, system_role FROM custom_roles WHERE id = ANY($1::uuid[])',
          [Array.from(userRoleIds)]
        ).catch(() => ({ rows: [] }))
      ]);
      permissions = permsResult.rows.map((row: any) => row.permission);
      dynamicRoles = Array.from(new Set(rolesResult.rows.map((row: any) => row.name)));
    }
    if (dynamicRoles.length === 0 && user.role_name) {
      dynamicRoles = [user.role_name];
    }

    let systemRole = user.system_role || 'RECRUITER';
    if (dynamicRoles.includes('SUPER_ADMIN')) {
      systemRole = 'SUPER_ADMIN';
    }

    const token = this.signJwt({
      sub: user.id,
      email: user.email,
      fullName: user.full_name,
      roles: dynamicRoles,
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
        firstName: user.first_name || '',
        lastName: user.last_name || '',
        fullName: user.full_name,
        roles: dynamicRoles,
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
    const firstName = fullName.split(/\s+/)[0] || '';
    const lastName = fullName.split(/\s+/).slice(1).join(' ') || '';
    const assignedRoleIds = roleId ? [roleId] : [];
    const insertUserRes = await this.db.query(
      `INSERT INTO users (tenant_id, email, first_name, last_name, full_name, role_id, assigned_role_ids, branch_id, pod_id, is_active, is_approved)
       VALUES ($1, $2, $3, $4, $5, $6, $7::uuid[], $8, $9, true, true)
       RETURNING id, email, first_name, last_name, full_name, created_at`,
      [
        tenantId,
        cleanEmail,
        firstName,
        lastName,
        fullName,
        roleId,
        assignedRoleIds,
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

    await this.db.query(
      `UPDATE users SET is_active = true, is_approved = true, updated_at = NOW()
       WHERE LOWER(email) = LOWER($1) AND tenant_id = $2`,
      [invite.email, invite.tenant_id]
    );

    await this.provisionUserInKeycloak({
      email: invite.email,
      password: dto.password,
      fullName: invite.full_name,
      tenantId: invite.tenant_id,
    });

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
