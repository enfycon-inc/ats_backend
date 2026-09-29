
import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  ConflictException,
} from '@nestjs/common';
import { AuthQueryService } from './auth-query.service';
import { AuthRbacService } from './auth-rbac.service';
import { AuthKeycloakService } from './auth-keycloak.service';
import type { AuthUser } from '../interfaces/auth-user.interface';
import { validateBranchAccess } from '../utils/branch-scoping';

const DEFAULT_TENANT_ID = process.env.DEFAULT_TENANT_ID || 'd3b07384-d113-49c3-a555-9ee75c13ca33';

/**
 * AuthUserService — manages user profiles, listings, updates, deactivation, and deletion.
 */
@Injectable()
export class AuthUserService {
  private readonly logger = new Logger(AuthUserService.name);

  constructor(
    private readonly authQuery: AuthQueryService,
    private readonly rbacService: AuthRbacService,
    private readonly keycloakService: AuthKeycloakService,
  ) {}

  async getProfile(userId: string) {
    const result = await this.authQuery.query(
      `SELECT u.id, u.email, u.first_name, u.last_name, u.full_name, u.tenant_id, u.is_active, u.is_approved, u.requested_role, u.created_at, u.updated_at,
              u.role_id, u.assigned_role_ids, u.pod_id, u.branch_id,
              u.business_unit_id, u.job_reviewer_id, rev.full_name as job_reviewer_name,
              t.name as tenant_name, t.default_market, t.domain as tenant_domain, t.user_limit as user_limit,
              t.pod_system_enabled, t.candidate_pool_mode, t.job_assignment_mode, t.job_assignment_options,
              t.site_title, t.logo_url,
              b.name as branch_name, bu.name as business_unit_name,
              b.city as branch_city, COALESCE(bu.timezone, b.timezone) as office_timezone,
              COALESCE(bu.work_start_time, b.work_start_time) as office_start_time,
              COALESCE(bu.work_end_time, b.work_end_time) as office_end_time
       FROM users u
       LEFT JOIN tenants t ON u.tenant_id = t.id
       LEFT JOIN branches b ON u.branch_id = b.id
       LEFT JOIN business_units bu ON u.business_unit_id = bu.id
       LEFT JOIN users rev ON u.job_reviewer_id = rev.id
       WHERE u.id = $1 LIMIT 1`,
      [userId],
    );
    if (result.rows.length === 0) throw new NotFoundException('User profile not found.');
    const u: any = result.rows[0];

    const rolesRes = await this.authQuery.query(
      `SELECT cr.id, cr.name, cr.is_system, cr.branch_id, sr.system_key as system_role, cr.base_role_id FROM custom_roles cr LEFT JOIN system_roles sr ON cr.system_role_id = sr.id WHERE cr.tenant_id = $1`,
      [u.tenant_id]
    );

    const roleById: Record<string, any> = {};
    const roleByName: Record<string, any> = {};
    for (const r of rolesRes.rows as any[]) {
      roleById[r.id] = r;
      roleByName[r.name.toUpperCase()] = r;
      if (r.system_role) roleByName[r.system_role.toUpperCase()] = r;
    }

    const rolePermsRes = await this.authQuery.query(
      `SELECT cr.id as role_id, cr.permissions FROM custom_roles cr WHERE cr.tenant_id = $1`,
      [u.tenant_id]
    );

    const rolePermMap: Record<string, Set<string>> = {};
    for (const row of rolePermsRes.rows as any[]) {
      if (!rolePermMap[row.role_id]) rolePermMap[row.role_id] = new Set();
      const pList = typeof row.permissions === 'string' ? JSON.parse(row.permissions) : (row.permissions || []);
      for (const p of pList) {
        rolePermMap[row.role_id].add(p);
      }
    }

    const userRoleIds = new Set<string>();
    if (u.role_id) userRoleIds.add(u.role_id);
    if (Array.isArray(u.assigned_role_ids)) u.assigned_role_ids.forEach((rid: string) => userRoleIds.add(rid));

    const userPerms = new Set<string>();
    userRoleIds.forEach((rId) => { if (rolePermMap[rId]) rolePermMap[rId].forEach((p) => userPerms.add(p)); });
    const canReview = userPerms.has('submission:internal_screening') || userPerms.has('job:approve') || userPerms.has('job:reject') || userPerms.has('job:publish_direct');

    const assignedRoleObjs: any[] = [];
    userRoleIds.forEach((rId) => { if (roleById[rId]) assignedRoleObjs.push(roleById[rId]); });

    const bestRoleObj = assignedRoleObjs.find(role => role.id === u.role_id) || assignedRoleObjs[0];
    const roleName = bestRoleObj?.name || (u.role_id ? roleById[u.role_id]?.name : null) || 'RECRUITER';
    const systemRole = bestRoleObj?.system_role || (u.role_id ? roleById[u.role_id]?.system_role : null) || 'RECRUITER';
    const baseRoleId = bestRoleObj?.base_role_id || (u.role_id ? roleById[u.role_id]?.base_role_id : null) || null;

    const cleanRoles = this.deduplicateRoles(assignedRoleObjs);
    // Assigned dashboard perspectives must not depend on the branch-filtered role-management catalog.
    // Keep exact IDs even when multiple branches use the same role display name.
    const assignedRoles = assignedRoleObjs.map(role => ({
      id: role.id,
      name: role.name,
      systemRole: role.system_role,
      isSystem: role.is_system === true,
      branchId: role.branch_id || null,
      baseRoleId: role.base_role_id || null,
      permissions: Array.from(rolePermMap[role.id] || []),
    }));

    return {
      id: u.id, email: u.email, firstName: u.first_name || '', lastName: u.last_name || '', fullName: u.full_name,
      roles: cleanRoles.length > 0 ? cleanRoles : [roleName],
      roleId: bestRoleObj?.id || u.role_id, assignedRoleIds: Array.from(userRoleIds), assignedRoles,
      roleName, systemRole, baseRoleId, permissions: Array.from(userPerms), canReview,
      tenantId: u.tenant_id, isActive: u.is_active, isApproved: u.is_approved, requestedRole: u.requested_role, createdAt: u.created_at,
      defaultMarket: u.default_market || 'US', tenantDomain: u.tenant_domain || '',
      userLimit: u.user_limit || 5, podId: u.pod_id, branchId: u.branch_id,
      branchName: u.branch_name || null,
      branchCity: u.branch_city || null, officeTimezone: u.office_timezone || null,
      officeStartTime: u.office_start_time || null, officeEndTime: u.office_end_time || null,
      businessUnitId: u.business_unit_id, businessUnitName: u.business_unit_name || null,
      jobReviewerId: u.job_reviewer_id || null, jobReviewerName: u.job_reviewer_name || null,
      podSystemEnabled: u.pod_system_enabled !== false,
      candidatePoolMode: u.candidate_pool_mode || 'COMBINED_MARKET',
      jobAssignmentMode: u.job_assignment_mode || 'AUTO',
      jobAssignmentOptions: u.job_assignment_options || { allowAuto: true, allowAll: true, allowUnassigned: true, allowedPodIds: [] },
      tenant: { name: u.tenant_name || '', domain: u.tenant_domain || '', siteTitle: u.site_title || '', logoUrl: u.logo_url || '' },
    };
  }

