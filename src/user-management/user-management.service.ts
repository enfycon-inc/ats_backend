import { BadRequestException, ForbiddenException, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { AuthUser } from '../auth/interfaces/auth-user.interface';
import { hasCapability, managementScope, requireCapability } from './management-policy';
import { SessionTrackingService } from './session-tracking.service';
import type { DirectoryPage, SecurityEventItem, SessionItem, UserView } from './user-management.contract';
import { assertMemberAction, memberPermissionProjection } from '../auth/utils/user-management-access';
import { OfficeLocationService } from './office-location.service';
import { userManagementActions } from '../auth/user-management-policy';

@Injectable()
export class UserManagementService {
  constructor(private readonly db: PrismaService, private readonly tracking: SessionTrackingService, @Optional() private readonly office?: OfficeLocationService) {}
  async list(actor: AuthUser, query: Record<string, string>): Promise<DirectoryPage> {
    const state = query.state || 'active';
    if (!['active', 'pending', 'blocked', 'activity'].includes(state)) throw new BadRequestException('Invalid user view.');
    if (state === 'activity') {
      if (!['user:presence:view', 'user:sessions:view', 'user:login_logs:view'].some(key => hasCapability(actor, key))) requireCapability(actor, 'user:presence:view');
    } else if (!hasCapability(actor, 'user:manage')) requireCapability(actor, 'user:view');
    const page = this.integer(query.page, 1, 1, 100000);
    const size = this.integer(query.pageSize, 25, 1, 100);
    const search = String(query.search || '').trim().slice(0, 150);
    const scope = managementScope(actor);
    // Unaccepted invitations with an existing member are represented by that member, not counted twice.
    const invitationScope = managementScope(actor, 'i');
    let inviteSql = invitationScope.sql;
    if (!actor.permissions?.some(p => ['*', 'platform:manage', 'tenant:settings', 'tenant:manage', 'branch_admin:manage'].includes(p))) {
      inviteSql = 'i.tenant_id=$1::uuid AND i.created_by=$2::uuid';
      invitationScope.values = [actor.tenantId, actor.dbId];
    }
    const counts = await this.db.$queryRawUnsafe<any[]>(`SELECT
      COUNT(*) FILTER (WHERE u.is_approved=true AND u.is_active=true)::int AS active,
      COUNT(*) FILTER (WHERE u.is_approved=false AND u.requested_role IS NOT NULL)::int AS pending,
      COUNT(*) FILTER (WHERE u.is_approved=true AND u.is_active=false)::int AS blocked
      FROM ats.users u WHERE ${scope.sql}`, ...scope.values);
    const invited = await this.db.$queryRawUnsafe<any[]>(`SELECT COUNT(*)::int AS count FROM ats.user_invitations i
      WHERE ${inviteSql} AND i.is_accepted=false AND i.token_expires_at>NOW() AND NOT EXISTS
      (SELECT 1 FROM ats.users u WHERE u.tenant_id=i.tenant_id AND LOWER(u.email)=LOWER(i.email))`, ...invitationScope.values);
    const values = [...scope.values];
    const searchParam = `$${values.push('%' + search.replace(/[\\%_]/g, '\\$&') + '%')}`;
    const conditions: Record<UserView, string> = {
      active: 'u.is_approved=true AND u.is_active=true', blocked: 'u.is_approved=true AND u.is_active=false',
      pending: 'u.is_approved=false AND u.requested_role IS NOT NULL', activity: 'true',
    };
    const base = `SELECT u.id,'user'::text AS kind,u.full_name AS "fullName",u.email,u.profile_picture AS avatar,
      to_jsonb(u)->>'city' AS city,rev.full_name AS "managerName",
      COALESCE(assigned_roles.names,ARRAY_REMOVE(ARRAY[r.name],NULL)) AS "assignedRoles",
      ARRAY_REMOVE(ARRAY[u.role_id] || u.assigned_role_ids,NULL) AS "assignedRoleIds",u.job_reviewer_id AS "jobReviewerId",
      u.branch_id AS "branchId",u.business_unit_id AS "businessUnitId",b.name AS "branchName",bu.name AS "businessUnitName",r.name AS "roleName",
      u.is_active AS "isActive",u.is_approved AS "isApproved",u.requested_role AS "requestedRole",
      u.last_login_at AS "lastLoginAt",u.created_at AS "createdAt",
      (SELECT CASE WHEN i.token_expires_at<NOW() THEN 'expired' ELSE 'invited' END FROM ats.user_invitations i WHERE i.tenant_id=u.tenant_id AND LOWER(i.email)=LOWER(u.email) AND i.is_accepted=false LIMIT 1) AS "invitationStatus",
      u.tenant_id AS "__tenantId",u.branch_id AS "__branchId",u.business_unit_id AS "__unitId",${memberPermissionProjection('u')}
      FROM ats.users u LEFT JOIN ats.branches b ON b.id=u.branch_id
      LEFT JOIN ats.business_units bu ON bu.id=u.business_unit_id
      LEFT JOIN ats.custom_roles r ON r.id=u.role_id
      LEFT JOIN ats.users rev ON rev.id=u.job_reviewer_id AND rev.tenant_id=u.tenant_id
      LEFT JOIN LATERAL (
        SELECT ARRAY_AGG(DISTINCT cr.name ORDER BY cr.name) AS names FROM ats.custom_roles cr
        WHERE cr.id=ANY(ARRAY_REMOVE(ARRAY[u.role_id] || u.assigned_role_ids,NULL)) AND cr.tenant_id=u.tenant_id
      ) assigned_roles ON TRUE
      WHERE ${scope.sql} AND (${conditions[state as UserView]})
      AND (u.full_name ILIKE ${searchParam} OR u.email ILIKE ${searchParam})`;
    let combined = base;
    if (state === 'pending') {
      const shift = values.length;
      const shiftedScope = inviteSql.replace(/\$(\d+)/g, (_, n) => `$${Number(n) + shift}`);
      values.push(...invitationScope.values);
      combined += ` UNION ALL SELECT i.id,'invitation',COALESCE(i.full_name,i.email),i.email,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,b.name,NULL,r.name,
        false,false,NULL,NULL,i.created_at,CASE WHEN i.token_expires_at<NOW() THEN 'expired' ELSE 'invited' END,i.tenant_id,i.branch_id,NULL::uuid,ARRAY[]::text[]
        FROM ats.user_invitations i LEFT JOIN ats.branches b ON b.id=i.branch_id LEFT JOIN ats.custom_roles r ON r.id=i.role_id
      WHERE ${shiftedScope} AND i.is_accepted=false AND i.token_expires_at>NOW() AND (i.full_name ILIKE ${searchParam} OR i.email ILIKE ${searchParam})
        AND NOT EXISTS(SELECT 1 FROM ats.users u WHERE u.tenant_id=i.tenant_id AND LOWER(u.email)=LOWER(i.email))`;
    }
    const totalRows = await this.db.$queryRawUnsafe<any[]>(`SELECT COUNT(*)::int AS count FROM (${combined}) matches`, ...values);
    const limit = `$${values.length + 1}`, offset = `$${values.length + 2}`;
    const rows = await this.db.$queryRawUnsafe<any[]>(`SELECT * FROM (${combined}) matches ORDER BY "fullName",id LIMIT ${limit} OFFSET ${offset}`, ...values, size, (page - 1) * size);
    if (this.tracking.enabled) {
      const ids = rows.filter(row => row.kind === 'user').map(row => row.id);
      const presence = hasCapability(actor, 'user:presence:view') ? await this.tracking.presences(actor.tenantId, ids) : new Map();
      const summaries = ids.length ? await this.db.$queryRawUnsafe<any[]>(`SELECT m.user_id,
        COUNT(*) FILTER(WHERE m.revoked_at IS NULL AND s.expires_at>NOW())::int AS sessions,MAX(m.last_seen_at) AS last_seen
        FROM ats.session_memberships m JOIN ats.application_sessions s ON s.id=m.session_id
        WHERE m.tenant_id=$1::uuid AND m.user_id=ANY($2::uuid[]) GROUP BY m.user_id`, actor.tenantId, ids) : [];
      const byId = new Map(summaries.map(row => [row.user_id, row]));
      for (const row of rows) {
        if (hasCapability(actor, 'user:presence:view')) { row.presence = presence.get(row.id) || 'unknown'; row.lastSeenAt = byId.get(row.id)?.last_seen || null; }
        if (hasCapability(actor, 'user:sessions:view')) row.sessions = byId.get(row.id)?.sessions || 0;
      }
      if (state === 'blocked' && ids.length) {
        const decisions = await this.db.$queryRawUnsafe<any[]>(`SELECT DISTINCT ON (user_id) user_id,reason FROM ats.user_access_decisions WHERE tenant_id=$1::uuid AND user_id=ANY($2::uuid[]) ORDER BY user_id,created_at DESC`, actor.tenantId, ids);
        const reasons = new Map(decisions.map(item => [item.user_id, item.reason]));
        rows.forEach(row => { row.blockReason = reasons.get(row.id) || null; });
      }
      if (this.office?.enabled && hasCapability(actor, 'user:location:view')) {
        const evidence = new Map((await this.office.networks(actor.tenantId, ids)).map(item => [item.user_id, item]));
        for (const row of rows) {
          const item = evidence.get(row.id);
          row.officeNetwork = item ? `${item.label}${item.branch_name ? ' · ' + item.branch_name : ''}` : 'Unknown network';
          row.officeObservedAt = item?.observed_at || null;
        }
      }
    }
    if (!hasCapability(actor, 'user:login_logs:view')) rows.forEach(row => { row.lastLoginAt = null; });
    for (const row of rows) {
      const actions = userManagementActions(actor, { id: row.id, tenantId: row.__tenantId, branchId: row.__branchId, businessUnitId: row.__unitId, permissions: row.management_permissions || [] });
        row.allowedActions = { edit: row.kind === 'user' && actions.editProfile,
        changeAccess: row.kind === 'user' && row.isApproved && actions.changeStatus,
        review: row.kind === 'user' && !!row.requestedRole && actions.reviewRequest,
          resendInvitation: row.kind === 'user' && !!row.invitationStatus && row.isActive && actions.editProfile,
          assignManager: row.kind === 'user' && actions.assignManager,
          resetPassword: row.kind === 'user' && actions.resetPassword,
          endSessions: row.kind === 'user' && actions.endSessions,
          deleteUser: row.kind === 'user' && actions.deleteUser };
      delete row.__tenantId; delete row.__branchId; delete row.__unitId; delete row.management_permissions;
    }
    return { items: rows, total: totalRows[0].count, page, pageSize: size,
      counts: { ...counts[0], pending: counts[0].pending + invited[0].count },
      asOf: new Date().toISOString(), telemetryEnabled: this.tracking.enabled };
  }
  private integer(raw: string | undefined, fallback: number, min: number, max: number) {
    if (raw === undefined) return fallback;
    const value = Number(raw);
    if (!Number.isInteger(value) || value < min || value > max) throw new BadRequestException('Invalid pagination.');
    return value;
  }
  async target(actor: AuthUser, id: string) {
    const scope = managementScope(actor, 'u', 2);
    const rows = await this.db.$queryRawUnsafe<any[]>(`SELECT u.id FROM ats.users u WHERE u.id=$1::uuid AND ${scope.sql}`, id, ...scope.values);
    if (!rows[0]) throw new NotFoundException('User not found in your authorised scope.');
  }
  async sessions(actor: AuthUser, userId: string, page = 1): Promise<SessionItem[]> {
    const self = actor.dbId === userId;
    if (!self) { requireCapability(actor, 'user:sessions:view'); await this.target(actor, userId); }
    if (!this.tracking.enabled) return [];
    const ipAllowed = self || hasCapability(actor, 'user:session_ip:view');
    const rows = await this.db.$queryRawUnsafe<any[]>(`SELECT m.id,s.device,s.login_method AS "loginMethod",s.started_at AS "startedAt",
      m.last_seen_at AS "lastSeenAt",s.expires_at AS "expiresAt",m.revoked_at AS "revokedAt"
      ${ipAllowed ? ', host(n.ip_address) AS "ipAddress"' : ''}
      FROM ats.session_memberships m JOIN ats.application_sessions s ON s.id=m.session_id
      LEFT JOIN LATERAL (SELECT ip_address FROM ats.session_network_observations WHERE membership_id=m.id ORDER BY observed_at DESC LIMIT 1) n ON true
      WHERE m.user_id=$1::uuid AND m.tenant_id=$2::uuid ORDER BY s.started_at DESC,m.id LIMIT 50 OFFSET $3`, userId, actor.tenantId, (page - 1) * 50);
    await this.auditRead(actor, userId, 'sessions.viewed');
    return rows.map(row => ({ ...row, current: row.id === (actor as any).sessionMembershipId }));
  }
  async events(actor: AuthUser, userId: string, page = 1): Promise<SecurityEventItem[]> {
    const self = actor.dbId === userId;
    if (!self) { requireCapability(actor, 'user:login_logs:view'); await this.target(actor, userId); }
    if (!this.tracking.enabled) return [];
    const ipAllowed = self || hasCapability(actor, 'user:session_ip:view');
    await this.auditRead(actor, userId, 'login_history.viewed');
    return this.db.$queryRawUnsafe<any[]>(`SELECT e.id,e.action,e.outcome,e.created_at AS "createdAt",a.full_name AS "actorName"
      ${ipAllowed ? ',host(e.ip_address) AS "ipAddress"' : ''}
      FROM ats.user_security_events e LEFT JOIN ats.users a ON a.id=e.actor_id AND a.tenant_id=e.tenant_id
      WHERE e.tenant_id=$1::uuid AND e.user_id=$2::uuid ${self ? "AND e.outcome='success'" : ''}
      ORDER BY e.created_at DESC,e.id LIMIT 50 OFFSET $3`, actor.tenantId, userId, (page - 1) * 50);
  }
  async revoke(actor: AuthUser, id: string) {
    if (!this.tracking.enabled) throw new BadRequestException('Session monitoring is not enabled.');
    const rows = await this.db.$queryRawUnsafe<any[]>('SELECT user_id FROM ats.session_memberships WHERE id=$1::uuid AND tenant_id=$2::uuid', id, actor.tenantId);
    if (!rows[0]) throw new NotFoundException('Session not found.');
    if (actor.dbId !== rows[0].user_id) {
      requireCapability(actor, 'user:sessions:revoke'); await this.target(actor, rows[0].user_id);
      const target = await this.db.$queryRawUnsafe<any[]>(`SELECT u.id,u.tenant_id,u.branch_id,u.business_unit_id,${memberPermissionProjection('u')} FROM ats.users u WHERE u.id=$1::uuid AND u.tenant_id=$2::uuid`, rows[0].user_id, actor.tenantId);
      if (!target[0]) throw new NotFoundException('User not found.');
      // Explicit revoke capability authorises the operation; shared policy still
      // enforces protected-account and management scope restrictions.
      assertMemberAction({ ...actor, permissions: [...(actor.permissions || []), 'user:manage'] }, target[0], 'endSessions');
    }
    await this.db.$transaction(async tx => {
      const changed = await tx.$executeRawUnsafe('UPDATE ats.session_memberships SET revoked_at=NOW(),revoked_by=$3::uuid WHERE id=$1::uuid AND tenant_id=$2::uuid AND revoked_at IS NULL', id, actor.tenantId, actor.dbId);
      if (changed) await tx.$executeRawUnsafe(`INSERT INTO ats.user_security_events(tenant_id,user_id,actor_id,membership_id,action,outcome)
        VALUES($1::uuid,$2::uuid,$3::uuid,$4::uuid,'session.revoked','success')`, actor.tenantId, rows[0].user_id, actor.dbId, id);
      if (changed) await tx.$executeRawUnsafe(`INSERT INTO ats.user_security_outbox(room,event,payload) VALUES($1,'session_revoked',$2::jsonb)`, `user:${actor.tenantId}:${rows[0].user_id}`, JSON.stringify({ membershipId: id }));
    });
    await this.tracking.publish('session_revoked', { membershipId: id }, `user:${actor.tenantId}:${rows[0].user_id}`).catch(() => {});
    return { success: true, message: 'Workspace session ended. Other workspaces are unaffected.' };
  }
  async exportEvents(actor: AuthUser, userId: string, from?: string, to?: string): Promise<SecurityEventItem[]> {
    requireCapability(actor, 'user:login_logs:view');
    requireCapability(actor, 'user:login_logs:export');
    await this.target(actor, userId);
    if (!this.tracking.enabled) return [];
    const end = to ? new Date(to) : new Date();
    const start = from ? new Date(from) : new Date(end.getTime() - 7 * 86400000);
    if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || start >= end || end.getTime() - start.getTime() > 31 * 86400000) throw new BadRequestException('Choose a valid date range of up to 31 days.');
    const rows = await this.db.$queryRawUnsafe<any[]>(`SELECT e.id,e.action,e.outcome,e.created_at AS "createdAt",a.full_name AS "actorName"
      ${hasCapability(actor, 'user:session_ip:view') ? ',host(e.ip_address) AS "ipAddress"' : ''}
      FROM ats.user_security_events e LEFT JOIN ats.users a ON a.id=e.actor_id AND a.tenant_id=e.tenant_id
      WHERE e.tenant_id=$1::uuid AND e.user_id=$2::uuid AND e.created_at>=$3 AND e.created_at<=$4
      ORDER BY e.created_at DESC,e.id LIMIT 10001`, actor.tenantId, userId, start, end);
    if (rows.length > 10000) throw new BadRequestException('Choose a shorter date range to export all matching events.');
    await this.auditRead(actor, userId, 'login_history.exported');
    return rows;
  }
  private async auditRead(actor: AuthUser, targetId: string, action: string) {
    await this.db.$executeRawUnsafe(`INSERT INTO ats.user_security_events(tenant_id,user_id,actor_id,action,outcome)
      VALUES($1::uuid,$2::uuid,$3::uuid,$4,'success')`, actor.tenantId, targetId, actor.dbId, action);
  }
}
