import { Injectable, Logger } from '@nestjs/common';
import { AuthQueryService } from './auth-query.service';

const DEFAULT_TENANT_ID = process.env.DEFAULT_TENANT_ID || 'd3b07384-d113-49c3-a555-9ee75c13ca33';

/**
 * AuthKeycloakService — manages all Keycloak Admin REST API interactions:
 * - Provisioning new users
 * - Syncing user attributes from JWT claims to PostgreSQL
 * - Deleting users from Keycloak on account removal
 */
@Injectable()
export class AuthKeycloakService {
  private readonly logger = new Logger(AuthKeycloakService.name);

  constructor(private readonly authQuery: AuthQueryService) {}

  async getKeycloakAdminToken(): Promise<string | null> {
    const issuer = process.env.KEYCLOAK_ISSUER || 'http://localhost:8080/realms/enfycon-ats';
    const baseUrl = issuer.split('/realms/')[0];
    const adminUser = process.env.KEYCLOAK_ADMIN;
    const adminPass = process.env.KEYCLOAK_ADMIN_PASSWORD;
    if (!adminUser || !adminPass) {
      this.logger.warn('KEYCLOAK_ADMIN or KEYCLOAK_ADMIN_PASSWORD is not configured in environment');
      return null;
    }

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
          { type: 'password', value: data.password, temporary: false },
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
            // User already exists — sync password if provided
            if (data.password) {
              let searchUrl = url.replace('/users', `/users?username=${encodeURIComponent(data.email)}&exact=true`);
              let searchRes = await fetch(searchUrl, {
                headers: { 'Authorization': `Bearer ${adminToken}` },
              });
              let usersList = searchRes.ok ? await searchRes.json() : [];
              if (!Array.isArray(usersList) || usersList.length === 0) {
                searchUrl = url.replace('/users', `/users?email=${encodeURIComponent(data.email)}&exact=true`);
                searchRes = await fetch(searchUrl, {
                  headers: { 'Authorization': `Bearer ${adminToken}` },
                });
                usersList = searchRes.ok ? await searchRes.json() : [];
              }

              if (Array.isArray(usersList) && usersList.length > 0) {
                const kcUserId = usersList[0].id;
                const resetUrl = url.replace('/users', `/users/${kcUserId}/reset-password`);
                await fetch(resetUrl, {
                  method: 'PUT',
                  headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${adminToken}`,
                  },
                  body: JSON.stringify({ type: 'password', value: data.password, temporary: false }),
                });
                this.logger.log(`Keycloak user ${data.email} password synced in realm ${realm}`);
              }
            }
            return true;
          } else {
            const errBody = await res.text().catch(() => '');
            this.logger.warn(`Keycloak provision returned ${res.status} for ${url}: ${errBody}`);
          }
        } catch (err: any) {
          this.logger.warn(`Keycloak provision request failed for ${url}: ${err.message}`);
        }
      }
      return false;
    } catch (err: any) {
      this.logger.error(`Failed to provision user ${data.email} in Keycloak: ${err.message}`);
      return false;
    }
  }

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

    const existing = await this.authQuery.query(
      'SELECT id, tenant_id, is_active, role_id, assigned_role_ids, first_name, last_name, full_name, branch_id, pod_id, business_unit_id FROM users WHERE keycloak_id = $1 OR email = $2 LIMIT 1',
      [data.keycloakId, data.email],
    );

    let tenantId = existing.rows.length > 0
      ? (existing.rows[0] as any).tenant_id
      : DEFAULT_TENANT_ID;

    let roleId = existing.rows.length > 0 ? (existing.rows[0] as any).role_id : null;
    const existingAssigned: string[] = existing.rows.length > 0 && Array.isArray((existing.rows[0] as any).assigned_role_ids)
      ? (existing.rows[0] as any).assigned_role_ids
      : (roleId ? [roleId] : []);

    let dynamicRoles: string[] = [];
    // Token role names may bootstrap a new identity, but cannot restore revoked local assignments.
    if (existing.rows.length === 0 && normalizedRoles.length > 0) {
      const roleResult = await this.authQuery.query(
        'SELECT cr.id, cr.name, sr.system_key as system_role FROM custom_roles cr LEFT JOIN system_roles sr ON cr.system_role_id = sr.id WHERE cr.tenant_id = $1 AND (UPPER(cr.name) = ANY($2) OR UPPER(sr.system_key) = ANY($2))',
        [tenantId, normalizedRoles]
      );
      if (roleResult.rows.length > 0) {
        if (!roleId) roleId = (roleResult.rows[0] as any).id;
        roleResult.rows.forEach((r: any) => {
          if (r.name) dynamicRoles.push(r.name);
          if (r.system_role) dynamicRoles.push(r.system_role);
        });
      }
    }

    const allRoleIds = Array.from(new Set([roleId, ...existingAssigned])).filter(Boolean);
    if (allRoleIds.length > 0) {
      const dbRolesRes = await this.authQuery.query(
        'SELECT cr.id, cr.name, sr.system_key as system_role FROM custom_roles cr LEFT JOIN system_roles sr ON cr.system_role_id = sr.id WHERE cr.id = ANY($1::uuid[]) AND cr.tenant_id = $2',
        [allRoleIds, tenantId]
      );
      dbRolesRes.rows.forEach((r: any) => {
        if (r.name) dynamicRoles.push(r.name);
        if (r.system_role) dynamicRoles.push(r.system_role);
      });
    }

    if (existing.rows.length === 0 && dynamicRoles.length === 0 && normalizedRoles.length > 0) {
      dynamicRoles = normalizedRoles;
    }

    const firstName = data.fullName ? data.fullName.trim().split(/\s+/)[0] : '';
    const lastName = data.fullName ? data.fullName.trim().split(/\s+/).slice(1).join(' ') : '';
    const fullName = data.fullName ? data.fullName.trim() : `${firstName} ${lastName}`.trim();
    const assignedRoleIds = allRoleIds.length > 0 ? allRoleIds : (roleId ? [roleId] : []);

    let dbUser: any;
    if (existing.rows.length > 0) {
      const existingUser: any = existing.rows[0];
      const updateRes = await this.authQuery.query(
        `UPDATE users
         SET keycloak_id = $1,
             first_name  = COALESCE(NULLIF($2, ''), first_name),
             last_name   = COALESCE(NULLIF($3, ''), last_name),
             full_name   = COALESCE($4, full_name),
             role_id     = COALESCE(users.role_id, $5::uuid),
             assigned_role_ids = CASE WHEN cardinality(assigned_role_ids) = 0 THEN $6::uuid[] ELSE assigned_role_ids END,
             updated_at  = NOW()
         WHERE id = $7
         RETURNING id, email, first_name, last_name, full_name, tenant_id, is_active, role_id, assigned_role_ids, branch_id, pod_id, business_unit_id, updated_at`,
        [data.keycloakId, firstName, lastName, fullName, roleId, assignedRoleIds, existingUser.id],
      );
      dbUser = updateRes.rows[0];
    } else {
      const insertRes = await this.authQuery.query(
        `INSERT INTO users (keycloak_id, tenant_id, email, first_name, last_name, full_name, is_active, is_approved, role_id, assigned_role_ids)
         VALUES ($1, $2, $3, $4, $5, $6, true, true, $7::uuid, $8::uuid[])
         RETURNING id, email, first_name, last_name, full_name, tenant_id, is_active, role_id, assigned_role_ids, branch_id, pod_id, business_unit_id, updated_at`,
        [data.keycloakId, tenantId, data.email, firstName, lastName, fullName, roleId, assignedRoleIds],
      );
      dbUser = insertRes.rows[0];
    }

    let permissions: string[] = [];
    const effectiveRoleIds = Array.from(new Set([dbUser.role_id, ...(dbUser.assigned_role_ids || [])])).filter(Boolean);
      const permsRes = await this.authQuery.query(
        `SELECT cr.permissions 
         FROM custom_roles cr
         WHERE cr.tenant_id = $1 AND cr.id = ANY($2::uuid[])`,
        [dbUser.tenant_id || DEFAULT_TENANT_ID, effectiveRoleIds]
      );
      
      const permSet = new Set<string>();
      for (const row of permsRes.rows as any[]) {
        const pList = typeof row.permissions === 'string' ? JSON.parse(row.permissions) : (row.permissions || []);
        pList.forEach((p: string) => permSet.add(p));
      }
      permissions = Array.from(permSet);

    const primarySystemRole = (allRoleIds.length > 0 && typeof (this as any).prisma !== 'undefined')
      ? undefined
      : (dynamicRoles.find((r) => ['SUPER_ADMIN', 'ADMIN', 'BRANCH_ADMIN', 'POD_LEAD', 'RECRUITER', 'DELIVERY_HEAD', 'ACCOUNT_MANAGER'].includes(r)) || 'RECRUITER');

    const uniqueRoles = Array.from(new Set(dynamicRoles));
    return { ...dbUser, roles: uniqueRoles, permissions, system_role: primarySystemRole };
  }

  async deleteKeycloakUser(email: string): Promise<boolean> {
    try {
      const adminToken = await this.getKeycloakAdminToken();
      if (!adminToken) return false;

      const issuer = process.env.KEYCLOAK_ISSUER || 'http://localhost:8080/realms/enfycon-ats';
      const realm = issuer.split('/realms/')[1] || 'enfycon-ats';
      const baseUrl = issuer.split('/realms/')[0];

      const targetEndpoints = [
        `${baseUrl}/admin/realms/${realm}/users`,
        `${baseUrl.includes('localhost') ? baseUrl.replace('localhost', 'keycloak') : baseUrl.replace('keycloak', 'localhost')}/admin/realms/${realm}/users`,
      ];

      for (const url of targetEndpoints) {
        try {
          const searchUrl = `${url}?email=${encodeURIComponent(email)}`;
          const searchRes = await fetch(searchUrl, {
            headers: { Authorization: `Bearer ${adminToken}` },
          });
          if (searchRes.ok) {
            const usersList = await searchRes.json();
            if (Array.isArray(usersList) && usersList.length > 0) {
              const kcUserId = usersList[0].id;
              const deleteUrl = `${url}/${kcUserId}`;
              const delRes = await fetch(deleteUrl, {
                method: 'DELETE',
                headers: { Authorization: `Bearer ${adminToken}` },
              });
              if (delRes.ok) {
                this.logger.log(`Keycloak user ${email} deleted from realm ${realm}`);
                return true;
              }
            }
          }
        } catch (err) {}
      }
      return false;
    } catch (e: any) {
      this.logger.warn(`Could not delete Keycloak user ${email}: ${e.message}`);
      return false;
    }
  }
}