  async listUsers(tenantId: string, scopedBranchId?: string | string[] | null, scopedBusinessUnitId?: string | null) {
    let branchFilter = '';
    let queryParams: any[] = [tenantId];

    if (scopedBranchId) {
      if (Array.isArray(scopedBranchId) && scopedBranchId.length > 0) {
        queryParams.push(scopedBranchId);
        branchFilter += ` AND u.branch_id = ANY($${queryParams.length}::uuid[])`;
      } else if (typeof scopedBranchId === 'string') {
        queryParams.push(scopedBranchId);
        branchFilter += ` AND u.branch_id = $${queryParams.length}`;
      }
    }
    
    if (scopedBusinessUnitId) {
      queryParams.push(scopedBusinessUnitId);
      branchFilter += ` AND u.business_unit_id = $${queryParams.length}`;
    }

    const result = await this.authQuery.query(
      `SELECT u.id, u.email, u.first_name, u.last_name, u.full_name, u.is_active, u.is_approved, u.created_at, u.requested_role,
              u.role_id, u.assigned_role_ids, u.pod_id, u.branch_id,
              u.business_unit_id, u.job_reviewer_id,
              rev.full_name as job_reviewer_name,
                r.name as role_name, sr.system_key as system_role, r.base_role_id as base_role_id,
                b.name as branch_name, bu.name as business_unit_name
         FROM users u 
         LEFT JOIN custom_roles r ON u.role_id = r.id
         LEFT JOIN system_roles sr ON r.system_role_id = sr.id
       LEFT JOIN branches b ON u.branch_id = b.id
       LEFT JOIN business_units bu ON u.business_unit_id = bu.id
       LEFT JOIN users rev ON u.job_reviewer_id = rev.id
       WHERE u.tenant_id = $1 ${branchFilter} ORDER BY u.full_name ASC`,
      queryParams,
    );

    const rolesRes = await this.authQuery.query(
      `SELECT cr.id, cr.name, cr.is_system, sr.system_key as system_role, cr.base_role_id FROM custom_roles cr LEFT JOIN system_roles sr ON cr.system_role_id = sr.id WHERE cr.tenant_id = $1`,
      [tenantId]
    );
    const roleById: Record<string, any> = {};
    const roleByName: Record<string, any> = {};
    for (const r of rolesRes.rows as any[]) {
      roleById[r.id] = r;
      roleByName[r.name.toUpperCase()] = r;
      if (r.system_role) roleByName[r.system_role.toUpperCase()] = r;
    }

    const rolePermsRes = await this.authQuery.query(
      `SELECT cr.id as role_id, cr.permissions FROM custom_roles cr WHERE cr.tenant_id = $1`,
      [tenantId]
    ).catch(() => ({ rows: [] }));
    const rolePermMap: Record<string, Set<string>> = {};
    for (const row of rolePermsRes.rows as any[]) {
      if (!rolePermMap[row.role_id]) rolePermMap[row.role_id] = new Set();
      const pList = typeof row.permissions === 'string' ? JSON.parse(row.permissions) : (row.permissions || []);
      for (const p of pList) {
        rolePermMap[row.role_id].add(p);
      }
    }

    return (result.rows as any[]).map((u) => {
      const userRoleIds = new Set<string>();
      if (u.role_id) userRoleIds.add(u.role_id);
      if (Array.isArray(u.assigned_role_ids)) u.assigned_role_ids.forEach((rid: string) => userRoleIds.add(rid));

      const userPerms = new Set<string>();
      userRoleIds.forEach((rId) => { if (rolePermMap[rId]) rolePermMap[rId].forEach((p) => userPerms.add(p)); });
      const canReview = userPerms.has('submission:internal_screening') || userPerms.has('job:approve') || userPerms.has('job:reject') || userPerms.has('job:publish_direct');

      const assignedRoleObjs: any[] = [];
      userRoleIds.forEach((rId) => { if (roleById[rId]) assignedRoleObjs.push(roleById[rId]); });

      const bestRoleObj = assignedRoleObjs.find(role => role.id === u.role_id) || assignedRoleObjs[0];
      const primaryRole = bestRoleObj?.name || u.role_name || 'RECRUITER';
      const systemRole = bestRoleObj?.system_role || u.system_role || 'RECRUITER';
      const baseRoleId = bestRoleObj?.base_role_id || u.base_role_id || null;
      const cleanRoles = this.deduplicateRoles(assignedRoleObjs);

      return {
        id: u.id, email: u.email, firstName: u.first_name || '', lastName: u.last_name || '', fullName: u.full_name,
        roles: cleanRoles.length > 0 ? cleanRoles : [primaryRole],
        roleId: bestRoleObj?.id || u.role_id, assignedRoleIds: Array.from(userRoleIds),
        roleName: primaryRole, systemRole, baseRoleId, isActive: u.is_active, isApproved: u.is_approved, requestedRole: u.requested_role, createdAt: u.created_at,
        podId: u.pod_id, branchId: u.branch_id,
        branchName: u.branch_name || null, businessUnitId: u.business_unit_id, businessUnitName: u.business_unit_name || null,
        jobReviewerId: u.job_reviewer_id || null, jobReviewerName: u.job_reviewer_name || null,
        permissions: Array.from(userPerms), canReview,
      };
    });
  }

