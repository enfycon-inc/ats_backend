import { CANONICAL_SYSTEM_ROLES_SQL } from "./canonical-system-roles";
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { AuthQueryService } from './auth-query.service';
import { AuthRbacService } from './auth-rbac.service';
import { AuthKeycloakService } from './auth-keycloak.service';

const DEFAULT_TENANT_ID = process.env.DEFAULT_TENANT_ID || 'd3b07384-d113-49c3-a555-9ee75c13ca33';

/**
 * AuthInitService — handles all module initialization side-effects:
 * - DDL bootstrapping (ensuring required tables/columns exist)
 * - Role seeding and synchronization across tenants
 * - SUPER_ADMIN user seeding from environment variables
 * - Keycloak boot-time admin sync
 */
@Injectable()
export class AuthInitService implements OnModuleInit {
  private readonly logger = new Logger(AuthInitService.name);

  constructor(
    private readonly authQuery: AuthQueryService,
    private readonly rbacService: AuthRbacService,
    private readonly keycloakService: AuthKeycloakService,
  ) {}

  async onModuleInit() {
    await this.ensureDefaultTenants();
    await this.ensureUsersTable();
    await this.authQuery.query(CANONICAL_SYSTEM_ROLES_SQL);
    await this.seedDefaultUsers();

    // Sync active tenants' roles in background (non-blocking)
    this.syncAllTenantRoles().catch((err) => {
      this.logger.warn(`Background tenant role sync note: ${err.message}`);
    });

    const adminEmail = process.env.PLATFORM_ADMIN_EMAIL;
    const adminPassword = process.env.PLATFORM_ADMIN_PASSWORD;
    const adminName = process.env.PLATFORM_ADMIN_NAME || 'Platform Super Admin';

    if (adminEmail && adminPassword) {
      this.logger.log(`[BOOT] Syncing Platform Super Admin (${adminEmail}) into Keycloak...`);
      this.keycloakService.provisionUserInKeycloak({
        email: adminEmail,
        password: adminPassword,
        fullName: adminName,
        tenantId: DEFAULT_TENANT_ID,
      }).catch((err) => {
        this.logger.warn(`[BOOT] Async Keycloak admin sync note: ${err.message}`);
      });
    }

    // Re-provision all tenant SSO IdPs in Keycloak (they reset on container restart)
    this.reprovisionAllKeycloakIdps().catch((err) => {
      this.logger.warn(`[BOOT] Keycloak IdP re-provisioning note: ${err.message}`);
    });
  }

