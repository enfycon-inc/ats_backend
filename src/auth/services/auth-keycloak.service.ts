import { Injectable, Logger } from '@nestjs/common';
import { AuthQueryService } from './auth-query.service';

const DEFAULT_TENANT_ID = process.env.DEFAULT_TENANT_ID as string;

/**
 * AuthKeycloakService — manages all Keycloak Admin REST API interactions:
 * - Provisioning new users
 * - Syncing user attributes from JWT claims to PostgreSQL
 * - Deleting users from Keycloak on account removal
 */
@Injectable()
export class AuthKeycloakService {
  private readonly logger = new Logger(AuthKeycloakService.name);
  private lastIdentityProviderError: string | null = null;

  constructor(private readonly authQuery: AuthQueryService) {}

  /** Returns the base URL for Keycloak admin API calls — prefers KEYCLOAK_INTERNAL_URL (Docker-internal) */
  private getKeycloakAdminBaseUrl(): string {
    // If an explicit internal URL is set (e.g. http://ats_keycloak_dev:8080), use it
    if (process.env.KEYCLOAK_INTERNAL_URL) {
      return process.env.KEYCLOAK_INTERNAL_URL;
    }
    // Fall back: derive from KEYCLOAK_ISSUER, swapping localhost <-> keycloak hostname
    const issuer = process.env.KEYCLOAK_ISSUER || 'http://localhost:8080/realms/enfycon-ats';
    const baseUrl = issuer.split('/realms/')[0];
    if (baseUrl.includes('localhost')) return baseUrl.replace('localhost', 'keycloak');
    if (baseUrl.includes('keycloak')) return baseUrl;
    // External URL (e.g. auth.enfyjobs.com) — try internal hostname
    return 'http://ats_keycloak_dev:8080';
  }