  async setUserActive(userId: string, isActive: boolean, requesterId: string, requester?: AuthUser) {
    if (userId === requesterId) {
      if (!isActive) throw new BadRequestException('You cannot deactivate your own account.');
    }
    const userRes = await this.authQuery.query('SELECT email, tenant_id, is_active, is_approved, branch_id FROM users WHERE id = $1 LIMIT 1', [userId]);
    if (userRes.rows.length === 0) throw new NotFoundException('User not found.');
    const user: any = userRes.rows[0];

    // Branch isolation: branch admins can only change status of users in their assigned branches
    if (requester && user.branch_id) {
      validateBranchAccess(requester, user.branch_id, 'change user status');
    }

    const perms: string[] = Array.isArray(requester?.permissions) ? requester.permissions : [];
    const isTenantAdmin = perms.includes('tenant:settings') || perms.includes('tenant:manage') || perms.includes('platform:manage');
    if (!isTenantAdmin && (requester as any).businessUnitId) {
      if (user.business_unit_id && user.business_unit_id !== (requester as any).businessUnitId) {
        throw new ForbiddenException('Access denied. This user belongs to a different Business Unit.');
      }
    }

    if (isActive) {
      if (!user.is_active || !user.is_approved) await this.rbacService.checkSeatLimit(user.tenant_id);
    } else {
      await this.rbacService.verifyLastAdminProtection(user.tenant_id, userId, 'deactivate');
    }

    await this.authQuery.query(`UPDATE users SET is_active = $1, is_approved = true, updated_at = NOW() WHERE id = $2`, [isActive, userId]);
    this.keycloakService.setKeycloakUserStatus(user.email, isActive).catch(() => {});
    return { message: `User ${isActive ? 'activated' : 'deactivated'} successfully.` };
  }

