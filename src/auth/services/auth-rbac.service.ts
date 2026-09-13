import {
  Injectable,
  Logger,
  BadRequestException,
  NotFoundException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { AuthQueryService } from './auth-query.service';
import type { AuthUser } from '../interfaces/auth-user.interface';
import { isTenantAdmin, getUserAssignedBranchIds, validateBranchAccess } from '../utils/branch-scoping';

const DEFAULT_TENANT_ID = process.env.DEFAULT_TENANT_ID || 'd3b07384-d113-49c3-a555-9ee75c13ca33';

/**
 * AuthRbacService — Enterprise Granular RBAC (Ceipal-style).
 * Handles all role seeding, listing, creation, update, permission management,
 * and role assignment across users and branches.
 */
@Injectable()
export class AuthRbacService {
  private readonly logger = new Logger(AuthRbacService.name);

  constructor(private readonly authQuery: AuthQueryService) {}

  // Default permissions matrix shared across seedTenantRoles, createCustomRole, updateRolePermissions, listRoles
  static readonly DEFAULT_PERMISSIONS: Record<string, string[]> = {
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
      'branch_admin:manage', 'candidate:search_all_branches', 'job:view_all_branches', 'candidate:search_all_markets',
    ],
    BRANCH_ADMIN: [
      'job:create', 'job:view', 'job:edit', 'job:publish_direct', 'job:approve', 'job:reject',
      'job:assign', 'job:assign_recruiter', 'job:assign_pod',
      'candidate:create', 'candidate:view',
      'submission:create', 'submission:view', 'submission:internal_screening', 'submission:audit_rounds', 'submission:audit_l1', 'submission:audit_l2', 'submission:audit_l3', 'submission:final_status', 'submission:approve_client', 'submission:schedule_interview', 'submission:edit_rate', 'submission:edit',
      'client:view', 'client:create', 'client:direct_add', 'client:edit', 'client:approve', 'client:reject',
      'placement:view', 'placement:create', 'report:view',
      'branch:edit', 'branch_admin:manage', 'branch:assign_user', 'branch:assign_manager', 'user:manage', 'pod:view', 'pod:edit',
    ],
    RECRUITER: [
      'candidate:create', 'candidate:view',
      'submission:create', 'submission:view', 'submission:edit',
      'job:view',
      'client:view',
      'pod:view',
    ],
    ACCOUNT_MANAGER: [
      'job:create', 'job:edit', 'job:view', 'job:publish_direct', 'job:approve', 'job:reject',
      'job:assign_recruiter',
      'candidate:view', 'candidate:create',
      'submission:view', 'submission:create', 'submission:audit_rounds', 'submission:audit_l1', 'submission:audit_l2', 'submission:audit_l3', 'submission:final_status', 'submission:schedule_interview', 'submission:edit_rate', 'submission:edit',
      'pod:view',
      'client:view', 'client:create', 'client:direct_add', 'client:edit',
      'placement:view', 'placement:create',
      'report:view',
    ],
    DELIVERY_HEAD: [
      'job:view', 'job:edit', 'job:approve', 'job:reject',
      'job:assign', 'job:assign_recruiter', 'job:assign_pod',
      'candidate:view', 'candidate:create',
      'submission:view', 'submission:create', 'submission:internal_screening', 'submission:audit_rounds', 'submission:audit_l1', 'submission:audit_l2', 'submission:audit_l3', 'submission:final_status', 'submission:approve_client', 'submission:schedule_interview', 'submission:edit_rate', 'submission:edit',
      'client:view', 'client:create', 'client:edit', 'client:approve', 'client:reject',
      'pod:create', 'pod:edit', 'pod:delete', 'pod:view', 'pod:reset_cycle', 'pod:overlap',
      'candidate:search_all_branches', 'job:view_all_branches', 'candidate:search_all_markets',
      'placement:view', 'report:view',
    ],
    POD_LEAD: [
      'job:view', 'job:edit', 'job:approve', 'job:reject',
      'candidate:view', 'candidate:create',
      'submission:view', 'submission:create', 'submission:internal_screening', 'submission:schedule_interview', 'submission:edit',
      'client:view',
      'pod:view', 'pod:edit', 'report:view',
    ],
  };

  async seedTenantRoles(tenantId: string): Promise<Record<string, string>> {
    const permissions = { ...AuthRbacService.DEFAULT_PERMISSIONS };

    if (tenantId === DEFAULT_TENANT_ID) {
      permissions['SUPER_ADMIN'] = [
        'job:create', 'job:edit', 'job:view',
        'candidate:create', 'candidate:view',
        'submission:create', 'submission:edit',
        'tenant:settings', 'user:manage', 'platform:manage',
      ];
    }

    const roleMap: Record<string, string> = {};

    for (const [roleName, perms] of Object.entries(permissions)) {
      let roleRes = await this.authQuery.query(
        'SELECT id FROM custom_roles WHERE tenant_id = $1 AND UPPER(name) = UPPER($2) AND is_system = true LIMIT 1',
        [tenantId, roleName]
      );
      let roleId: string;
      if (roleRes.rows.length === 0) {
        const ins = await this.authQuery.query(`
          INSERT INTO custom_roles (tenant_id, branch_id, name, description, is_system, system_role)
          VALUES ($1, NULL, $2, $3, true, $4)
          RETURNING id
        `, [
          tenantId,
          roleName,
          `Default system role for ${roleName.toLowerCase().replace('_', ' ')}s.`,
          roleName,
        ]);
        roleId = (ins.rows[0] as any).id;
      } else {
        roleId = (roleRes.rows[0] as any).id;
        await this.authQuery.query(
          'UPDATE custom_roles SET system_role = $1, description = $2 WHERE id = $3',
          [roleName, `Default system role for ${roleName.toLowerCase().replace('_', ' ')}s.`, roleId]
        );
      }

      roleMap[roleName] = roleId;

      await this.authQuery.query('DELETE FROM role_permissions WHERE role_id = $1', [roleId]);
      for (const perm of perms) {
        await this.authQuery.query(
          'INSERT INTO role_permissions (role_id, permission) VALUES ($1, $2)',
          [roleId, perm]
        );
      }
    }

    return roleMap;
  }

  private async ensureRolesTableBranchColumn(): Promise<void> {
    try {
      await this.authQuery.query(`ALTER TABLE custom_roles ADD COLUMN IF NOT EXISTS branch_id UUID REFERENCES branches(id) ON DELETE CASCADE`);
      await this.authQuery.query(`ALTER TABLE custom_roles ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES users(id) ON DELETE SET NULL`);
      await this.authQuery.query(`
        UPDATE custom_roles cr
        SET branch_id = (
          SELECT id FROM branches b WHERE b.tenant_id = cr.tenant_id ORDER BY b.created_at ASC LIMIT 1
        )
        WHERE cr.branch_id IS NULL AND cr.is_system = false
      `);
    } catch {
      // ignore
    }
  }

  async listRoles(tenantId: string, branchId?: string | string[], includeSystem = false) {
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
      if (Array.isArray(branchId)) {
        if (branchId.length > 0) {
          params.push(branchId);
          sql += ` AND (cr.branch_id = ANY($${params.length}::uuid[]) OR (cr.is_system = true AND cr.branch_id IS NULL))`;
        } else {
          sql += ` AND (cr.is_system = true AND cr.branch_id IS NULL)`;
        }
      } else {
        params.push(branchId);
        sql += ` AND (cr.branch_id = $${params.length}::uuid OR (cr.is_system = true AND cr.branch_id IS NULL))`;
      }
    }

    sql += ' ORDER BY (cr.is_system = false) DESC, cr.name ASC';
    const rolesRes = await this.authQuery.query(sql, params);
    const roles = rolesRes.rows;

    const DEFAULT_PERMS = AuthRbacService.DEFAULT_PERMISSIONS;

    const coveredArchetypes = new Set<string>();
    for (const r of roles as any[]) {
      if (!r.isSystem) {
        if (r.systemRole) coveredArchetypes.add(r.systemRole.toUpperCase().replace(/[\s-_]/g, ''));
        if (r.baseRoleName) coveredArchetypes.add(r.baseRoleName.toUpperCase().replace(/[\s-_]/g, ''));
        if (r.name) coveredArchetypes.add(r.name.toUpperCase().replace(/[\s-_]/g, ''));
      }
    }

    const result: any[] = [];
    for (const role of roles as any[]) {
      const baseSysRole = (role.systemRole || role.name || '').toUpperCase();
      const defaultPerms = DEFAULT_PERMS[baseSysRole] || [];

      const permsRes = await this.authQuery.query(
        'SELECT permission FROM role_permissions WHERE role_id = $1',
        [role.id]
      );
      const rolePerms = permsRes.rows.map((row: any) => row.permission);

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

    return result.filter((r: any) => {
      if (r.isSystem) {
        const sysNorm = (r.systemRole || '').toUpperCase().replace(/[\s-_]/g, '');
        const nameNorm = (r.name || '').toUpperCase().replace(/[\s-_]/g, '');
        if (coveredArchetypes.has(sysNorm) || coveredArchetypes.has(nameNorm)) return false;
        if (branchId && (nameNorm === 'ADMIN' || nameNorm === 'TENANTADMIN' || nameNorm === 'SUPERADMIN')) return false;
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
      if (r.isSystem && substitutedKeys.has(r.name.toUpperCase())) return false;
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
    requester?: AuthUser,
  ) {
    await this.ensureRolesTableBranchColumn();
    const nameUpper = name.toUpperCase().trim();
    if (nameUpper === 'SUPER_ADMIN') {
      throw new BadRequestException('Role name SUPER_ADMIN is reserved for the root system administrator.');
    }

    let resolvedBaseRoleId = baseRoleId || null;
    let resolvedSystemRole = systemRole?.toUpperCase().trim() || 'RECRUITER';

    if (resolvedBaseRoleId) {
      const baseRoleRes = await this.authQuery.query(
        'SELECT id, name, system_role FROM custom_roles WHERE id = $1 AND tenant_id = $2 LIMIT 1',
        [resolvedBaseRoleId, tenantId]
      );
      if (baseRoleRes.rows.length > 0) {
        resolvedSystemRole = (baseRoleRes.rows[0] as any).system_role || (baseRoleRes.rows[0] as any).name;
      }
    } else {
      const baseRoleRes = await this.authQuery.query(
        'SELECT id FROM custom_roles WHERE tenant_id = $1 AND is_system = true AND (UPPER(name) = $2 OR UPPER(system_role) = $2) LIMIT 1',
        [tenantId, resolvedSystemRole]
      );
      resolvedBaseRoleId = (baseRoleRes.rows[0] as any)?.id || null;
    }

    if (!['ADMIN', 'BRANCH_ADMIN', 'ACCOUNT_MANAGER', 'RECRUITER', 'DELIVERY_HEAD', 'POD_LEAD'].includes(resolvedSystemRole)) {
      throw new BadRequestException('Invalid base system role selected.');
    }

    let effectiveBranchId = branchId || null;
    if (!effectiveBranchId) {
      const defaultBranchRes = await this.authQuery.query(
        'SELECT id FROM branches WHERE tenant_id = $1 ORDER BY created_at ASC LIMIT 1',
        [tenantId]
      );
      effectiveBranchId = (defaultBranchRes.rows[0] as any)?.id || null;
    }

    // Branch isolation: branch admins can only create roles in their assigned branches
    if (requester && effectiveBranchId) {
      validateBranchAccess(requester, effectiveBranchId, 'create roles');
    }

    const DEFAULT_PERMS = AuthRbacService.DEFAULT_PERMISSIONS;
    const allowedBaseCeiling = new Set(DEFAULT_PERMS[resolvedSystemRole] || DEFAULT_PERMS.RECRUITER);
    let resolvedPermissions = permissions || [];
    if (resolvedPermissions.length === 0 ||
      (resolvedPermissions.length === 2 && resolvedPermissions.includes('job:view') && resolvedPermissions.includes('candidate:view'))) {
      resolvedPermissions = DEFAULT_PERMS[resolvedSystemRole] || ['job:view', 'candidate:view'];
    }
    resolvedPermissions = resolvedPermissions.filter(p => allowedBaseCeiling.has(p));

    const exists = await this.authQuery.query(
      'SELECT id FROM custom_roles WHERE tenant_id = $1 AND UPPER(name) = $2 AND is_system = false AND (branch_id = $3::uuid OR ($3::uuid IS NULL AND branch_id IS NULL)) LIMIT 1',
      [tenantId, nameUpper, effectiveBranchId]
    );
    if (exists.rows.length > 0) {
      throw new ConflictException(`A custom role with name "${name}" already exists in this branch.`);
    }

    const roleRes = await this.authQuery.query(
      `INSERT INTO custom_roles (tenant_id, branch_id, name, description, is_system, system_role, base_role_id, created_by)
       VALUES ($1, $2, $3, $4, false, $5, $6, $7)
       RETURNING id, tenant_id, branch_id as "branchId", name, description, is_system as "isSystem", system_role as "systemRole", base_role_id as "baseRoleId", created_at as "createdAt", updated_at as "updatedAt", created_by as "createdById"`,
      [tenantId, effectiveBranchId, name, description, resolvedSystemRole, resolvedBaseRoleId, createdById || null]
    );
    const role: any = roleRes.rows[0];

    for (const perm of resolvedPermissions) {
      await this.authQuery.query('INSERT INTO role_permissions (role_id, permission) VALUES ($1, $2)', [role.id, perm]);
    }

    let branchName = null;
    if (effectiveBranchId) {
      const bRes = await this.authQuery.query('SELECT name FROM branches WHERE id = $1', [effectiveBranchId]);
      branchName = (bRes.rows[0] as any)?.name || null;
    }

    return { ...role, branchName, permissions: resolvedPermissions };
  }

  async updateCustomRole(
    tenantId: string,
    roleId: string,
    body: { name?: string; description?: string; systemRole?: string; baseRoleId?: string; branchId?: string; permissions?: string[] },
    userId?: string,
    requester?: AuthUser,
  ) {
    await this.ensureRolesTableBranchColumn();
    const roleResult = await this.authQuery.query(
      'SELECT id, name, is_system, branch_id, base_role_id FROM custom_roles WHERE id = $1 AND tenant_id = $2 LIMIT 1',
      [roleId, tenantId]
    );
    if (roleResult.rows.length === 0) throw new NotFoundException('Role not found.');
    const existingRole: any = roleResult.rows[0];
    if (existingRole.is_system) throw new BadRequestException('Default system archetype templates cannot be modified directly.');

    // Branch isolation: branch admins can only update roles in their assigned branches
    if (requester && existingRole.branch_id) {
      validateBranchAccess(requester, existingRole.branch_id, 'update roles');
    }

    const updates: string[] = ['updated_at = NOW()'];
    const params: any[] = [roleId, tenantId];

    if (body.name !== undefined) {
      const nameUpper = body.name.toUpperCase().trim();
      if (nameUpper === 'SUPER_ADMIN') throw new BadRequestException('Role name SUPER_ADMIN is reserved.');
      const targetBranchId = body.branchId !== undefined ? body.branchId : existingRole.branch_id;
      const exists = await this.authQuery.query(
        'SELECT id FROM custom_roles WHERE tenant_id = $1 AND UPPER(name) = $2 AND is_system = false AND (branch_id = $3::uuid OR ($3::uuid IS NULL AND branch_id IS NULL)) AND id <> $4 LIMIT 1',
        [tenantId, nameUpper, targetBranchId, roleId]
      );
      if (exists.rows.length > 0) throw new ConflictException(`A custom role with name "${body.name}" already exists in this branch.`);
      params.push(body.name.trim());
      updates.push(`name = $${params.length}`);
    }

    if (body.description !== undefined) { params.push(body.description); updates.push(`description = $${params.length}`); }
    if (body.baseRoleId !== undefined) { params.push(body.baseRoleId || null); updates.push(`base_role_id = $${params.length}`); }

    if (body.systemRole !== undefined) {
      const resolvedSystemRole = body.systemRole.toUpperCase().trim();
      if (!['ADMIN', 'BRANCH_ADMIN', 'ACCOUNT_MANAGER', 'RECRUITER', 'DELIVERY_HEAD', 'POD_LEAD'].includes(resolvedSystemRole)) {
        throw new BadRequestException('Invalid base system role selected.');
      }
      params.push(resolvedSystemRole);
      updates.push(`system_role = $${params.length}`);
    }

    if (body.branchId !== undefined) { params.push(body.branchId); updates.push(`branch_id = $${params.length}::uuid`); }

    if (updates.length > 1) {
      await this.authQuery.query(`UPDATE custom_roles SET ${updates.join(', ')} WHERE id = $1 AND tenant_id = $2`, params);

      if (body.name !== undefined && body.name.trim() !== existingRole.name) {
        const oldName = existingRole.name;
        const usersToUpdate = await this.authQuery.query('SELECT id, branch_roles FROM users WHERE tenant_id = $1', [tenantId]);
        for (const u of usersToUpdate.rows as any[]) {
          let needsUpdate = false;
          let branchRoles: Record<string, string[]> = u.branch_roles || {};
          for (const [bId, rList] of Object.entries(branchRoles)) {
            if (Array.isArray(rList) && rList.some((r: string) => r.toUpperCase() === oldName.toUpperCase())) {
              branchRoles[bId] = rList.map((r: string) => r.toUpperCase() === oldName.toUpperCase() ? roleId : r);
              needsUpdate = true;
            }
          }
          if (needsUpdate) {
            await this.authQuery.query('UPDATE users SET branch_roles = $1::jsonb, updated_at = NOW() WHERE id = $2', [JSON.stringify(branchRoles), u.id]);
          }
        }
      }
    }

    if (body.permissions && Array.isArray(body.permissions)) {
      await this.updateRolePermissions(tenantId, roleId, body.permissions);
    }

    return { message: 'Custom role updated successfully.', roleId };
  }

  async updateRolePermissions(tenantId: string, roleId: string, permissions: string[], requester?: AuthUser) {
    const roleResult = await this.authQuery.query(
      'SELECT id, is_system, system_role, base_role_id, branch_id FROM custom_roles WHERE id = $1 AND tenant_id = $2 LIMIT 1',
      [roleId, tenantId]
    );
    if (roleResult.rows.length === 0) throw new NotFoundException('Role not found.');
    const role: any = roleResult.rows[0];

    // Branch isolation: branch admins can only update permissions for roles in their assigned branches
    if (requester && role.branch_id) {
      validateBranchAccess(requester, role.branch_id, 'update role permissions');
    }

    const DEFAULT_PERMS = AuthRbacService.DEFAULT_PERMISSIONS;
    const sysKey = (role.system_role || 'RECRUITER').toUpperCase();
    const allowedCeiling = new Set(DEFAULT_PERMS[sysKey] || DEFAULT_PERMS.RECRUITER);
    const filteredPermissions = role.is_system ? permissions : permissions.filter(p => allowedCeiling.has(p));

    await this.authQuery.query('DELETE FROM role_permissions WHERE role_id = $1', [roleId]);
    for (const perm of filteredPermissions) {
      await this.authQuery.query('INSERT INTO role_permissions (role_id, permission) VALUES ($1, $2)', [roleId, perm]);
    }

    return { message: 'Permissions updated successfully.', permissions: filteredPermissions };
  }

  async deleteCustomRole(tenantId: string, roleId: string, targetRoleId?: string, requester?: AuthUser) {
    const roleResult = await this.authQuery.query(
      'SELECT id, name, is_system, system_role, branch_id FROM custom_roles WHERE id = $1 AND tenant_id = $2 LIMIT 1',
      [roleId, tenantId]
    );
    if (roleResult.rows.length === 0) throw new NotFoundException('Role not found.');
    const roleToDel: any = roleResult.rows[0];
    if (roleToDel.is_system) throw new BadRequestException('You cannot delete default system roles.');

    // Branch isolation: branch admins can only delete roles in their assigned branches
    if (requester && roleToDel.branch_id) {
      validateBranchAccess(requester, roleToDel.branch_id, 'delete roles');
    }

    const staffCountRes = await this.authQuery.query(
      `SELECT COUNT(*)::int as count FROM users 
       WHERE tenant_id = $1 AND (role_id = $2::uuid OR $2::uuid = ANY(assigned_role_ids))`,
      [tenantId, roleId]
    );
    const staffCount = (staffCountRes.rows[0] as any)?.count || 0;

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
      const targetRes = await this.authQuery.query('SELECT id, name FROM custom_roles WHERE id = $1 AND tenant_id = $2 LIMIT 1', [targetRoleId, tenantId]);
      if (targetRes.rows.length === 0) throw new NotFoundException('Target replacement role not found.');
      targetRole = targetRes.rows[0];
    } else {
      const baseSysRole = roleToDel.system_role || 'RECRUITER';
      const fallbackRes = await this.authQuery.query(
        'SELECT id, name FROM custom_roles WHERE tenant_id = $1 AND (name = $2 OR system_role = $2) AND is_system = true LIMIT 1',
        [tenantId, baseSysRole]
      );
      targetRole = fallbackRes.rows[0];
    }

    let reassignedCount = 0;
    if (targetRole) {
      const updateRes = await this.authQuery.query(
        'UPDATE users SET role_id = $1 WHERE role_id = $2 AND tenant_id = $3 RETURNING id',
        [targetRole.id, roleId, tenantId]
      );
      reassignedCount = updateRes.rows.length;
      await this.authQuery.query(
        `UPDATE users SET assigned_role_ids = array_replace(assigned_role_ids, $1::uuid, $2::uuid) WHERE tenant_id = $3 AND $1::uuid = ANY(assigned_role_ids)`,
        [roleId, targetRole.id, tenantId]
      ).catch(() => {});
    } else {
      await this.authQuery.query(
        `UPDATE users SET role_id = NULL WHERE role_id = $1 AND tenant_id = $2`,
        [roleId, tenantId]
      ).catch(() => {});
      await this.authQuery.query(
        `UPDATE users SET assigned_role_ids = array_remove(assigned_role_ids, $1::uuid) WHERE tenant_id = $2 AND $1::uuid = ANY(assigned_role_ids)`,
        [roleId, tenantId]
      ).catch(() => {});
    }

    // Clean up any branch_roles JSON references
    const usersWithBranchRoles = await this.authQuery.query(
      `SELECT id, branch_roles FROM users WHERE tenant_id = $1 AND branch_roles::text LIKE '%' || $2 || '%'`,
      [tenantId, roleId]
    ).catch(() => ({ rows: [] }));
    for (const u of usersWithBranchRoles.rows as any[]) {
      let branchRoles = u.branch_roles || {};
      let changed = false;
      for (const [bId, rList] of Object.entries(branchRoles)) {
        if (Array.isArray(rList) && rList.includes(roleId)) {
          branchRoles[bId] = targetRole ? rList.map((r: string) => r === roleId ? targetRole.id : r) : rList.filter((r: string) => r !== roleId);
          changed = true;
        }
      }
      if (changed) {
        await this.authQuery.query(
          'UPDATE users SET branch_roles = $1::jsonb WHERE id = $2 AND tenant_id = $3',
          [JSON.stringify(branchRoles), u.id, tenantId]
        ).catch(() => {});
      }
    }

    // Nullify role in pending invitations if any
    await this.authQuery.query('UPDATE user_invitations SET role_id = NULL WHERE role_id = $1', [roleId]).catch(() => {});

    await this.authQuery.query('DELETE FROM role_permissions WHERE role_id = $1', [roleId]).catch(() => {});
    await this.authQuery.query('DELETE FROM user_roles WHERE role_id = $1', [roleId]).catch(() => {});
    await this.authQuery.query('DELETE FROM custom_roles WHERE id = $1 AND tenant_id = $2', [roleId, tenantId]);

    return {
      message: `Custom role "${roleToDel.name}" deleted successfully.${reassignedCount > 0 ? ` Reassigned ${reassignedCount} staff member(s) to ${targetRole?.name || 'default role'}.` : ''}`,
      reassignedCount,
      targetRole: (targetRole as any)?.name,
    };
  }

  async assignUserRoles(tenantId: string, userId: string, roleIds: string[], requesterRoles: string[], append: boolean = false, requester?: AuthUser) {
    if (!roleIds || roleIds.length === 0) throw new BadRequestException('Please specify at least one role.');

    const rolesResult = await this.authQuery.query(
      'SELECT id, name, branch_id FROM custom_roles WHERE id = ANY($1) AND tenant_id = $2',
      [roleIds, tenantId]
    );
    if (rolesResult.rows.length === 0) throw new NotFoundException('Selected roles were not found.');
    const newRolesData: any[] = rolesResult.rows as any[];
    const newRoleNames = newRolesData.map(r => r.name);

    const newRoleNamesUpper = newRoleNames.map(r => r.toUpperCase());
    if (newRoleNamesUpper.includes('SUPER_ADMIN') && (!requesterRoles || !requesterRoles.includes('SUPER_ADMIN'))) {
      throw new ForbiddenException('You are not authorized to assign the SUPER_ADMIN role.');
    }

    const userRes = await this.authQuery.query(
      'SELECT tenant_id, role_id, assigned_role_ids, branch_roles, branch_id FROM users WHERE id = $1 AND tenant_id = $2 LIMIT 1',
      [userId, tenantId]
    );
    if (userRes.rows.length === 0) throw new NotFoundException('User not found.');
    const targetUser: any = userRes.rows[0];

    // Branch isolation: branch admins can only assign roles to users in their assigned branches
    if (requester && targetUser.branch_id) {
      validateBranchAccess(requester, targetUser.branch_id, 'assign roles to users');
    }
    // Also validate that the roles being assigned belong to the requester's branches
    if (requester && !isTenantAdmin(requester)) {
      const requesterBranches = new Set(getUserAssignedBranchIds(requester));
      for (const r of newRolesData) {
        if (r.branch_id && !requesterBranches.has(r.branch_id)) {
          throw new ForbiddenException(`You cannot assign role "${r.name}" as it belongs to a branch outside your access.`);
        }
      }
    }

    const targetAssignedRoleIds: string[] = Array.isArray(targetUser.assigned_role_ids) ? targetUser.assigned_role_ids : [];
    const targetBranchRoles = targetUser.branch_roles || {};

    let finalAssignedRoleIds: string[];
    let finalBranchRoles: any;

    if (append) {
      finalAssignedRoleIds = [...targetAssignedRoleIds];
      finalBranchRoles = { ...targetBranchRoles };
      for (const r of newRolesData) {
        if (!finalAssignedRoleIds.includes(r.id)) finalAssignedRoleIds.push(r.id);
        if (r.branch_id) {
          const bList = Array.isArray(finalBranchRoles[r.branch_id]) ? finalBranchRoles[r.branch_id] : [];
          if (!bList.includes(r.id)) finalBranchRoles[r.branch_id] = [...bList, r.id];
        }
      }
    } else {
      finalAssignedRoleIds = newRolesData.map(r => r.id);
      finalBranchRoles = {};
      for (const r of newRolesData) {
        if (r.branch_id) {
          const bList = Array.isArray(finalBranchRoles[r.branch_id]) ? finalBranchRoles[r.branch_id] : [];
          if (!bList.includes(r.id)) finalBranchRoles[r.branch_id] = [...bList, r.id];
        }
      }
    }

    const isNewAdmin = newRolesData.some(r => r.system_role === 'ADMIN' || (r.name && r.name.toUpperCase() === 'ADMIN'));
    if (!isNewAdmin) {
      await this.verifyLastAdminProtection(tenantId, userId, 'demote');
    }

    await this.authQuery.query(
      `UPDATE users SET role_id = $1, assigned_role_ids = $2::uuid[], branch_roles = $3::jsonb, updated_at = NOW() WHERE id = $4 AND tenant_id = $5`,
      [roleIds[0] || targetUser.role_id, finalAssignedRoleIds, JSON.stringify(finalBranchRoles), userId, tenantId]
    );

    return { message: 'User roles assigned successfully.', roles: newRoleNames };
  }

  async batchAssignUsersToRole(tenantId: string, roleId: string, userIds: string[], requesterRoles: string[], requester?: AuthUser) {
    if (!userIds || userIds.length === 0) throw new BadRequestException('Please provide at least one user ID.');

    const roleRes = await this.authQuery.query(
      'SELECT id, name, is_system, system_role, branch_id FROM custom_roles WHERE id = $1 AND tenant_id = $2 LIMIT 1',
      [roleId, tenantId]
    );
    if (roleRes.rows.length === 0) throw new NotFoundException('Target custom role not found.');
    const targetRole: any = roleRes.rows[0];

    // Branch isolation: branch admins can only batch-assign to roles in their branches
    if (requester && targetRole.branch_id) {
      validateBranchAccess(requester, targetRole.branch_id, 'batch assign users to role');
    }

    let assignedCount = 0;
    for (const userId of userIds) {
      const uRes = await this.authQuery.query(
        'SELECT id, role_id, assigned_role_ids, branch_id FROM users WHERE id = $1 AND tenant_id = $2 LIMIT 1',
        [userId, tenantId]
      );
      if (uRes.rows.length === 0) continue;
      const user: any = uRes.rows[0];

      // Branch isolation: skip users not in requester's branch
      if (requester && user.branch_id && !isTenantAdmin(requester)) {
        try { validateBranchAccess(requester, user.branch_id, 'batch assign'); } catch { continue; }
      }

      const currentAssigned: string[] = Array.isArray(user.assigned_role_ids) ? user.assigned_role_ids : [];
      const updatedAssigned = currentAssigned.includes(targetRole.id) ? currentAssigned : [...currentAssigned, targetRole.id];

      await this.authQuery.query(
        `UPDATE users SET role_id = COALESCE(role_id, $1::uuid), assigned_role_ids = $2::uuid[], updated_at = NOW() WHERE id = $3 AND tenant_id = $4`,
        [targetRole.id, updatedAssigned, userId, tenantId]
      );
      assignedCount++;
    }

    return { message: `Successfully assigned ${assignedCount} user(s) to role "${targetRole.name}".`, count: assignedCount };
  }

  async unassignUserFromRole(tenantId: string, roleId: string, userId: string, requester?: AuthUser) {
    const roleRes = await this.authQuery.query(
      'SELECT id, name, is_system, system_role, branch_id FROM custom_roles WHERE id = $1 AND tenant_id = $2 LIMIT 1',
      [roleId, tenantId]
    );
    if (roleRes.rows.length === 0) throw new NotFoundException('Role not found.');
    const role: any = roleRes.rows[0];

    const uRes = await this.authQuery.query(
      'SELECT id, role_id, assigned_role_ids, branch_id FROM users WHERE id = $1 AND tenant_id = $2 LIMIT 1',
      [userId, tenantId]
    );
    if (uRes.rows.length === 0) throw new NotFoundException('User not found.');
    const user: any = uRes.rows[0];

    // Branch isolation: branch admins can only unassign roles from users in their assigned branches
    if (requester && user.branch_id) {
      validateBranchAccess(requester, user.branch_id, 'unassign roles from users');
    }

    const currentAssigned: string[] = Array.isArray(user.assigned_role_ids) ? user.assigned_role_ids : [];
    const remainingAssigned = currentAssigned.filter(rId => rId !== roleId);

    let nextRoleId = user.role_id === role.id ? (remainingAssigned[0] || null) : user.role_id;
    if (!nextRoleId) {
      const defaultRoleRes = await this.authQuery.query(
        'SELECT id FROM custom_roles WHERE tenant_id = $1 AND system_role = $2 LIMIT 1',
        [tenantId, 'RECRUITER']
      );
      nextRoleId = (defaultRoleRes.rows[0] as any)?.id || null;
      if (nextRoleId && !remainingAssigned.includes(nextRoleId)) remainingAssigned.push(nextRoleId);
    }

    await this.authQuery.query(
      `UPDATE users SET role_id = $1, assigned_role_ids = $2::uuid[], updated_at = NOW() WHERE id = $3 AND tenant_id = $4`,
      [nextRoleId, remainingAssigned, userId, tenantId]
    );

    return { message: `Removed user from role "${role.name}".`, remainingAssigned };
  }

  listAllPermissions() {
    return [
      { id: 'job:create', name: 'Create Jobs', group: 'Jobs Management' },
      { id: 'job:edit', name: 'Edit Jobs', group: 'Jobs Management' },
      { id: 'job:view', name: 'View Jobs', group: 'Jobs Management' },
      { id: 'job:publish_direct', name: 'Publish Jobs Directly (Bypass Approval Gate)', group: 'Jobs Management' },
      { id: 'job:approve', name: 'Approve & Activate Job Requisitions', group: 'Jobs Management' },
      { id: 'job:reject', name: 'Reject Job Requisitions with Feedback', group: 'Jobs Management' },
      { id: 'job:assign', name: 'Assign & Reassign Jobs to Recruiters/Pods', group: 'Jobs Management' },
      { id: 'job:assign_recruiter', name: 'Assign Direct Recruiter to Job', group: 'Jobs Management' },
      { id: 'job:assign_pod', name: 'Assign Pod to Job', group: 'Jobs Management' },
      { id: 'candidate:create', name: 'Create Candidates', group: 'Candidates Management' },
      { id: 'candidate:view', name: 'View Candidates & Resume Bank', group: 'Candidates Management' },
      { id: 'submission:view', name: 'View Submissions Tracker & Candidate Pipeline', group: 'Candidate Submissions & Sourcing' },
      { id: 'submission:create', name: 'Submit Candidate CV to Job Requisitions', group: 'Candidate Submissions & Sourcing' },
      { id: 'submission:edit', name: 'Edit Submissions (General Notes & Comments)', group: 'Candidate Submissions & Sourcing' },
      { id: 'submission:internal_screening', name: 'Internal Screening Review & Approval Gate', group: 'Internal Screening & Review Gate' },
      { id: 'submission:edit_rate', name: 'Edit Candidate Pay Rate & CTC Margins', group: 'Internal Screening & Review Gate' },
      { id: 'submission:audit_rounds', name: 'Interview Stages (Master L1, L2, L3 Audits & Remarks)', group: 'Interview Rounds & Quality Audits (L1, L2, L3)' },
      { id: 'submission:audit_l1', name: 'Round 1 (L1) Screening & Interview Audit', group: 'Interview Rounds & Quality Audits (L1, L2, L3)' },
      { id: 'submission:audit_l2', name: 'Round 2 (L2) Technical Interview & Vetting', group: 'Interview Rounds & Quality Audits (L1, L2, L3)' },
      { id: 'submission:audit_l3', name: 'Round 3 (L3) Commercial & Final Readiness Audit', group: 'Interview Rounds & Quality Audits (L1, L2, L3)' },
      { id: 'submission:schedule_interview', name: 'Schedule Client & Internal Interviews', group: 'Interview Rounds & Quality Audits (L1, L2, L3)' },
      { id: 'submission:final_status', name: 'Final Placement Status (Offer & Join Outcome)', group: 'Interview Rounds & Quality Audits (L1, L2, L3)' },
      { id: 'submission:approve_client', name: 'Approve Client Submission', group: 'Interview Rounds & Quality Audits (L1, L2, L3)' },
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
      { id: 'pod:create', name: 'Create Pods', group: 'Pods Management' },
      { id: 'pod:edit', name: 'Edit Pods & Assign Unassigned Jobs', group: 'Pods Management' },
      { id: 'pod:delete', name: 'Delete Pods', group: 'Pods Management' },
      { id: 'pod:view', name: 'View Pods', group: 'Pods Management' },
      { id: 'pod:reset_cycle', name: 'Reset Assignment Cycle', group: 'Pods Management' },
      { id: 'pod:overlap', name: 'Authorize Pod Assignment Overlaps', group: 'Pods Management' },
      { id: 'branch:create', name: 'Create New Branch Locations', group: 'Branch & Multi-Office Management' },
      { id: 'branch:edit', name: 'Edit Branch Operating Hours, Timezone & Policies', group: 'Branch & Multi-Office Management' },
      { id: 'branch:delete', name: 'Delete Branch Office Locations', group: 'Branch & Multi-Office Management' },
      { id: 'branch_admin:manage', name: 'Manage Branch Office & Staff', group: 'Branch & Multi-Office Management' },
      { id: 'candidate:search_all_branches', name: 'Search Candidates Across All Branches', group: 'Branch & Multi-Office Management' },
      { id: 'job:view_all_branches', name: 'View Jobs Across All Branches', group: 'Branch & Multi-Office Management' },
      { id: 'candidate:search_all_markets', name: 'Search Candidates Across All Markets (US + India)', group: 'Branch & Multi-Office Management' },
      { id: 'tenant:settings', name: 'Manage Company Settings', group: 'Administration' },
      { id: 'user:manage', name: 'Manage Staff & Roles', group: 'Administration' },
      { id: 'platform:manage', name: 'Platform Super Administration', group: 'Administration' },
    ];
  }

  // ─── Shared helpers used by multiple sub-services ───────────────────────────

  async checkSeatLimit(tenantId: string) {
    const tenantRes = await this.authQuery.query('SELECT user_limit FROM tenants WHERE id = $1 LIMIT 1', [tenantId]);
    if (tenantRes.rows.length === 0) throw new NotFoundException('Tenant not found.');
    const userLimit = (tenantRes.rows[0] as any).user_limit || 5;
    const activeRes = await this.authQuery.query(
      'SELECT COUNT(*) as count FROM users WHERE tenant_id = $1 AND is_active = true AND is_approved = true',
      [tenantId]
    );
    const activeCount = parseInt((activeRes.rows[0] as any).count, 10);
    if (activeCount >= userLimit) {
      throw new BadRequestException(
        `Seat limit reached. This workspace is limited to ${userLimit} active users. Please contact the platform administrator to purchase more seats.`
      );
    }
  }

  async verifyLastAdminProtection(tenantId: string, targetUserId: string, action: 'demote' | 'deactivate' | 'delete') {
    const userRes = await this.authQuery.query(
      `SELECT u.role_id, u.assigned_role_ids, cr.name as role_name, cr.system_role, u.is_active, u.is_approved 
       FROM users u
       LEFT JOIN custom_roles cr ON cr.id = u.role_id
       WHERE u.id = $1 AND u.tenant_id = $2 LIMIT 1`,
      [targetUserId, tenantId]
    );
    if (userRes.rows.length === 0) return;
    const user: any = userRes.rows[0];
    const hasAdmin = user.system_role === 'ADMIN' || user.role_name === 'ADMIN';

    if (hasAdmin && user.is_active && user.is_approved) {
      const adminsRes = await this.authQuery.query(
        `SELECT COUNT(*) as count 
         FROM users u
         LEFT JOIN custom_roles cr ON cr.id = u.role_id
         WHERE u.tenant_id = $1 AND u.is_active = true AND u.is_approved = true 
           AND (cr.system_role = 'ADMIN' OR cr.name = 'ADMIN')`,
        [tenantId]
      );
      const adminCount = parseInt((adminsRes.rows[0] as any).count, 10);
      if (adminCount <= 1) {
        throw new BadRequestException(
          `Action blocked: You cannot ${action} the last active Administrator in this workspace. Please assign another active user as an Administrator first.`
        );
      }
    }
  }
}