  private async reprovisionAllKeycloakIdps() {
    try {
      const result = await this.authQuery.query(`
        SELECT tenant_id, microsoft_tenant_id, microsoft_client_id, microsoft_client_secret
        FROM tenant_auth_settings
        WHERE microsoft_client_id IS NOT NULL
          AND microsoft_client_secret IS NOT NULL
          AND microsoft_client_secret != ''
      `);

      if (result.rows.length === 0) {
        this.logger.log('[BOOT] No tenant SSO configurations found to re-provision.');
        return;
      }

      this.logger.log(`[BOOT] Re-provisioning ${result.rows.length} tenant Keycloak IdP(s)...`);
      for (const row of result.rows as any[]) {
        try {
          if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(row.microsoft_tenant_id || '').trim())) {
            this.logger.warn(`[BOOT] Skipping Microsoft IdP for tenant ${row.tenant_id}: invalid Entra directory ID.`);
            continue;
          }
          if (!row.microsoft_client_secret || /^[*•]+$/.test(String(row.microsoft_client_secret).trim())) {
            this.logger.warn(`[BOOT] Skipping Microsoft IdP for tenant ${row.tenant_id}: the client secret is missing or masked.`);
            continue;
          }
          const redirectUri = await this.keycloakService.configureTenantIdentityProvider(
            row.tenant_id,
            row.microsoft_client_id,
            row.microsoft_client_secret,
            row.microsoft_tenant_id,
          );
          if (!redirectUri) throw new Error('Keycloak IdP synchronization returned no redirect URI');
          this.logger.log(`[BOOT] Re-provisioned Keycloak IdP for tenant ${row.tenant_id}`);
        } catch (err: any) {
          this.logger.warn(`[BOOT] Failed to re-provision IdP for tenant ${row.tenant_id}: ${err.message}`);
        }
      }
    } catch (err: any) {
      this.logger.warn(`[BOOT] Could not query tenant SSO settings: ${err.message}`);
    }
  }

  private async syncAllTenantRoles() {
    try {
      const tenantsResult = await this.authQuery.query('SELECT id FROM tenants');
      await Promise.all(tenantsResult.rows.map((tenant: any) => this.rbacService.seedTenantRoles(tenant.id)));
      this.logger.log('All tenant default roles and permissions successfully synchronized.');
    } catch (err: any) {
      this.logger.error(`Failed to synchronize tenant roles: ${err.message}`);
    }
  }

  private async ensureDefaultTenants() {
    try {
      // 1. Ensure Default Enfy SaaS Platform Tenant exists
      await this.authQuery.query(`
        INSERT INTO tenants (id, name, domain, status, default_market, prefix_code, pod_system_enabled, max_branches)
        VALUES ('${DEFAULT_TENANT_ID}', 'Default Enfy SaaS Tenant', 'enfy', 'ACTIVE', 'IN', 'ENFY', true, 5)
        ON CONFLICT (id) DO UPDATE SET
          name = EXCLUDED.name,
          domain = EXCLUDED.domain,
          status = 'ACTIVE';
      `);

      this.logger.log('✅ Core default platform tenant (Enfy SaaS) verified.');
    } catch (err: any) {
      this.logger.warn(`Default tenant bootstrap note: ${err.message}`);
    }
  }

  private async ensureUsersTable() {
    const ddl = `
      -- 0. Create system_roles table
      CREATE TABLE IF NOT EXISTS system_roles (
        id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name          VARCHAR(100) UNIQUE NOT NULL,
        system_key    VARCHAR(50) UNIQUE NOT NULL,
        description   TEXT,
        permissions   JSONB NOT NULL DEFAULT '[]',
        created_at    TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at    TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );

      -- 1. Create custom_roles table
      CREATE TABLE IF NOT EXISTS custom_roles (
        id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id     UUID NOT NULL DEFAULT '${DEFAULT_TENANT_ID}',
        branch_id     UUID REFERENCES branches(id) ON DELETE CASCADE,
        name          VARCHAR(100) NOT NULL,
        description   TEXT,
        is_system     BOOLEAN NOT NULL DEFAULT false,
        created_at    TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at    TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );

      -- Ensure branch_id, system_role_id, and base_role_id columns exist on custom_roles
      ALTER TABLE custom_roles ADD COLUMN IF NOT EXISTS branch_id UUID REFERENCES branches(id) ON DELETE CASCADE;
      ALTER TABLE custom_roles ADD COLUMN IF NOT EXISTS system_role_id UUID REFERENCES system_roles(id) ON DELETE SET NULL;
      ALTER TABLE custom_roles ADD COLUMN IF NOT EXISTS business_unit_id UUID REFERENCES business_units(id) ON DELETE CASCADE;
      ALTER TABLE custom_roles ADD COLUMN IF NOT EXISTS base_role_id UUID REFERENCES custom_roles(id) ON DELETE SET NULL;
      ALTER TABLE custom_roles ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES users(id) ON DELETE SET NULL;
      ALTER TABLE custom_roles DROP CONSTRAINT IF EXISTS custom_roles_tenant_id_name_key;
      CREATE UNIQUE INDEX IF NOT EXISTS idx_custom_roles_branch_name 
        ON custom_roles (tenant_id, branch_id, UPPER(name)) 
        WHERE is_system = false AND branch_id IS NOT NULL;
      CREATE UNIQUE INDEX IF NOT EXISTS idx_custom_roles_system_name 
        ON custom_roles (tenant_id, UPPER(name)) 
        WHERE is_system = true;

      -- Populate standard system roles if they don't exist
      INSERT INTO system_roles (name, system_key, permissions) VALUES
      ('Super Admin', 'SUPER_ADMIN', '["platform:manage", "tenant:manage", "user:manage"]'),
      ('Tenant Admin', 'TENANT_ADMIN', '["job:create", "job:edit", "job:view", "job:publish_direct", "job:approve", "job:reject", "job:assign", "job:assign_recruiter", "job:assign_pod", "candidate:create", "candidate:view", "submission:create", "submission:view", "submission:edit", "submission:internal_screening", "submission:audit_rounds", "submission:audit_l1", "submission:audit_l2", "submission:audit_l3", "submission:final_status", "submission:approve_client", "submission:schedule_interview", "submission:edit_rate", "client:view", "client:create", "client:direct_add", "client:edit", "client:approve", "client:reject", "client:delete", "placement:view", "placement:create", "report:view", "tenant:settings", "user:manage", "pod:create", "pod:edit", "pod:delete", "pod:view", "pod:reset_cycle", "pod:overlap", "branch:create", "branch:edit", "branch:delete", "branch_admin:manage", "candidate:search_all_branches", "job:view_all_branches", "candidate:search_all_markets"]'),
      ('Branch Admin', 'BRANCH_ADMIN', '["job:create", "job:view", "job:edit", "job:publish_direct", "job:approve", "job:reject", "job:assign", "job:assign_recruiter", "job:assign_pod", "job:delegate", "job:accept_delegation", "candidate:create", "candidate:view", "submission:create", "submission:view", "submission:internal_screening", "submission:audit_rounds", "submission:audit_l1", "submission:audit_l2", "submission:audit_l3", "submission:final_status", "submission:approve_client", "submission:schedule_interview", "submission:edit_rate", "submission:edit", "client:view", "client:create", "client:direct_add", "client:edit", "client:approve", "client:reject", "placement:view", "placement:create", "report:view", "branch:edit", "branch_admin:manage", "branch:assign_user", "branch:assign_manager", "user:manage", "pod:create", "pod:edit", "pod:delete", "pod:view", "pod:reset_cycle", "pod:overlap"]'),
      ('Unit Admin', 'UNIT_ADMIN', '["job:create", "job:view", "job:edit", "job:publish_direct", "job:approve", "job:reject", "job:assign", "job:assign_recruiter", "job:assign_pod", "job:delegate", "job:accept_delegation", "candidate:create", "candidate:view", "submission:create", "submission:view", "submission:internal_screening", "submission:audit_rounds", "submission:audit_l1", "submission:audit_l2", "submission:audit_l3", "submission:final_status", "submission:approve_client", "submission:schedule_interview", "submission:edit_rate", "submission:edit", "client:view", "client:create", "client:direct_add", "client:edit", "placement:view", "report:view", "unit_admin:manage", "branch:assign_user", "pod:create", "pod:edit", "pod:delete", "pod:view", "pod:reset_cycle", "pod:overlap"]'),
      ('Recruiter', 'RECRUITER', '["candidate:create", "candidate:view", "submission:create", "submission:view", "submission:edit", "job:view", "client:view", "pod:view"]'),
      ('Account Manager', 'ACCOUNT_MANAGER', '["job:create", "job:edit", "job:view", "job:publish_direct", "job:approve", "job:reject", "job:assign_recruiter", "candidate:view", "candidate:create", "submission:view", "submission:create", "submission:audit_rounds", "submission:audit_l1", "submission:audit_l2", "submission:audit_l3", "submission:final_status", "submission:schedule_interview", "submission:edit_rate", "submission:edit", "pod:view", "client:view", "client:create", "client:direct_add", "client:edit", "placement:view", "placement:create", "report:view"]'),
      ('Delivery Head', 'DELIVERY_HEAD', '["job:view", "job:edit", "job:approve", "job:reject", "job:assign", "job:assign_recruiter", "job:assign_pod", "candidate:view", "candidate:create", "submission:view", "submission:create", "submission:internal_screening", "submission:audit_rounds", "submission:audit_l1", "submission:audit_l2", "submission:audit_l3", "submission:final_status", "submission:approve_client", "submission:schedule_interview", "submission:edit_rate", "submission:edit", "client:view", "client:create", "client:edit", "client:approve", "client:reject", "pod:create", "pod:edit", "pod:delete", "pod:view", "pod:reset_cycle", "pod:overlap", "candidate:search_all_branches", "job:view_all_branches", "candidate:search_all_markets", "placement:view", "report:view"]'),
      ('Pod Lead', 'POD_LEAD', '["job:view", "candidate:view", "candidate:create", "submission:view", "submission:create", "submission:internal_screening", "submission:schedule_interview", "submission:edit", "client:view", "pod:view", "pod:edit", "report:view"]')
      ON CONFLICT (system_key) DO UPDATE SET permissions = EXCLUDED.permissions;

      -- Update system_role_id mappings for default system roles based on name
      UPDATE custom_roles cr
      SET system_role_id = sr.id
      FROM system_roles sr
      WHERE cr.is_system = true AND UPPER(cr.name) = sr.system_key;

      -- Link custom roles to their corresponding base system role ID
      UPDATE custom_roles cr
      SET base_role_id = (
        SELECT sr.id FROM custom_roles sr
        WHERE sr.tenant_id = cr.tenant_id
          AND sr.is_system = true
          AND sr.system_role_id = cr.system_role_id
        LIMIT 1
      )
      WHERE cr.is_system = false AND cr.base_role_id IS NULL AND cr.system_role_id IS NOT NULL;



      -- We no longer manually INSERT INTO role_permissions here since seedTenantRoles will do it from system_roles JSON.

      -- 2b. Create tenant_auth_settings table
      CREATE TABLE IF NOT EXISTS tenant_auth_settings (
        tenant_id               UUID PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
        allow_password_login    BOOLEAN NOT NULL DEFAULT true,
        allow_microsoft_sso     BOOLEAN NOT NULL DEFAULT true,
        allow_google_sso        BOOLEAN NOT NULL DEFAULT true,
        enforce_sso_only        BOOLEAN NOT NULL DEFAULT false,
        require_mfa             BOOLEAN NOT NULL DEFAULT false,
        allow_personal_emails   BOOLEAN NOT NULL DEFAULT true,
        allowed_email_domains   TEXT[] DEFAULT '{}',
        microsoft_tenant_id     VARCHAR(255),
        microsoft_client_id     VARCHAR(255),
        microsoft_client_secret TEXT,
        created_at              TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at              TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );

      -- 3. Create users table
      CREATE TABLE IF NOT EXISTS users (
        id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id     UUID NOT NULL DEFAULT '${DEFAULT_TENANT_ID}',
        keycloak_id   VARCHAR(255),
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

      -- Add branch_id, business_unit_id, and job_reviewer_id to users
      ALTER TABLE users ADD COLUMN IF NOT EXISTS branch_id UUID REFERENCES branches(id) ON DELETE SET NULL;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS business_unit_id UUID REFERENCES business_units(id) ON DELETE SET NULL;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS job_reviewer_id UUID REFERENCES users(id) ON DELETE SET NULL;
      DROP INDEX IF EXISTS users_keycloak_id_key CASCADE;
      CREATE UNIQUE INDEX IF NOT EXISTS users_tenant_id_keycloak_id_key ON users (tenant_id, keycloak_id);

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
    `;
    try {
      const statements = ddl
        .split(';')
        .map((s) => s.trim())
        .filter((s) => s.replace(/--[^\n]*/g, '').trim().length > 0);

      for (const statement of statements) {
        try {
          await this.authQuery.query(statement);
        } catch (err: any) {
          this.logger.debug(`DDL statement notice: ${err.message}`);
        }
      }
      this.logger.log('Users, default compulsory branches, and branch user assignments auto-resolved.');
      await this.syncUserRoleIdsFromCustomRoles();
    } catch (err: any) {
      this.logger.error(`Failed to create users/RBAC tables: ${err.message}`);
    }
  }

  private async syncUserRoleIdsFromCustomRoles() {
    try {
      const usersRes = await this.authQuery.query('SELECT * FROM users');
      const rolesRes = await this.authQuery.query('SELECT * FROM custom_roles');

      const ROLE_RANK: Record<string, number> = {
        SUPER_ADMIN: 100, TENANT_ADMIN: 90, BRANCH_ADMIN: 80, UNIT_ADMIN: 75,
        DELIVERY_HEAD: 70, ACCOUNT_MANAGER: 60, POD_LEAD: 50, RECRUITER: 40,
      };

      for (const user of usersRes.rows as any[]) {
        const tenantRoles = (rolesRes.rows as any[]).filter((r) => r.tenant_id === user.tenant_id);
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
        if (user.role_id && roleById[user.role_id]) resolvedRoleIds.add(user.role_id);
        if (Array.isArray(user.assigned_role_ids)) {
          user.assigned_role_ids.forEach((rid: string) => { if (roleById[rid]) resolvedRoleIds.add(rid); });
        }

        const rawBranchRoles = user.branch_roles || {};
        const normalizedBranchRoles: Record<string, string[]> = {};

        if (rawBranchRoles && typeof rawBranchRoles === 'object') {
          for (const [branchId, rList] of Object.entries(rawBranchRoles)) {
            if (Array.isArray(rList)) {
              const validBranchRoleIds: string[] = [];
              for (const item of rList as string[]) {
                if (!item) continue;
                if (roleById[item]) { validBranchRoleIds.push(item); resolvedRoleIds.add(item); }
                else {
                  const nameKey = String(item).toUpperCase().trim();
                  const matched = roleByName[nameKey] || tenantRoles.find((r) => r.name.toUpperCase().trim() === nameKey || (r.system_role && r.system_role.toUpperCase().trim() === nameKey));
                  if (matched) { validBranchRoleIds.push(matched.id); resolvedRoleIds.add(matched.id); }
                }
              }
              if (validBranchRoleIds.length > 0) {
                normalizedBranchRoles[branchId] = Array.from(new Set(validBranchRoleIds));
              }
            }
          }
        }

        if (resolvedRoleIds.size === 0) {
          const defaultRole = tenantRoles.find((r) => r.name === 'RECRUITER' || r.system_role === 'RECRUITER') || tenantRoles[0];
          if (defaultRole) resolvedRoleIds.add(defaultRole.id);
        }

        const assignedRoleObjs = Array.from(resolvedRoleIds).map((id) => roleById[id]).filter(Boolean);
        let bestRoleObj: any = null;
        let highestRank = -1;

        for (const r of assignedRoleObjs) {
          const sysKey = (r.system_role || r.name || '').toUpperCase().replace(/[\s-_]+/g, '');
          const matchedKey = Object.keys(ROLE_RANK).find(k => k.replace(/_/g, '') === sysKey) || '';
          const rank = ROLE_RANK[matchedKey] || 30;
          if (rank > highestRank) { highestRank = rank; bestRoleObj = r; }
        }

        const finalRoleId = roleById[user.role_id] ? user.role_id : (bestRoleObj?.id || Array.from(resolvedRoleIds)[0] || null);
        const finalAssignedRoleIds = Array.from(resolvedRoleIds);

        await this.authQuery.query(
          `UPDATE users SET role_id = $1, assigned_role_ids = $2::uuid[], branch_roles = $3::jsonb, updated_at = NOW() WHERE id = $4`,
          [finalRoleId, finalAssignedRoleIds, JSON.stringify(normalizedBranchRoles), user.id]
        );
      }
      this.logger.log('User role IDs and branch roles auto-synchronized with custom_roles.');
    } catch (err: any) {
      this.logger.warn(`Failed to auto-sync user role IDs: ${err.message}`);
    }
  }

  private async seedDefaultUsers() {
    const adminEmail = process.env.PLATFORM_ADMIN_EMAIL;
    const adminName = process.env.PLATFORM_ADMIN_NAME || 'Platform Super Admin';

    try {
      // 1. Ensure tenant_auth_settings exist for platform tenant
      await this.authQuery.query(`
        INSERT INTO tenant_auth_settings (tenant_id, allow_password_login, allow_microsoft_sso, allow_google_sso, enforce_sso_only)
        VALUES ('${DEFAULT_TENANT_ID}', true, true, true, false)
        ON CONFLICT (tenant_id) DO NOTHING;
      `).catch(() => {});

      // 2. Ensure Platform Super Admin exists if configured in environment
      if (adminEmail) {
        const roleMap = await this.rbacService.seedTenantRoles(DEFAULT_TENANT_ID);
        const superAdminRoleId = roleMap['SUPER_ADMIN'];

        const exists = await this.authQuery.query(
          'SELECT id, role_id, assigned_role_ids FROM users WHERE LOWER(email) = LOWER($1) LIMIT 1',
          [adminEmail]
        );

        if (exists.rows.length > 0) {
          const user: any = exists.rows[0];
          const assignedRoleIds = Array.isArray(user.assigned_role_ids) ? [...user.assigned_role_ids] : [];
          if (superAdminRoleId && !assignedRoleIds.includes(superAdminRoleId)) assignedRoleIds.push(superAdminRoleId);
          await this.authQuery.query(
            `UPDATE users SET is_approved = true, is_active = true, role_id = $1, assigned_role_ids = $2::uuid[] WHERE id = $3`,
            [superAdminRoleId, assignedRoleIds, user.id]
          );
          this.logger.log(`✅ Platform SUPER_ADMIN verified in DB (${adminEmail}).`);
        } else {
          await this.authQuery.query(
            `INSERT INTO users (id, tenant_id, email, full_name, is_active, is_approved, role_id, assigned_role_ids, keycloak_id)
             VALUES ('1d4ac532-4229-4c95-9b11-af573060020b', $1, $2, $3, true, true, $4, $5, '1d4ac532-4229-4c95-9b11-af573060020b')
             ON CONFLICT (id) DO UPDATE SET is_active = true, is_approved = true, role_id = EXCLUDED.role_id`,
            [DEFAULT_TENANT_ID, adminEmail, adminName, superAdminRoleId, [superAdminRoleId]]
          );
          this.logger.log(`🚀 Platform SUPER_ADMIN created: ${adminEmail}`);
        }
      }
    } catch (err: any) {
      this.logger.error(`Could not seed default users: ${err.message}`, err.stack);
    }
  }
}