  async deleteUser(userId: string, requester: any) {
    if (userId === requester.dbId || userId === requester.keycloakId) throw new BadRequestException('You cannot delete your own account.');

    const userRes = await this.authQuery.query('SELECT id, email, tenant_id, full_name, is_active, branch_id FROM users WHERE id = $1 LIMIT 1', [userId]);
    if (userRes.rows.length === 0) throw new NotFoundException('User not found.');
    const targetUser: any = userRes.rows[0];

    const requesterRoles = requester.roles || [];
    if (!requesterRoles.includes('SUPER_ADMIN') && targetUser.tenant_id !== requester.tenantId) {
      throw new ForbiddenException('You are not authorized to delete users in another company tenant.');
    }

    // Branch isolation: branch admins can only delete users in their assigned branches
    if (requester.dbId && targetUser.branch_id) {
      // requester may be a full AuthUser if passed properly; do branch check if permissions indicate branch admin
      const perms: string[] = Array.isArray(requester.permissions) ? requester.permissions : [];
      if (perms.includes('branch_admin:manage') && !perms.includes('tenant:settings')) {
        validateBranchAccess(requester as AuthUser, targetUser.branch_id, 'delete users');
      }
    }

    await this.rbacService.verifyLastAdminProtection(targetUser.tenant_id, userId, 'delete');

    await this.authQuery.query('UPDATE users SET job_reviewer_id = NULL WHERE job_reviewer_id = $1', [userId]).catch(() => {});
    await this.authQuery.query('UPDATE branches SET manager_id = NULL WHERE manager_id = $1', [userId]).catch(() => {});
    await this.authQuery.query('UPDATE pods SET pod_head_id = NULL WHERE pod_head_id = $1', [userId]).catch(() => {});
    await this.authQuery.query('DELETE FROM user_invitations WHERE LOWER(email) = LOWER($1) AND tenant_id = $2', [targetUser.email, targetUser.tenant_id]).catch(() => {});
    await this.authQuery.query('DELETE FROM users WHERE id = $1', [userId]);

    this.keycloakService.deleteKeycloakUser(targetUser.email).catch((err: any) => {
      this.logger.warn(`Keycloak delete error note for ${targetUser.email}: ${err.message}`);
    });

    return { success: true, message: `User ${targetUser.full_name} (${targetUser.email}) has been permanently deleted.` };
  }

  async updateUserRoles(userId: string, roles: string[], requesterRoles: string[]) {
    const normalized = roles.map((r) => r.toUpperCase());

    const userRes = await this.authQuery.query(
      `SELECT u.tenant_id, u.role_id, u.assigned_role_ids, cr.name as role_name, sr.system_key as system_role
       FROM users u
       LEFT JOIN custom_roles cr ON cr.id = u.role_id
       LEFT JOIN system_roles sr ON cr.system_role_id = sr.id
       WHERE u.id = $1 LIMIT 1`,
      [userId]
    );
    if (userRes.rows.length === 0) throw new NotFoundException('User not found.');
    const targetUser: any = userRes.rows[0];
    const isTargetSuperAdmin = targetUser.system_role === 'SUPER_ADMIN' || targetUser.role_name === 'SUPER_ADMIN';
    const tenantId = targetUser.tenant_id;

    if (isTargetSuperAdmin && (!requesterRoles || !requesterRoles.includes('SUPER_ADMIN'))) {
      throw new ForbiddenException('You are not authorized to modify roles of a SUPER_ADMIN.');
    }
    if (normalized.includes('SUPER_ADMIN') && (!requesterRoles || !requesterRoles.includes('SUPER_ADMIN'))) {
      throw new ForbiddenException('You are not authorized to assign the SUPER_ADMIN role.');
    }

    const isNewAdmin = normalized.includes('TENANT_ADMIN');
    if (!isNewAdmin) await this.rbacService.verifyLastAdminProtection(tenantId, userId, 'demote');

    const customRolesRes = await this.authQuery.query(
      `SELECT cr.id, cr.name FROM custom_roles cr
         LEFT JOIN system_roles sr ON cr.system_role_id = sr.id
         WHERE cr.tenant_id = ::uuid
           AND (::text IS NULL OR cr.branch_id IS NULL OR cr.branch_id = ::uuid)
           AND (
             (CASE WHEN  ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN cr.id = ::uuid ELSE false END)
             OR UPPER(cr.name) = UPPER()
             OR UPPER(COALESCE(sr.system_key, '')) = UPPER()
             
           )
         ORDER BY (cr.is_system = false) DESC, cr.created_at DESC`,
      [tenantId, normalized]
    );
    const roleIds: string[] = (customRolesRes.rows as any[]).map((r) => r.id);
    const cleanRoleNames: string[] = Array.from(new Set((customRolesRes.rows as any[]).map((r) => r.name)));
    const roleId = roleIds[0] || null;

    await this.authQuery.query(
      `UPDATE users SET role_id = $1, assigned_role_ids = $2::uuid[], updated_at = NOW() WHERE id = $3`,
      [roleId, roleIds, userId],
    );
    return { message: 'User roles updated successfully.', roles: cleanRoleNames.length > 0 ? cleanRoleNames : normalized };
  }