  async getKeycloakAdminToken(): Promise<string | null> {
    const adminBaseUrl = this.getKeycloakAdminBaseUrl();
    const adminUser = process.env.KEYCLOAK_ADMIN;
    const adminPass = process.env.KEYCLOAK_ADMIN_PASSWORD;
    if (!adminUser || !adminPass) {
      this.logger.warn('KEYCLOAK_ADMIN or KEYCLOAK_ADMIN_PASSWORD is not configured in environment');
      return null;
    }

    const tokenEndpoint = `${adminBaseUrl}/realms/master/protocol/openid-connect/token`;
    try {
      const params = new URLSearchParams();
      params.append('grant_type', 'password');
      params.append('client_id', 'admin-cli');
      params.append('username', adminUser);
      params.append('password', adminPass);

      const res = await fetch(tokenEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params.toString(),
      });
      if (res.ok) {
        const data = await res.json();
        this.logger.debug(`[Keycloak] Admin token obtained from ${adminBaseUrl}`);
        return data.access_token;
      }
      const detail = (await res.text().catch(() => '')).replace(/\s+/g, ' ').slice(0, 240);
      this.logger.warn(`[Keycloak] Admin token request failed (${res.status}) at ${tokenEndpoint}${detail ? `: ${detail}` : ''}`);
    } catch (err: any) {
      this.logger.warn(`[Keycloak] Could not reach admin token endpoint at ${tokenEndpoint}: ${err.message}`);
    }
    return null;
  }


  async configureTenantIdentityProvider(
    tenantId: string,
    clientId: string,
    clientSecret: string,
    microsoftTenantId?: string | null,
  ): Promise<string | null> {
    this.lastIdentityProviderError = null;
    try {
      const normalizedClientSecret = String(clientSecret || '').trim();
      if (!normalizedClientSecret || /^[*•]+$/.test(normalizedClientSecret)) {
        throw new Error('A real Microsoft client secret is required; a masked placeholder was supplied');
      }

      const adminToken = await this.getKeycloakAdminToken();
      if (!adminToken) throw new Error('Failed to get Keycloak admin token');

      const issuer = process.env.KEYCLOAK_ISSUER || 'http://localhost:8080/realms/enfycon-ats';
      const realm = issuer.split('/realms/')[1] || 'enfycon-ats';
      const adminBaseUrl = this.getKeycloakAdminBaseUrl();

      const idpAlias = `microsoft-${tenantId}`;
      const idpUrl = `${adminBaseUrl}/admin/realms/${realm}/identity-provider/instances`;

      // 1. Check if it already exists
      const checkRes = await fetch(`${idpUrl}/${idpAlias}`, {
        headers: { 'Authorization': `Bearer ${adminToken}` }
      });
      if (!checkRes.ok && checkRes.status !== 404) {
        throw new Error(`Failed to inspect existing IdP (${checkRes.status})`);
      }

      const normalizedMicrosoftTenantId = (microsoftTenantId || '').trim();
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(normalizedMicrosoftTenantId)) {
        throw new Error('A valid Microsoft Entra Directory (Tenant) ID is required');
      }
      const payload = {
        alias: idpAlias,
        providerId: 'microsoft',
        enabled: true,
        updateProfileFirstLoginMode: 'on',
        trustEmail: true,
        storeToken: false,
        addReadTokenRoleOnCreate: false,
        authenticateByDefault: false,
        linkOnly: false,
        firstBrokerLoginFlowAlias: 'first broker login',
        config: {
          clientId: clientId,
          clientSecret: normalizedClientSecret,
          // Keycloak uses /common when this property is absent. A tenant-specific
          // endpoint is required for single-tenant Entra applications.
          ...(normalizedMicrosoftTenantId ? { tenantId: normalizedMicrosoftTenantId } : {}),
          defaultScope: 'openid email profile',
          guiOrder: '1',
          syncMode: 'IMPORT'
        }
      };

      if (checkRes.ok) {
        // Update existing IdP
        const updateRes = await fetch(`${idpUrl}/${idpAlias}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminToken}` },
          body: JSON.stringify(payload)
        });
        if (!updateRes.ok) throw new Error(`Failed to update IdP: ${await updateRes.text()}`);
      } else {
        // Create new IdP
        const createRes = await fetch(idpUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminToken}` },
          body: JSON.stringify(payload)
        });
        if (!createRes.ok) throw new Error(`Failed to create IdP: ${await createRes.text()}`);
      }

      await this.ensureIdentityProviderClaimMapper(adminToken, realm);

      this.logger.log(`Successfully configured Keycloak Identity Provider: ${idpAlias}`);
      // Return the generated redirect URI for the tenant to paste into Azure
      // Use the public-facing KEYCLOAK_ISSUER base (not the internal Docker URL)
      const issuerBase = (process.env.KEYCLOAK_ISSUER || 'http://localhost:8080/realms/enfycon-ats').split('/realms/')[0];
      return `${issuerBase}/realms/${realm}/broker/${idpAlias}/endpoint`;
    } catch (err: any) {
      this.lastIdentityProviderError = String(err?.message || 'Unknown Keycloak synchronization error').replace(/\s+/g, ' ').slice(0, 500);
      this.logger.error(`Failed to configure tenant IdP in Keycloak: ${this.lastIdentityProviderError}`);
      return null;
    }
  }

  getLastIdentityProviderError(): string | null {
    return this.lastIdentityProviderError;
  }

  /**
   * Returns only the trusted, persisted Microsoft IdP metadata for a tenant.
   * This is used after a broker token has been introspected; it never returns
   * client credentials to callers.
   */
  async getTenantMicrosoftIdentityProvider(tenantId: string): Promise<{
    enabled: boolean;
    providerId: string;
    tenantId: string | null;
  } | null> {
    try {
      const adminToken = await this.getKeycloakAdminToken();
      if (!adminToken) return null;
      const issuer = process.env.KEYCLOAK_ISSUER || 'http://localhost:8080/realms/enfycon-ats';
      const realm = issuer.split('/realms/')[1] || 'enfycon-ats';
      const alias = `microsoft-${tenantId}`;
      const response = await fetch(
        `${this.getKeycloakAdminBaseUrl()}/admin/realms/${realm}/identity-provider/instances/${encodeURIComponent(alias)}`,
        { headers: { Authorization: `Bearer ${adminToken}` } },
      );
      if (!response.ok) return null;
      const provider: any = await response.json();
      return {
        enabled: provider.enabled === true,
        providerId: typeof provider.providerId === 'string' ? provider.providerId : '',
        tenantId: typeof provider.config?.tenantId === 'string' ? provider.config.tenantId : null,
      };
    } catch (err: any) {
      this.logger.warn(`[Keycloak] Could not read Microsoft IdP metadata: ${err.message}`);
      return null;
    }
  }

  /** Ensure the broker alias is carried in the client access token. */
  private async ensureIdentityProviderClaimMapper(adminToken: string, realm: string): Promise<void> {
    const base = this.getKeycloakAdminBaseUrl();
    const clientsResponse = await fetch(
      `${base}/admin/realms/${realm}/clients?clientId=${encodeURIComponent(process.env.KEYCLOAK_CLIENT_ID || 'enfycon-ats')}`,
      { headers: { Authorization: `Bearer ${adminToken}` } },
    );
    if (!clientsResponse.ok) throw new Error(`Unable to find Keycloak client (${clientsResponse.status})`);
    const clients: any[] = await clientsResponse.json();
    const client = clients.find((entry) => entry.clientId === (process.env.KEYCLOAK_CLIENT_ID || 'enfycon-ats'));
    if (!client?.id) throw new Error('Keycloak client was not found');

    const mapper = {
      name: 'identity-provider',
      protocol: 'openid-connect',
      protocolMapper: 'oidc-usersessionmodel-note-mapper',
      config: {
        'user.session.note': 'identity_provider',
        'claim.name': 'identity_provider',
        'jsonType.label': 'String',
        'id.token.claim': 'true',
        'access.token.claim': 'true',
        'userinfo.token.claim': 'true',
      },
    };
    const mapperUrl = `${base}/admin/realms/${realm}/clients/${encodeURIComponent(client.id)}/protocol-mappers/models`;
    const existingResponse = await fetch(mapperUrl, { headers: { Authorization: `Bearer ${adminToken}` } });
    if (!existingResponse.ok) throw new Error(`Unable to read Keycloak protocol mappers (${existingResponse.status})`);
    const existing: any[] = await existingResponse.json();
    const current = existing.find((entry) => entry.name === mapper.name);
    if (current?.id) {
      // The mapper already exists, no need to update it.
      return;
    }
    const createResponse = await fetch(mapperUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify(mapper),
    });
    if (!createResponse.ok) throw new Error(`Unable to create Keycloak identity provider mapper (${createResponse.status})`);
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
      const adminBaseUrl = this.getKeycloakAdminBaseUrl();

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

      const usersUrl = `${adminBaseUrl}/admin/realms/${realm}/users`;
      const targetEndpoints = [ usersUrl ];

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
    tenantId?: string;
  }) {
    this.logger.debug(`Syncing Keycloak user: ${data.email}`);

    const normalizedRoles = data.roles
      .map((r) => r.toUpperCase().replace(/[\s-]/g, '_'))
      .filter((r) => r.length > 0);

    let existing: any;
    if (data.tenantId) {
      existing = await this.authQuery.query(
        'SELECT id, tenant_id, is_active, is_approved, requested_role, role_id, assigned_role_ids, first_name, last_name, full_name, branch_id, pod_id, business_unit_id FROM users WHERE tenant_id = $3::uuid AND (keycloak_id = $1 OR LOWER(TRIM(email)) = LOWER(TRIM($2))) LIMIT 1',
        [data.keycloakId, data.email, data.tenantId],
      );
    } else {
      existing = await this.authQuery.query(
        'SELECT id, tenant_id, is_active, is_approved, requested_role, role_id, assigned_role_ids, first_name, last_name, full_name, branch_id, pod_id, business_unit_id FROM users WHERE keycloak_id = $1 OR LOWER(TRIM(email)) = LOWER(TRIM($2)) ORDER BY (tenant_id <> $3::uuid) DESC LIMIT 1',
        [data.keycloakId, data.email, DEFAULT_TENANT_ID],
      );
    }

    let tenantId = data.tenantId || (existing.rows.length > 0
      ? (existing.rows[0] as any).tenant_id
      : DEFAULT_TENANT_ID);

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
         RETURNING id, email, first_name, last_name, full_name, tenant_id, is_active, is_approved, requested_role, role_id, assigned_role_ids, branch_id, pod_id, business_unit_id, updated_at`,
        [data.keycloakId, firstName, lastName, fullName, roleId, assignedRoleIds, existingUser.id],
      );
      dbUser = updateRes.rows[0];
    } else {
      const insertRes = await this.authQuery.query(
        `INSERT INTO users (keycloak_id, tenant_id, email, first_name, last_name, full_name, is_active, is_approved, role_id, assigned_role_ids)
         VALUES ($1, $2, $3, $4, $5, $6, true, false, $7::uuid, $8::uuid[])
         RETURNING id, email, first_name, last_name, full_name, tenant_id, is_active, is_approved, requested_role, role_id, assigned_role_ids, branch_id, pod_id, business_unit_id, updated_at`,
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
      : (dynamicRoles.find((r) => ['SUPER_ADMIN', 'TENANT_ADMIN', 'BRANCH_ADMIN', 'UNIT_ADMIN', 'DELIVERY_HEAD', 'ACCOUNT_MANAGER', 'POD_LEAD', 'RECRUITER'].includes(r)) || 'RECRUITER');

    const uniqueRoles = Array.from(new Set(dynamicRoles));
    return { ...dbUser, is_approved: dbUser.is_approved !== false, requested_role: dbUser.requested_role || null, roles: uniqueRoles, permissions, system_role: primarySystemRole };
  }

  async setKeycloakUserStatus(email: string, enabled: boolean): Promise<boolean> {
    try {
      const adminToken = await this.getKeycloakAdminToken();
      if (!adminToken) return false;
      const issuer = process.env.KEYCLOAK_ISSUER || 'http://localhost:8080/realms/enfycon-ats';
      const realm = issuer.split('/realms/')[1] || 'enfycon-ats';
      const baseUrl = this.getKeycloakAdminBaseUrl();
      const usersUrl = `${baseUrl}/admin/realms/${realm}/users`;
      const searchUrl = `${usersUrl}?email=${encodeURIComponent(email)}&exact=true`;
      const searchRes = await fetch(searchUrl, { headers: { Authorization: `Bearer ${adminToken}` } });
      const usersList = searchRes.ok ? await searchRes.json() : [];
      if (Array.isArray(usersList) && usersList.length > 0) {
        const kcUserId = usersList[0].id;
        const updateUrl = `${usersUrl}/${kcUserId}`;
        const updateRes = await fetch(updateUrl, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
          body: JSON.stringify({ enabled }),
        });
        return updateRes.ok;
      }
      return false;
    } catch (e: any) {
      this.logger.warn(`Failed to update Keycloak status for ${email}: ${e.message}`);
      return false;
    }
  }

  async deleteKeycloakUser(email: string): Promise<boolean> {
    try {
      const adminToken = await this.getKeycloakAdminToken();
      if (!adminToken) return false;

      const issuer = process.env.KEYCLOAK_ISSUER || 'http://localhost:8080/realms/enfycon-ats';
      const realm = issuer.split('/realms/')[1] || 'enfycon-ats';
      const baseUrl = this.getKeycloakAdminBaseUrl();

      const targetEndpoints = [
        `${baseUrl}/admin/realms/${realm}/users`,
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
