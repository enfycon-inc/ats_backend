
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
    await this.authQuery.query(`
      ALTER TABLE tenants ADD COLUMN IF NOT EXISTS job_assignment_mode VARCHAR(50) DEFAULT 'AUTO';
      ALTER TABLE tenants ADD COLUMN IF NOT EXISTS job_assignment_options JSONB DEFAULT '{"allowAuto":true,"allowAll":true,"allowUnassigned":true,"allowedPodIds":[]}';
    `).catch(() => {});

    const result = await this.authQuery.query(
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
    if (result.rows.length === 0) throw new NotFoundException('User profile not found.');
    const u: any = result.rows[0];

    const rolesRes = await this.authQuery.query(
      `SELECT cr.id, cr.name, cr.is_system, cr.system_role, cr.base_role_id FROM custom_roles cr WHERE cr.tenant_id = $1`,
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
      `SELECT rp.role_id, rp.permission FROM role_permissions rp JOIN custom_roles cr ON cr.id = rp.role_id WHERE cr.tenant_id = $1`,
      [u.tenant_id]
    ).catch(() => ({ rows: [] }));

    const rolePermMap: Record<string, Set<string>> = {};
    for (const row of rolePermsRes.rows as any[]) {
      if (!rolePermMap[row.role_id]) rolePermMap[row.role_id] = new Set();
      rolePermMap[row.role_id].add(row.permission);
    }

    const userRoleIds = new Set<string>();
    if (u.role_id) userRoleIds.add(u.role_id);
    if (Array.isArray(u.assigned_role_ids)) u.assigned_role_ids.forEach((rid: string) => userRoleIds.add(rid));
    if (u.branch_roles && typeof u.branch_roles === 'object') {
      Object.values(u.branch_roles).forEach((bRoleList: any) => {
        if (Array.isArray(bRoleList)) {
          bRoleList.forEach((item: string) => {
            if (roleById[item]) userRoleIds.add(item);
            else if (roleByName[String(item).toUpperCase()]) userRoleIds.add(roleByName[String(item).toUpperCase()].id);
          });
        }
      });
    }

    const userPerms = new Set<string>();
    userRoleIds.forEach((rId) => { if (rolePermMap[rId]) rolePermMap[rId].forEach((p) => userPerms.add(p)); });
    const canReview = userPerms.has('submission:internal_screening') || userPerms.has('job:approve') || userPerms.has('job:reject') || userPerms.has('job:publish_direct');

    const assignedRoleObjs: any[] = [];
    userRoleIds.forEach((rId) => { if (roleById[rId]) assignedRoleObjs.push(roleById[rId]); });

    const { bestRoleObj } = this.computeBestRole(assignedRoleObjs);
    const roleName = bestRoleObj?.name || (u.role_id ? roleById[u.role_id]?.name : null) || 'RECRUITER';
    const systemRole = bestRoleObj?.system_role || (u.role_id ? roleById[u.role_id]?.system_role : null) || 'RECRUITER';
    const baseRoleId = bestRoleObj?.base_role_id || (u.role_id ? roleById[u.role_id]?.base_role_id : null) || null;

    const cleanRoles = this.deduplicateRoles(assignedRoleObjs);

    return {
      id: u.id, email: u.email, firstName: u.first_name || '', lastName: u.last_name || '', fullName: u.full_name,
      roles: cleanRoles.length > 0 ? cleanRoles : [roleName],
      roleId: bestRoleObj?.id || u.role_id, assignedRoleIds: Array.from(userRoleIds),
      roleName, systemRole, baseRoleId, permissions: Array.from(userPerms), canReview,
      tenantId: u.tenant_id, isActive: u.is_active, createdAt: u.created_at,
      defaultMarket: u.default_market || 'US', tenantDomain: u.tenant_domain || '',
      userLimit: u.user_limit || 5, podId: u.pod_id, branchId: u.branch_id,
      assignedBranchIds: u.assigned_branch_ids && u.assigned_branch_ids.length > 0 ? u.assigned_branch_ids : (u.branch_id ? [u.branch_id] : []),
      branchRoles: u.branch_roles || {}, branchName: u.branch_name || null,
      businessUnitId: u.business_unit_id, businessUnitName: u.business_unit_name || null,
      jobReviewerId: u.job_reviewer_id || null, jobReviewerName: u.job_reviewer_name || null,
      podSystemEnabled: u.pod_system_enabled !== false,
      candidatePoolMode: u.candidate_pool_mode || 'COMBINED_MARKET',
      jobAssignmentMode: u.job_assignment_mode || 'AUTO',
      jobAssignmentOptions: u.job_assignment_options || { allowAuto: true, allowAll: true, allowUnassigned: true, allowedPodIds: [] },
      tenant: { name: u.tenant_name || '', domain: u.tenant_domain || '' },
    };
  }

  async listUsers(tenantId: string, scopedBranchId?: string | string[] | null) {
    let branchFilter = '';
    let queryParams: any[] = [tenantId];

    if (scopedBranchId) {
      if (Array.isArray(scopedBranchId) && scopedBranchId.length > 0) {
        // Multiple branches: match if user's branch_id is in the list or assigned_branch_ids overlaps
        queryParams.push(scopedBranchId);
        branchFilter = `AND (u.branch_id = ANY($2::uuid[]) OR u.assigned_branch_ids && $2::uuid[])`;
      } else if (typeof scopedBranchId === 'string') {
        queryParams.push(scopedBranchId);
        branchFilter = `AND (u.branch_id = $2 OR $2 = ANY(COALESCE(u.assigned_branch_ids, '{}')::uuid[]))`;
      }
    }

    const result = await this.authQuery.query(
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

    const rolesRes = await this.authQuery.query(
      `SELECT cr.id, cr.name, cr.is_system, cr.system_role, cr.base_role_id FROM custom_roles cr WHERE cr.tenant_id = $1`,
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
      `SELECT rp.role_id, rp.permission FROM role_permissions rp JOIN custom_roles cr ON cr.id = rp.role_id WHERE cr.tenant_id = $1`,
      [tenantId]
    ).catch(() => ({ rows: [] }));
    const rolePermMap: Record<string, Set<string>> = {};
    for (const row of rolePermsRes.rows as any[]) {
      if (!rolePermMap[row.role_id]) rolePermMap[row.role_id] = new Set();
      rolePermMap[row.role_id].add(row.permission);
    }

    return (result.rows as any[]).map((u) => {
      const userRoleIds = new Set<string>();
      if (u.role_id) userRoleIds.add(u.role_id);
      if (Array.isArray(u.assigned_role_ids)) u.assigned_role_ids.forEach((rid: string) => userRoleIds.add(rid));

      const resolvedBranchRoles: Record<string, string[]> = {};
      if (u.branch_roles && typeof u.branch_roles === 'object') {
        Object.entries(u.branch_roles).forEach(([bId, bRoleList]: [string, any]) => {
          if (Array.isArray(bRoleList)) {
            const bNames: string[] = [];
            bRoleList.forEach((item: string) => {
              if (roleById[item]) { userRoleIds.add(item); bNames.push(roleById[item].name); }
              else if (roleByName[String(item).toUpperCase()]) { userRoleIds.add(roleByName[String(item).toUpperCase()].id); bNames.push(roleByName[String(item).toUpperCase()].name); }
              else { bNames.push(item); }
            });
            if (bNames.length > 0) resolvedBranchRoles[bId] = bNames;
          }
        });
      }

      const userPerms = new Set<string>();
      userRoleIds.forEach((rId) => { if (rolePermMap[rId]) rolePermMap[rId].forEach((p) => userPerms.add(p)); });
      const canReview = userPerms.has('submission:internal_screening') || userPerms.has('job:approve') || userPerms.has('job:reject') || userPerms.has('job:publish_direct');

      const assignedRoleObjs: any[] = [];
      userRoleIds.forEach((rId) => { if (roleById[rId]) assignedRoleObjs.push(roleById[rId]); });

      const { bestRoleObj } = this.computeBestRole(assignedRoleObjs);
      const primaryRole = bestRoleObj?.name || u.role_name || 'RECRUITER';
      const systemRole = bestRoleObj?.system_role || u.system_role || 'RECRUITER';
      const baseRoleId = bestRoleObj?.base_role_id || u.base_role_id || null;
      const cleanRoles = this.deduplicateRoles(assignedRoleObjs);

      return {
        id: u.id, email: u.email, firstName: u.first_name || '', lastName: u.last_name || '', fullName: u.full_name,
        roles: cleanRoles.length > 0 ? cleanRoles : [primaryRole],
        roleId: bestRoleObj?.id || u.role_id, assignedRoleIds: Array.from(userRoleIds),
        roleName: primaryRole, systemRole, baseRoleId, isActive: u.is_active, isApproved: u.is_approved, createdAt: u.created_at,
        podId: u.pod_id, branchId: u.branch_id,
        assignedBranchIds: u.assigned_branch_ids && u.assigned_branch_ids.length > 0 ? u.assigned_branch_ids : (u.branch_id ? [u.branch_id] : []),
        branchRoles: Object.keys(resolvedBranchRoles).length > 0 ? resolvedBranchRoles : (u.branch_roles || {}),
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
    const userRes = await this.authQuery.query('SELECT tenant_id, is_active, is_approved, branch_id FROM users WHERE id = $1 LIMIT 1', [userId]);
    if (userRes.rows.length === 0) throw new NotFoundException('User not found.');
    const user: any = userRes.rows[0];

    // Branch isolation: branch admins can only change status of users in their assigned branches
    if (requester && user.branch_id) {
      validateBranchAccess(requester, user.branch_id, 'change user status');
    }

    if (isActive) {
      if (!user.is_active || !user.is_approved) await this.rbacService.checkSeatLimit(user.tenant_id);
    } else {
      await this.rbacService.verifyLastAdminProtection(user.tenant_id, userId, 'deactivate');
    }

    await this.authQuery.query(`UPDATE users SET is_active = $1, is_approved = true, updated_at = NOW() WHERE id = $2`, [isActive, userId]);
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
    await this.authQuery.query('UPDATE branches SET branch_manager_id = NULL WHERE branch_manager_id = $1', [userId]).catch(() => {});
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
      `SELECT u.tenant_id, u.role_id, u.assigned_role_ids, cr.name as role_name, cr.system_role
       FROM users u
       LEFT JOIN custom_roles cr ON cr.id = u.role_id
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

    const isNewAdmin = normalized.includes('ADMIN');
    if (!isNewAdmin) await this.rbacService.verifyLastAdminProtection(tenantId, userId, 'demote');

    const customRolesRes = await this.authQuery.query(
      `SELECT id, name FROM custom_roles 
       WHERE tenant_id = $1 AND (UPPER(name) = ANY($2::text[]) OR system_role = ANY($2::text[]) OR id::text = ANY($2::text[]))
       ORDER BY (is_system = false) DESC, created_at DESC`,
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
    dto: { firstName?: string; lastName?: string; fullName?: string; email?: string; password?: string; roleId?: string; assignedRoleIds?: string[]; branchId?: string; assignedBranchIds?: string[]; branchRoles?: Record<string, string[]>; businessUnitId?: string; roles?: string[]; jobReviewerId?: string | null },
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

    let assignedBranchIds = user.assigned_branch_ids || [];
    let branchRoles = user.branch_roles || {};

    if (dto.branchId !== undefined) branchId = dto.branchId || null;
    if (dto.assignedBranchIds !== undefined) assignedBranchIds = Array.isArray(dto.assignedBranchIds) ? dto.assignedBranchIds : [];
    if (dto.branchRoles !== undefined) branchRoles = dto.branchRoles || {};
    if (branchId && !assignedBranchIds.includes(branchId)) assignedBranchIds = Array.from(new Set([branchId, ...assignedBranchIds]));
    if (dto.businessUnitId !== undefined) businessUnitId = dto.businessUnitId || null;
    if (dto.jobReviewerId !== undefined) jobReviewerId = dto.jobReviewerId && dto.jobReviewerId.trim().length > 0 ? dto.jobReviewerId.trim() : null;

    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    const rawRoleIdentifiers = new Set<string>();
    if (dto.branchRoles !== undefined) {
      Object.values(branchRoles).forEach((rList: any) => {
        if (Array.isArray(rList)) rList.forEach((r: string) => { if (r && typeof r === 'string') rawRoleIdentifiers.add(r.trim()); });
      });
    }
    if (dto.roleId && typeof dto.roleId === 'string') rawRoleIdentifiers.add(dto.roleId.trim());
    if (Array.isArray(dto.roles)) dto.roles.forEach((r: string) => { if (r && typeof r === 'string') rawRoleIdentifiers.add(r.trim()); });

    const combinedRoleIds = new Set<string>();
    if (rawRoleIdentifiers.size > 0) {
      const rawList = Array.from(rawRoleIdentifiers);
      const matchedRolesRes = await this.authQuery.query(
        `SELECT id, name, system_role FROM custom_roles WHERE tenant_id = $1 AND (id::text = ANY($2) OR UPPER(name) = ANY($3) OR system_role = ANY($3))`,
        [user.tenant_id, rawList, rawList.map(r => r.toUpperCase())]
      );
      (matchedRolesRes.rows as any[]).forEach((r) => combinedRoleIds.add(r.id));
    }

    if (user.role_id && uuidRegex.test(user.role_id)) combinedRoleIds.add(user.role_id);
    if (Array.isArray(user.assigned_role_ids)) {
      user.assigned_role_ids.forEach((rid: string) => { if (rid && uuidRegex.test(rid)) combinedRoleIds.add(rid); });
    }

    let primaryRoleId: string | null = null;
    if (dto.roleId && uuidRegex.test(dto.roleId)) primaryRoleId = dto.roleId;
    else if (combinedRoleIds.size > 0) primaryRoleId = Array.from(combinedRoleIds)[0];
    else if (user.role_id && uuidRegex.test(user.role_id)) primaryRoleId = user.role_id;

    await this.authQuery.query(
      `UPDATE users SET first_name = $1, last_name = $2, full_name = $3, email = $4, branch_id = $5, assigned_branch_ids = $6::uuid[], branch_roles = $7::jsonb, business_unit_id = $8, job_reviewer_id = $9, role_id = $10, assigned_role_ids = $11::uuid[], updated_at = NOW() WHERE id = $12`,
      [firstName, lastName, fullName, email, branchId, assignedBranchIds, JSON.stringify(branchRoles), businessUnitId, jobReviewerId, primaryRoleId, Array.from(combinedRoleIds), userId]
    );

    if (dto.roles && Array.isArray(dto.roles) && dto.roles.length > 0) {
      await this.updateUserRoles(userId, dto.roles, requester.roles || []);
    }

    if (dto.password && dto.password.length >= 8) {
      this.keycloakService.provisionUserInKeycloak({ email, password: dto.password, fullName, tenantId: user.tenant_id }).catch((err: any) => {
        this.logger.warn(`Keycloak password update note: ${err.message}`);
      });
    }

    return this.getProfile(userId);
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

  private readonly ROLE_RANK: Record<string, number> = {
    SUPER_ADMIN: 100, ADMIN: 90, BRANCH_ADMIN: 80, DELIVERY_HEAD: 70,
    ACCOUNT_MANAGER: 60, POD_LEAD: 50, RECRUITER: 40,
  };

  private computeBestRole(assignedRoleObjs: any[]): { bestRoleObj: any; highestRank: number } {
    let bestRoleObj: any = null;
    let highestRank = -1;
    for (const r of assignedRoleObjs) {
      const sysKey = (r.system_role || r.name || '').toUpperCase().replace(/[\s-_]+/g, '');
      const matchedKey = Object.keys(this.ROLE_RANK).find(k => k.replace(/_/g, '') === sysKey) || '';
      const rank = this.ROLE_RANK[matchedKey] || 30;
      if (rank > highestRank) { highestRank = rank; bestRoleObj = r; }
    }
    return { bestRoleObj, highestRank };
  }

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