  async updateUserDetails(
    userId: string,
    dto: { firstName?: string; lastName?: string; fullName?: string; email?: string; password?: string; roleId?: string; assignedRoleIds?: string[]; branchId?: string; businessUnitId?: string; roles?: string[]; jobReviewerId?: string | null },
    requester: any
  ) {
    const userRes = await this.authQuery.query('SELECT * FROM users WHERE id = $1 LIMIT 1', [userId]);
    if (userRes.rows.length === 0) throw new NotFoundException('User not found.');
    const user: any = userRes.rows[0];

    if (!requester.roles?.includes('SUPER_ADMIN') && user.tenant_id !== requester.tenantId) {
      throw new ForbiddenException('You are not authorized to update users in another company tenant.');
    }

    // Branch isolation: branch admins can only update users in their assigned branches
    if (user.branch_id) {
      const perms: string[] = Array.isArray(requester.permissions) ? requester.permissions : [];
      if (perms.includes('branch_admin:manage') && !perms.includes('tenant:settings')) {
        validateBranchAccess(requester as AuthUser, user.branch_id, 'update users');
        // Also prevent reassigning user to a branch the requester doesn't own
        if (dto.branchId && dto.branchId !== user.branch_id) {
          validateBranchAccess(requester as AuthUser, dto.branchId, 'move users to branch');
        }
      }
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
      const dup = await this.authQuery.query('SELECT id FROM users WHERE email = $1 AND id <> $2 LIMIT 1', [cleanEmail, userId]);
      if (dup.rows.length > 0) throw new ConflictException(`Email ${cleanEmail} is already registered to another user.`);
      email = cleanEmail;
    }

    if (dto.branchId !== undefined) branchId = dto.branchId || null;
    if (dto.businessUnitId !== undefined) businessUnitId = dto.businessUnitId || null;
    if (dto.jobReviewerId !== undefined) jobReviewerId = dto.jobReviewerId && dto.jobReviewerId.trim().length > 0 ? dto.jobReviewerId.trim() : null;

    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    const rawRoleIdentifiers = new Set<string>();

    // Did the request provide explicit role-related fields?
    const hasRoleUpdates = dto.roleId !== undefined || dto.roles !== undefined || dto.assignedRoleIds !== undefined;

    if (hasRoleUpdates) {
      // A submitted selection replaces the old assignment. Legacy hints must not append removed roles.
      const selection = dto.assignedRoleIds ?? dto.roles ?? (dto.roleId ? [dto.roleId] : []);
      if (!Array.isArray(selection) || selection.some(r => typeof r !== 'string' || !r.trim())) {
        throw new BadRequestException('Roles must be a list of role IDs.');
      }
      selection.forEach(r => rawRoleIdentifiers.add(r.trim()));
    }

    const combinedRoleIds = new Set<string>();
    let retainsTenantAdministration = false;
    
    if (hasRoleUpdates) {
      // Resolve all provided role identifiers to exact DB UUIDs
      if (rawRoleIdentifiers.size > 0) {
        const rawList = Array.from(rawRoleIdentifiers);
        const matchedRolesRes = await this.authQuery.query(
          `SELECT cr.id, cr.name, cr.branch_id, cr.permissions, sr.system_key as system_role
           FROM custom_roles cr LEFT JOIN system_roles sr ON cr.system_role_id = sr.id
           WHERE cr.tenant_id = $1 AND (cr.branch_id IS NULL OR cr.branch_id = $4::uuid)
             AND (LOWER(cr.id::text) = ANY($2::text[]) OR UPPER(cr.name) = ANY($3::text[]) OR UPPER(sr.system_key) = ANY($3::text[]))`,
          [user.tenant_id, rawList.map(r => r.toLowerCase()), rawList.map(r => r.toUpperCase()), branchId]
        );
        const available = matchedRolesRes.rows as any[];
        for (const identifier of rawList) {
          const key = identifier.toUpperCase();
          const exact = available.filter(r => r.id.toUpperCase() === key);
          const named = available.filter(r => r.name.toUpperCase() === key);
          const matches = exact.length ? exact : named.length ? named : available.filter(r => r.system_role?.toUpperCase() === key);
          if (matches.length !== 1) {
            throw new BadRequestException('Select an exact role from this member\'s branch. A selected role is missing or ambiguous.');
          }
          const selected = matches[0];
          const requesterPermissions: string[] = requester.permissions || [];
          const selectedPermissions: string[] = typeof selected.permissions === 'string' ? JSON.parse(selected.permissions) : selected.permissions || [];
          if (selectedPermissions.some(p => ['tenant:settings', 'tenant:manage', 'platform:manage'].includes(p))) {
            retainsTenantAdministration = true;
          }
          if (selectedPermissions.includes('platform:manage') && !requesterPermissions.includes('platform:manage')) {
            throw new ForbiddenException('You cannot assign platform administration permissions.');
          }
          if (selectedPermissions.some(p => p === 'tenant:settings' || p === 'tenant:manage') &&
              !requesterPermissions.some(p => ['tenant:settings', 'tenant:manage', 'platform:manage'].includes(p))) {
            throw new ForbiddenException('You cannot assign tenant administration permissions.');
          }
          combinedRoleIds.add(selected.id);
        }
      }
      if (dto.roleId && !Array.from(combinedRoleIds).some(id => id.toLowerCase() === dto.roleId!.toLowerCase())) {
        throw new BadRequestException('The primary role must be one of the selected roles.');
      }
      if (!retainsTenantAdministration) await this.rbacService.verifyLastAdminProtection(user.tenant_id, userId, 'demote');
    } else {
      // No role updates requested, carry over existing roles
      if (user.role_id && uuidRegex.test(user.role_id)) combinedRoleIds.add(user.role_id);
      if (Array.isArray(user.assigned_role_ids)) {
        user.assigned_role_ids.forEach((rid: string) => { if (rid && uuidRegex.test(rid)) combinedRoleIds.add(rid); });
      }
    }

    let primaryRoleId: string | null = null;
    if (hasRoleUpdates && dto.roleId) primaryRoleId = Array.from(combinedRoleIds).find(id => id.toLowerCase() === dto.roleId!.toLowerCase())!;
    else if (user.role_id && combinedRoleIds.has(user.role_id)) primaryRoleId = user.role_id;
    else if (combinedRoleIds.size > 0) primaryRoleId = Array.from(combinedRoleIds)[0];
    else if (!hasRoleUpdates && user.role_id && uuidRegex.test(user.role_id)) primaryRoleId = user.role_id;

    await this.authQuery.query(
      `UPDATE users SET first_name = $1, last_name = $2, full_name = $3, email = $4, branch_id = $5, business_unit_id = $6, job_reviewer_id = $7, role_id = $8, assigned_role_ids = $9::uuid[], updated_at = NOW() WHERE id = $10 AND tenant_id = $11`,
      [firstName, lastName, fullName, email, branchId, businessUnitId, jobReviewerId, primaryRoleId, Array.from(combinedRoleIds), userId, user.tenant_id]
    );

    if (dto.password && dto.password.length >= 8) {
      this.keycloakService.provisionUserInKeycloak({ email, password: dto.password, fullName, tenantId: user.tenant_id }).catch((err: any) => {
        this.logger.warn(`Keycloak password update note: ${err.message}`);
      });
    }

    return this.getProfile(userId);
  }

