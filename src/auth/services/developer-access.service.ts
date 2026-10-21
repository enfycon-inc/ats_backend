import { BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common';
import { AuthQueryService } from './auth-query.service';

@Injectable()
export class DeveloperAccessService {
  constructor(private readonly db: AuthQueryService) {}

  async authorize(email: string, workspace?: string) {
    if (typeof email !== 'string' || !workspace || !/^[a-z0-9.-]+$/i.test(workspace)) this.deny();
    const result = await this.db.query(`SELECT u.id, u.tenant_id, g.id AS grant_id
      FROM ats.users u
      JOIN ats.developer_login_grants g ON g.user_id = u.id AND g.tenant_id = u.tenant_id
      JOIN ats.tenant_auth_settings p ON p.tenant_id = u.tenant_id AND p.allow_developer_login
      JOIN ats.tenants t ON t.id = u.tenant_id AND t.status = 'ACTIVE'
      WHERE lower(trim(u.email)) = $1 AND u.is_active AND u.is_approved
      AND (lower(t.domain) = $2 OR EXISTS (SELECT 1 FROM ats.tenant_domains d WHERE d.tenant_id = t.id AND lower(d.domain_name) = $2))`,
      [email.trim().toLowerCase(), workspace!.toLowerCase()]);
    if (result.rows.length !== 1) this.deny();
    return result.rows[0] as { id: string; tenant_id: string; grant_id: string };
  }

  async registerSession(grant: { id: string; tenant_id: string; grant_id: string }, claims: { sub?: string; sid?: string; session_state?: string }) {
    const sid = claims?.sid || claims?.session_state;
    if (!claims?.sub || !sid) this.deny();
    // Locks serialize issuance against both policy disable and grant removal.
    await this.db.prisma.$transaction(async tx => {
      const rows = await tx.$queryRawUnsafe<any[]>(`SELECT g.id, p.developer_login_epoch FROM ats.developer_login_grants g
        JOIN ats.tenant_auth_settings p ON p.tenant_id = g.tenant_id
        WHERE g.id = $1::uuid AND g.user_id = $2::uuid AND g.tenant_id = $3::uuid
        AND p.allow_developer_login AND NOT p.require_mfa FOR SHARE OF g, p`, grant.grant_id, grant.id, grant.tenant_id);
      if (!rows.length) this.deny();
      await tx.$executeRawUnsafe(`INSERT INTO ats.developer_login_sessions (keycloak_id, session_id, grant_id, tenant_id, policy_epoch)
        VALUES ($1,$2,$3::uuid,$4::uuid,$5::uuid)`, claims.sub, sid, grant.grant_id, grant.tenant_id, rows[0].developer_login_epoch);
    });
  }

  async list(tenantId: string, search = '') {
    const rows = await this.db.query(`SELECT u.id, u.email, u.full_name AS "fullName", (g.id IS NOT NULL) AS authorized
      FROM ats.users u LEFT JOIN ats.developer_login_grants g ON g.user_id = u.id AND g.tenant_id = u.tenant_id
      WHERE u.tenant_id = $1::uuid AND u.is_active AND u.is_approved
      AND (u.email ILIKE $2 OR u.full_name ILIKE $2) ORDER BY (g.id IS NOT NULL) DESC, u.email LIMIT 50`,
      [tenantId, `%${search.slice(0, 100)}%`]);
    return rows.rows;
  }

  async setGrant(tenantId: string, userId: string, actorId: string, authorized: boolean) {
    if (typeof authorized !== 'boolean') throw new BadRequestException('Authorized must be a boolean.');
    if (authorized) {
      const result = await this.db.query(`INSERT INTO ats.developer_login_grants (id,tenant_id,user_id,granted_by)
        SELECT gen_random_uuid(),tenant_id,id,$3::uuid FROM ats.users
        WHERE tenant_id=$1::uuid AND id=$2::uuid AND is_active AND is_approved
        ON CONFLICT (tenant_id,user_id) DO UPDATE SET user_id=EXCLUDED.user_id RETURNING id`, [tenantId,userId,actorId]);
      if (!result.rows.length) throw new BadRequestException('Select an active workspace account.');
    } else {
      await this.db.query('DELETE FROM ats.developer_login_grants WHERE tenant_id=$1::uuid AND user_id=$2::uuid', [tenantId,userId]);
    }
    return { success: true };
  }

  private deny(): never { throw new UnauthorizedException('Developer sign-in is unavailable or credentials are invalid.'); }
}