    async requestRole(userId: string, role: string, branchId?: string, businessUnitId?: string) {
      const userRes = await this.authQuery.query(
        'SELECT id, email, full_name, tenant_id FROM users WHERE id = $1 LIMIT 1',
        [userId]
      );
      if (userRes.rows.length === 0) throw new NotFoundException('User not found.');

      await this.authQuery.query(
        'UPDATE users SET requested_role = $1, branch_id = $2::uuid, business_unit_id = $3::uuid, updated_at = NOW() WHERE id = $4::uuid',
        [role, branchId || null, businessUnitId || null, userId]
      );

      try {
        const adminsRes = await this.authQuery.query(
          "SELECT u.id FROM users u INNER JOIN custom_roles cr ON u.role_id = cr.id INNER JOIN system_roles sr ON cr.system_role_id = sr.id WHERE u.tenant_id = $1 AND sr.system_key IN ('TENANT_ADMIN', 'SUPER_ADMIN') AND u.is_active = true",
          [userRes.rows[0].tenant_id]
        );
        if (adminsRes.rows.length > 0) {
          const title = 'New Role Request';
          const msg = userRes.rows[0].email + ' requested the ' + role.replace(/_/g, ' ') + ' role.';
          for (const admin of adminsRes.rows) {
            await this.authQuery.query(
              "INSERT INTO notifications (tenant_id, user_id, type, title, message, data, is_read, initiator_id, created_at) VALUES ($1, $2, 'ROLE_REQUEST', $3, $4, '{}'::jsonb, false, $5, NOW())",
              [userRes.rows[0].tenant_id, admin.id, title, msg, userId]
            );
          }
        }
      } catch (err) {}

      return { success: true, message: 'Role request submitted for approval.' };
    }

async approveTenantUser(
    userId: string,
    dto: { roleId?: string; roleIds?: string[]; branchId?: string; businessUnitId?: string; roles?: string[] },
    requester: AuthUser
  ) {
    const userRes = await this.authQuery.query(
      'SELECT id, email, full_name, tenant_id, branch_id, business_unit_id, requested_role, is_approved, is_active FROM users WHERE id = $1 LIMIT 1',
      [userId]
    );
    if (userRes.rows.length === 0) throw new NotFoundException('User not found.');
    const targetUser: any = userRes.rows[0];

    // Multitenancy validation
    if (!requester.roles?.includes('SUPER_ADMIN') && targetUser.tenant_id !== requester.tenantId) {
      throw new ForbiddenException('You are not authorized to approve users in another tenant.');
    }

    // Branch Admin validation
    const perms: string[] = Array.isArray(requester.permissions) ? requester.permissions : [];
    const isTenantAdmin = perms.includes('tenant:settings') || perms.includes('tenant:manage') || perms.includes('platform:manage');
    if (!isTenantAdmin && targetUser.branch_id) {
      validateBranchAccess(requester, targetUser.branch_id, 'approve users');
    }

    // Check seat limit
    if (!targetUser.is_active || !targetUser.is_approved) {
      await this.rbacService.checkSeatLimit(targetUser.tenant_id);
    }

    const branchId = dto.branchId !== undefined ? (dto.branchId || null) : (targetUser.branch_id || (requester as any).branchId || null);
    const businessUnitId = dto.businessUnitId !== undefined ? (dto.businessUnitId || null) : (targetUser.business_unit_id || (requester as any).businessUnitId || null);

    if (!isTenantAdmin && (requester as any).businessUnitId) {
      if (businessUnitId && businessUnitId !== (requester as any).businessUnitId) {
        throw new ForbiddenException('Access denied. You can only approve or assign users to your own Business Unit.');
      }
      if (targetUser.business_unit_id && targetUser.business_unit_id !== (requester as any).businessUnitId) {
        throw new ForbiddenException('Access denied. This user belongs to a different Business Unit.');
      }
    }

    const isUuid = (val: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(val);

        let targetRoleIdentifier = dto.roleId || (dto.roles && dto.roles[0]) || targetUser.requested_role;
    if (targetRoleIdentifier && typeof targetRoleIdentifier === 'string' && targetRoleIdentifier.toUpperCase() === 'BRANCH UNIT ADMIN') {
      targetRoleIdentifier = 'UNIT_ADMIN';
    }
    let assignedRoleId: string | null = null;
    let assignedRoleIds: string[] = [];

    if (dto.roleId && isUuid(dto.roleId)) {
      assignedRoleId = dto.roleId;
      assignedRoleIds = [dto.roleId];
    } else if (targetRoleIdentifier) {
      const matchRes = await this.authQuery.query(
        `SELECT cr.id, cr.name, sr.system_key as system_role
         FROM custom_roles cr
         LEFT JOIN system_roles sr ON cr.system_role_id = sr.id
         WHERE cr.tenant_id = $1::uuid
           AND ($2::text IS NULL OR cr.branch_id IS NULL OR cr.branch_id = $2::uuid)
           AND (
             (CASE WHEN $3 ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN cr.id = $3::uuid ELSE false END)
             OR UPPER(cr.name) = UPPER($3)
             OR UPPER(COALESCE(sr.system_key, '')) = UPPER($3)
             
           )
         ORDER BY (cr.is_system = false) DESC, cr.created_at ASC LIMIT 1`,
        [targetUser.tenant_id, branchId || null, targetRoleIdentifier]
      );

      if (matchRes.rows.length > 0) {
        assignedRoleId = matchRes.rows[0].id;
        assignedRoleIds = [assignedRoleId!];
      }
    }

    if (Array.isArray(dto.roleIds) && dto.roleIds.length > 0) {
      const validRoleUuids = dto.roleIds.filter(isUuid);
      if (validRoleUuids.length > 0) {
        assignedRoleIds = validRoleUuids;
        if (!assignedRoleId) assignedRoleId = validRoleUuids[0];
      }
    }

    if (!assignedRoleId) {
      const defaultRoleRes = await this.authQuery.query(
        `SELECT cr.id FROM custom_roles cr
         LEFT JOIN system_roles sr ON cr.system_role_id = sr.id
         WHERE cr.tenant_id = $1::uuid AND (UPPER(cr.name) = 'RECRUITER' OR UPPER(COALESCE(sr.system_key, '')) = 'RECRUITER' )
         LIMIT 1`,
        [targetUser.tenant_id]
      );
      if (defaultRoleRes.rows.length > 0) {
        assignedRoleId = defaultRoleRes.rows[0].id;
        assignedRoleIds = [assignedRoleId!];
      }
    }

    await this.authQuery.query(
      `UPDATE users
       SET is_approved = true,
           is_active = true,
           requested_role = NULL,
           role_id = COALESCE($1::uuid, role_id),
           assigned_role_ids = CASE WHEN $2::uuid[] IS NOT NULL AND array_length($2::uuid[], 1) > 0 THEN $2::uuid[] ELSE assigned_role_ids END,
           branch_id = $3::uuid,
           business_unit_id = $4::uuid,
           updated_at = NOW()
       WHERE id = $5::uuid`,
      [assignedRoleId || null, assignedRoleIds.length > 0 ? assignedRoleIds : null, branchId || null, businessUnitId || null, userId]
    );

    this.logger.log(`User ${userId} approved by ${requester.email}`);

    // Ensure user is provisioned in Keycloak (critical for JIT/direct SSO users)
    this.keycloakService.provisionUserInKeycloak({
      email: targetUser.email,
      fullName: targetUser.full_name,
      tenantId: targetUser.tenant_id,
    }).catch((err) => {
      this.logger.warn(`Keycloak provisioning on approval failed (non-blocking): ${err.message}`);
    });

    return { success: true, message: `User ${targetUser.full_name || targetUser.email} has been approved.` };
  }

  async rejectTenantUser(userId: string, requester: AuthUser) {
    const userRes = await this.authQuery.query(
      'SELECT id, email, full_name, tenant_id, branch_id FROM users WHERE id = $1 LIMIT 1',
      [userId]
    );
    if (userRes.rows.length === 0) throw new NotFoundException('User not found.');
    const targetUser: any = userRes.rows[0];

    if (!requester.roles?.includes('SUPER_ADMIN') && targetUser.tenant_id !== requester.tenantId) {
      throw new ForbiddenException('You are not authorized to reject users in another tenant.');
    }

    const perms: string[] = Array.isArray(requester.permissions) ? requester.permissions : [];
    const isTenantAdmin = perms.includes('tenant:settings') || perms.includes('tenant:manage') || perms.includes('platform:manage');
    if (!isTenantAdmin && targetUser.branch_id) {
      validateBranchAccess(requester, targetUser.branch_id, 'reject users');
    }

    if (!isTenantAdmin && (requester as any).businessUnitId) {
      if (targetUser.business_unit_id && targetUser.business_unit_id !== (requester as any).businessUnitId) {
        throw new ForbiddenException('Access denied. This user belongs to a different Business Unit.');
      }
    }

    await this.authQuery.query('UPDATE users SET is_active = false, is_approved = false WHERE id = $1', [userId]);
    this.keycloakService.setKeycloakUserStatus(targetUser.email, false).catch(() => {});

    this.logger.log(`User registration request for ${targetUser.email} was rejected by ${requester.email}`);
    return { success: true, message: `Registration request for ${targetUser.email} was rejected.` };
  }

  async bulkSetJobReviewer(tenantId: string, userIds: string[], reviewerId: string | null) {
    if (!Array.isArray(userIds) || userIds.length === 0) throw new BadRequestException('userIds array is required.');
    const cleanReviewerId = reviewerId && reviewerId.trim().length > 0 ? reviewerId.trim() : null;
    await this.authQuery.query(
      `UPDATE users SET job_reviewer_id = $1, updated_at = NOW() WHERE id = ANY($2::uuid[]) AND tenant_id = $3`,
      [cleanReviewerId, userIds, tenantId]
    );
    return { success: true, count: userIds.length, reviewerId: cleanReviewerId };
  }

  // ─── Shared helpers ───────────────────────────────────────────

  private deduplicateRoles(assignedRoleObjs: any[]): string[] {
    const seen = new Set<string>();
    const clean: string[] = [];
    for (const r of assignedRoleObjs) {
      const cKey = r.name.toUpperCase().replace(/[\s-_]+/g, '');
      if (!seen.has(cKey)) { seen.add(cKey); clean.push(r.name); }
    }
    return clean;
  }
}



