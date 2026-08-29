import { Injectable, Logger, NotFoundException, BadRequestException, ConflictException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { CreateBranchDto } from './dtos/create-branch.dto';
import { UpdateBranchDto } from './dtos/update-branch.dto';

export interface BranchMember {
  id: string;
  email: string;
  fullName: string;
  roles: string[];
  isActive: boolean;
  podId: string | null;
  createdAt: string;
}

export interface BranchResponse {
  id: string;
  name: string;
  code: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  market: string;
  managerId: string | null;
  managerName: string | null;
  managerEmail: string | null;
  isActive: boolean;
  allowNone: boolean;
  allowPods: boolean;
  allowAll: boolean;
  allowUnassigned: boolean;
  podDistributionStrategy: 'AUTO' | 'MANUAL';
  requireAmJobApproval: boolean;
  requireJobApproval: boolean;
  rolesRequiringApproval: string[];
  defaultJobApproverRole: string;
  allowedJobApproverRoles: string[];
  approvalRoutingMode: 'FLEXIBLE' | 'ENFORCE_DEFAULT';
  timezone: string;
  workStartTime: string;
  workEndTime: string;
  workingDays: string[];
  shiftTiming: string;
  breakDurationMinutes: number;
  usersCount: number;
  jobsCount: number;
  members?: BranchMember[];
  createdAt: string;
}

@Injectable()
export class BranchesService {
  private readonly logger = new Logger(BranchesService.name);

  constructor(private readonly db: DatabaseService) {}

  private async ensureBranchSettingsColumns(): Promise<void> {
    await this.db.query(`
      ALTER TABLE branches ADD COLUMN IF NOT EXISTS allow_none BOOLEAN DEFAULT FALSE;
      ALTER TABLE branches ADD COLUMN IF NOT EXISTS allow_pods BOOLEAN DEFAULT TRUE;
      ALTER TABLE branches ADD COLUMN IF NOT EXISTS allow_all BOOLEAN DEFAULT TRUE;
      ALTER TABLE branches ADD COLUMN IF NOT EXISTS allow_unassigned BOOLEAN DEFAULT TRUE;
      ALTER TABLE branches ADD COLUMN IF NOT EXISTS pod_distribution_strategy VARCHAR(50) DEFAULT 'AUTO';
      ALTER TABLE branches ADD COLUMN IF NOT EXISTS require_am_job_approval BOOLEAN DEFAULT TRUE;
      ALTER TABLE branches ADD COLUMN IF NOT EXISTS require_job_approval BOOLEAN DEFAULT TRUE;
      ALTER TABLE branches ADD COLUMN IF NOT EXISTS roles_requiring_approval TEXT DEFAULT '["ACCOUNT_MANAGER", "BD", "RECRUITER"]';
      ALTER TABLE branches ADD COLUMN IF NOT EXISTS default_job_approver_role VARCHAR(50) DEFAULT 'POD_LEAD';
      ALTER TABLE branches ADD COLUMN IF NOT EXISTS allowed_job_approver_roles TEXT DEFAULT '["POD_LEAD", "DELIVERY_HEAD", "PRIMARY_RECRUITER", "BRANCH_ADMIN"]';
      ALTER TABLE branches ADD COLUMN IF NOT EXISTS approval_routing_mode VARCHAR(50) DEFAULT 'FLEXIBLE';
      ALTER TABLE branches ADD COLUMN IF NOT EXISTS timezone VARCHAR(100) DEFAULT 'Asia/Kolkata';
      ALTER TABLE branches ADD COLUMN IF NOT EXISTS work_start_time VARCHAR(20) DEFAULT '09:00';
      ALTER TABLE branches ADD COLUMN IF NOT EXISTS work_end_time VARCHAR(20) DEFAULT '18:00';
      ALTER TABLE branches ADD COLUMN IF NOT EXISTS working_days TEXT DEFAULT '["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"]';
      ALTER TABLE branches ADD COLUMN IF NOT EXISTS shift_timing VARCHAR(100) DEFAULT 'General Shift';
      ALTER TABLE branches ADD COLUMN IF NOT EXISTS break_duration_minutes INTEGER DEFAULT 60;
    `).catch(() => {});
  }

  async create(dto: CreateBranchDto, tenantId: string): Promise<BranchResponse> {
    await this.ensureBranchSettingsColumns();
    this.logger.log(`Creating branch "${dto.name}" for tenant ${tenantId}`);

    const tenantRes = await this.db.query(
      'SELECT max_branches FROM tenants WHERE id = $1 LIMIT 1',
      [tenantId]
    );
    const maxBranches = tenantRes.rows[0]?.max_branches || 5;

    const countRes = await this.db.query(
      'SELECT COUNT(*)::int as count FROM branches WHERE tenant_id = $1',
      [tenantId]
    );
    const currentBranchesCount = countRes.rows[0]?.count || 0;

    if (currentBranchesCount >= maxBranches) {
      throw new BadRequestException(
        `Branch limit reached. Your subscription plan allows up to ${maxBranches} branches. Please upgrade your plan to add more branches.`
      );
    }

    const nameCheck = await this.db.query(
      'SELECT 1 FROM branches WHERE tenant_id = $1 AND UPPER(name) = $2',
      [tenantId, dto.name.trim().toUpperCase()]
    );
    if (nameCheck.rows.length > 0) {
      throw new ConflictException(`A branch with the name "${dto.name}" already exists.`);
    }

    const code = dto.code ? dto.code.trim().toUpperCase() : dto.name.substring(0, 4).toUpperCase();
    const market = dto.market ? dto.market.trim().toUpperCase() : 'INDIA';
    const timezone = dto.timezone || (market === 'US' || dto.country === 'United States' ? 'America/New_York' : 'Asia/Kolkata');
    const workStartTime = dto.workStartTime || '09:00';
    const workEndTime = dto.workEndTime || '18:00';
    const workingDays = JSON.stringify(dto.workingDays || ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday']);
    const shiftTiming = dto.shiftTiming ? dto.shiftTiming.trim() : (market === 'US' ? 'US Shift' : 'General Shift');
    const breakDurationMinutes = dto.breakDurationMinutes ?? 60;

    const res = await this.db.query(
      `INSERT INTO branches (
        tenant_id, name, code, city, state, country, market,
        timezone, work_start_time, work_end_time, working_days, shift_timing, break_duration_minutes
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
      RETURNING *`,
      [
        tenantId,
        dto.name.trim(),
        code,
        dto.city || null,
        dto.state || null,
        dto.country || 'India',
        market,
        timezone,
        workStartTime,
        workEndTime,
        workingDays,
        shiftTiming,
        breakDurationMinutes,
      ]
    );
    const branch = res.rows[0];

    return this.findOne(branch.id, tenantId);
  }

  async findAll(tenantId: string): Promise<BranchResponse[]> {
    await this.ensureBranchSettingsColumns();
    const res = await this.db.query(
      `SELECT b.*,
              u.full_name AS manager_name,
              u.email AS manager_email,
              (SELECT COUNT(*)::int FROM jobs WHERE branch_id = b.id) as jobs_count
       FROM branches b
       LEFT JOIN users u ON u.id = b.manager_id
       WHERE b.tenant_id = $1
       ORDER BY b.name ASC`,
      [tenantId]
    );

    const allUsersRes = await this.db.query(
      `SELECT id, email, full_name, roles, is_active, pod_id, branch_id, assigned_branch_ids, created_at
       FROM users
       WHERE tenant_id = $1
       ORDER BY full_name ASC`,
      [tenantId]
    );
    const allUsers = allUsersRes.rows;

    return res.rows.map((row) => {
      const branchMembers: BranchMember[] = allUsers
        .filter((u) => {
          if (u.branch_id === row.id) return true;
          if (Array.isArray(u.assigned_branch_ids) && u.assigned_branch_ids.includes(row.id)) return true;
          if (typeof u.assigned_branch_ids === 'string' && u.assigned_branch_ids.includes(row.id)) return true;
          return false;
        })
        .map((r) => ({
          id: r.id,
          email: r.email,
          fullName: r.full_name,
          roles: r.roles || [],
          isActive: r.is_active,
          podId: r.pod_id,
          createdAt: r.created_at,
        }));

      return {
        id: row.id,
        name: row.name,
        code: row.code,
        city: row.city,
        state: row.state,
        country: row.country,
        market: row.market || 'INDIA',
        managerId: row.manager_id || null,
        managerName: row.manager_name || null,
        managerEmail: row.manager_email || null,
        isActive: row.is_active,
        allowNone: Boolean(row.allow_none),
        allowPods: row.allow_pods !== false,
        allowAll: row.allow_all !== false,
        allowUnassigned: row.allow_unassigned !== false,
        podDistributionStrategy: (row.pod_distribution_strategy || 'AUTO').toUpperCase() as 'AUTO' | 'MANUAL',
        requireAmJobApproval: row.require_am_job_approval !== false,
        requireJobApproval: row.require_job_approval !== false && row.require_am_job_approval !== false,
        rolesRequiringApproval: (() => {
          try {
            return typeof row.roles_requiring_approval === 'string'
              ? JSON.parse(row.roles_requiring_approval)
              : (row.roles_requiring_approval || ['ACCOUNT_MANAGER', 'BD', 'RECRUITER']);
          } catch {
            return ['ACCOUNT_MANAGER', 'BD', 'RECRUITER'];
          }
        })(),
        defaultJobApproverRole: row.default_job_approver_role || 'POD_LEAD',
        allowedJobApproverRoles: (() => {
          try {
            return typeof row.allowed_job_approver_roles === 'string'
              ? JSON.parse(row.allowed_job_approver_roles)
              : (row.allowed_job_approver_roles || ['POD_LEAD', 'DELIVERY_HEAD', 'PRIMARY_RECRUITER', 'BRANCH_ADMIN']);
          } catch {
            return ['POD_LEAD', 'DELIVERY_HEAD', 'PRIMARY_RECRUITER', 'BRANCH_ADMIN'];
          }
        })(),
        approvalRoutingMode: (row.approval_routing_mode || 'FLEXIBLE') as 'FLEXIBLE' | 'ENFORCE_DEFAULT',
        timezone: row.timezone || (row.market === 'US' || row.country === 'United States' ? 'America/New_York' : 'Asia/Kolkata'),
        workStartTime: row.work_start_time || '09:00',
        workEndTime: row.work_end_time || '18:00',
        workingDays: (() => {
          try {
            return typeof row.working_days === 'string'
              ? JSON.parse(row.working_days)
              : (row.working_days || ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday']);
          } catch {
            return ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
          }
        })(),
        shiftTiming: row.shift_timing || (row.market === 'US' ? 'US Shift' : 'General Shift'),
        breakDurationMinutes: Number(row.break_duration_minutes ?? 60),
        usersCount: branchMembers.length,
        jobsCount: row.jobs_count || 0,
        members: branchMembers,
        createdAt: row.created_at,
      };
    });
  }

  async findOne(id: string, tenantId: string): Promise<BranchResponse> {
    await this.ensureBranchSettingsColumns();
    const res = await this.db.query(
      `SELECT b.*,
              u.full_name AS manager_name,
              u.email AS manager_email,
              (SELECT COUNT(*)::int FROM jobs WHERE branch_id = b.id) as jobs_count
       FROM branches b
       LEFT JOIN users u ON u.id = b.manager_id
       WHERE b.id = $1 AND b.tenant_id = $2`,
      [id, tenantId]
    );

    if (res.rows.length === 0) {
      throw new NotFoundException(`Branch with ID "${id}" not found.`);
    }

    const members = await this.getMembers(id, tenantId);
    const row = res.rows[0];
    return {
      id: row.id,
      name: row.name,
      code: row.code,
      city: row.city,
      state: row.state,
      country: row.country,
      market: row.market || 'INDIA',
      managerId: row.manager_id || null,
      managerName: row.manager_name || null,
      managerEmail: row.manager_email || null,
      isActive: row.is_active,
      allowNone: Boolean(row.allow_none),
      allowPods: row.allow_pods !== false,
      allowAll: row.allow_all !== false,
      allowUnassigned: row.allow_unassigned !== false,
      podDistributionStrategy: (row.pod_distribution_strategy || 'AUTO').toUpperCase() as 'AUTO' | 'MANUAL',
      requireAmJobApproval: row.require_am_job_approval !== false,
      requireJobApproval: row.require_job_approval !== false && row.require_am_job_approval !== false,
      rolesRequiringApproval: (() => {
        try {
          return typeof row.roles_requiring_approval === 'string'
            ? JSON.parse(row.roles_requiring_approval)
            : (row.roles_requiring_approval || ['ACCOUNT_MANAGER', 'BD', 'RECRUITER']);
        } catch {
          return ['ACCOUNT_MANAGER', 'BD', 'RECRUITER'];
        }
      })(),
      defaultJobApproverRole: row.default_job_approver_role || 'POD_LEAD',
      allowedJobApproverRoles: (() => {
        try {
          return typeof row.allowed_job_approver_roles === 'string'
            ? JSON.parse(row.allowed_job_approver_roles)
            : (row.allowed_job_approver_roles || ['POD_LEAD', 'DELIVERY_HEAD', 'PRIMARY_RECRUITER', 'BRANCH_ADMIN']);
        } catch {
          return ['POD_LEAD', 'DELIVERY_HEAD', 'PRIMARY_RECRUITER', 'BRANCH_ADMIN'];
        }
      })(),
      approvalRoutingMode: (row.approval_routing_mode || 'FLEXIBLE') as 'FLEXIBLE' | 'ENFORCE_DEFAULT',
      timezone: row.timezone || (row.market === 'US' || row.country === 'United States' ? 'America/New_York' : 'Asia/Kolkata'),
      workStartTime: row.work_start_time || '09:00',
      workEndTime: row.work_end_time || '18:00',
      workingDays: (() => {
        try {
          return typeof row.working_days === 'string'
            ? JSON.parse(row.working_days)
            : (row.working_days || ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday']);
        } catch {
          return ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
        }
      })(),
      shiftTiming: row.shift_timing || (row.market === 'US' ? 'US Shift' : 'General Shift'),
      breakDurationMinutes: Number(row.break_duration_minutes ?? 60),
      usersCount: members.length,
      jobsCount: row.jobs_count || 0,
      members,
      createdAt: row.created_at,
    };
  }

  async update(id: string, dto: UpdateBranchDto, tenantId: string): Promise<BranchResponse> {
    await this.ensureBranchSettingsColumns();
    const existing = await this.findOne(id, tenantId);

    if (dto.name && dto.name.trim().toUpperCase() !== existing.name.toUpperCase()) {
      const nameCheck = await this.db.query(
        'SELECT 1 FROM branches WHERE tenant_id = $1 AND UPPER(name) = $2 AND id <> $3',
        [tenantId, dto.name.trim().toUpperCase(), id]
      );
      if (nameCheck.rows.length > 0) {
        throw new ConflictException(`A branch with the name "${dto.name}" already exists.`);
      }
    }

    const name = dto.name !== undefined ? dto.name.trim() : existing.name;
    const code = dto.code !== undefined ? dto.code.trim().toUpperCase() : existing.code;
    const city = dto.city !== undefined ? dto.city : existing.city;
    const state = dto.state !== undefined ? dto.state : existing.state;
    const country = dto.country !== undefined ? dto.country : existing.country;
    const market = dto.market !== undefined ? dto.market.trim().toUpperCase() : existing.market;
    const isActive = dto.isActive !== undefined ? dto.isActive : existing.isActive;
    const allowNone = dto.allowNone !== undefined ? dto.allowNone : existing.allowNone;
    const allowPods = dto.allowPods !== undefined ? dto.allowPods : existing.allowPods;
    const allowAll = dto.allowAll !== undefined ? dto.allowAll : existing.allowAll;
    const allowUnassigned = dto.allowUnassigned !== undefined ? dto.allowUnassigned : existing.allowUnassigned;
    const podDistributionStrategy = dto.podDistributionStrategy !== undefined ? dto.podDistributionStrategy : existing.podDistributionStrategy;
    const requireJobApproval = dto.requireJobApproval !== undefined 
      ? dto.requireJobApproval 
      : (dto.requireAmJobApproval !== undefined ? dto.requireAmJobApproval : existing.requireJobApproval);
    const requireAmJobApproval = requireJobApproval;
    const rolesRequiringApproval = dto.rolesRequiringApproval !== undefined
      ? JSON.stringify(dto.rolesRequiringApproval)
      : JSON.stringify(existing.rolesRequiringApproval || ['ACCOUNT_MANAGER', 'BD', 'RECRUITER']);
    const defaultJobApproverRole = dto.defaultJobApproverRole !== undefined ? dto.defaultJobApproverRole : existing.defaultJobApproverRole;
    const allowedJobApproverRoles = dto.allowedJobApproverRoles !== undefined
      ? JSON.stringify(dto.allowedJobApproverRoles)
      : JSON.stringify(existing.allowedJobApproverRoles || ['POD_LEAD', 'DELIVERY_HEAD', 'PRIMARY_RECRUITER', 'BRANCH_ADMIN']);
    const approvalRoutingMode = dto.approvalRoutingMode !== undefined ? dto.approvalRoutingMode : existing.approvalRoutingMode;
    const timezone = dto.timezone !== undefined ? dto.timezone : existing.timezone;
    const workStartTime = dto.workStartTime !== undefined ? dto.workStartTime : existing.workStartTime;
    const workEndTime = dto.workEndTime !== undefined ? dto.workEndTime : existing.workEndTime;
    const workingDays = dto.workingDays !== undefined ? JSON.stringify(dto.workingDays) : JSON.stringify(existing.workingDays);
    const shiftTiming = dto.shiftTiming !== undefined ? dto.shiftTiming : existing.shiftTiming;
    const breakDurationMinutes = dto.breakDurationMinutes !== undefined ? dto.breakDurationMinutes : existing.breakDurationMinutes;

    await this.db.query(
      `UPDATE branches
       SET name = $1, code = $2, city = $3, state = $4, country = $5, market = $6, is_active = $7,
           allow_none = $8, allow_pods = $9, allow_all = $10, allow_unassigned = $11, pod_distribution_strategy = $12,
           require_am_job_approval = $13, default_job_approver_role = $14,
           allowed_job_approver_roles = $15, approval_routing_mode = $16,
           require_job_approval = $17, roles_requiring_approval = $18,
           timezone = $19, work_start_time = $20, work_end_time = $21,
           working_days = $22, shift_timing = $23, break_duration_minutes = $24,
           updated_at = NOW()
       WHERE id = $25 AND tenant_id = $26`,
      [
        name, code, city, state, country, market, isActive,
        allowNone, allowPods, allowAll, allowUnassigned, podDistributionStrategy,
        requireAmJobApproval, defaultJobApproverRole,
        allowedJobApproverRoles, approvalRoutingMode,
        requireJobApproval, rolesRequiringApproval,
        timezone, workStartTime, workEndTime,
        workingDays, shiftTiming, breakDurationMinutes,
        id, tenantId
      ]
    );

    return this.findOne(id, tenantId);
  }

  async remove(id: string, tenantId: string) {
    await this.findOne(id, tenantId);
    await this.db.query('DELETE FROM branches WHERE id = $1 AND tenant_id = $2', [id, tenantId]);
    return { message: 'Branch deleted successfully.' };
  }

  async getMembers(branchId: string, tenantId: string): Promise<BranchMember[]> {
    const res = await this.db.query(
      `SELECT id, email, full_name, roles, is_active, pod_id, branch_id, assigned_branch_ids, created_at
       FROM users
       WHERE tenant_id = $1
         AND (
           branch_id = $2
           OR (assigned_branch_ids IS NOT NULL AND assigned_branch_ids::text LIKE '%' || $2 || '%')
         )
       ORDER BY full_name ASC`,
      [tenantId, branchId]
    );
    return res.rows.map(r => ({
      id: r.id,
      email: r.email,
      fullName: r.full_name,
      roles: r.roles || [],
      isActive: r.is_active,
      podId: r.pod_id,
      createdAt: r.created_at
    }));
  }

  async assignUser(branchId: string, userId: string, tenantId: string, roles?: string[], assignedBranchIds?: string[]) {
    await this.findOne(branchId, tenantId);
    const userRes = await this.db.query('SELECT 1 FROM users WHERE id = $1 AND tenant_id = $2', [userId, tenantId]);
    if (userRes.rows.length === 0) {
      throw new NotFoundException('User not found in tenant.');
    }
    const branchIds = (assignedBranchIds && Array.isArray(assignedBranchIds) && assignedBranchIds.length > 0)
      ? Array.from(new Set([branchId, ...assignedBranchIds]))
      : [branchId];

    if (roles && Array.isArray(roles) && roles.length > 0) {
      await this.db.query('UPDATE users SET branch_id = $1, assigned_branch_ids = $2, roles = $3 WHERE id = $4 AND tenant_id = $5', [branchId, branchIds, roles, userId, tenantId]);
    } else {
      await this.db.query('UPDATE users SET branch_id = $1, assigned_branch_ids = $2 WHERE id = $3 AND tenant_id = $4', [branchId, branchIds, userId, tenantId]);
    }
    return { message: 'User assigned to branch and roles updated successfully.' };
  }

  async updateManager(branchId: string, managerId: string | null, tenantId: string) {
    await this.findOne(branchId, tenantId);
    if (managerId) {
      const userRes = await this.db.query('SELECT 1 FROM users WHERE id = $1 AND tenant_id = $2', [managerId, tenantId]);
      if (userRes.rows.length === 0) {
        throw new NotFoundException('Selected manager user not found in tenant.');
      }
      const rolesRes = await this.db.query('SELECT roles, assigned_branch_ids FROM users WHERE id = $1', [managerId]);
      const currentRoles: string[] = rolesRes.rows[0]?.roles || [];
      const currentBranchIds: string[] = rolesRes.rows[0]?.assigned_branch_ids || [];
      const updatedBranchIds = Array.from(new Set([branchId, ...currentBranchIds]));

      if (!currentRoles.includes('BRANCH_ADMIN')) {
        const updatedRoles = [...currentRoles, 'BRANCH_ADMIN'];
        await this.db.query('UPDATE users SET roles = $1, branch_id = $2, assigned_branch_ids = $3 WHERE id = $4', [updatedRoles, branchId, updatedBranchIds, managerId]);
      } else {
        await this.db.query('UPDATE users SET branch_id = $1, assigned_branch_ids = $2 WHERE id = $3', [branchId, updatedBranchIds, managerId]);
      }
    }
    await this.db.query('UPDATE branches SET manager_id = $1 WHERE id = $2 AND tenant_id = $3', [managerId, branchId, tenantId]);
    return this.findOne(branchId, tenantId);
  }

  async getHierarchy(tenantId: string) {
    const tenantRes = await this.db.query(
      `SELECT t.id, t.name, COALESCE(t.domain, td.domain_name, 'deb') as domain
       FROM tenants t
       LEFT JOIN tenant_domains td ON td.tenant_id = t.id AND td.is_primary = TRUE
       WHERE t.id = $1 LIMIT 1`,
      [tenantId]
    );
    const tenant = tenantRes.rows[0];

    const branchesList = await this.findAll(tenantId);
    
    const branchesWithPods = await Promise.all(
      branchesList.map(async (b) => {
        const podsRes = await this.db.query(
          'SELECT id, name, code FROM pods WHERE branch_id = $1 AND tenant_id = $2',
          [b.id, tenantId]
        );
        const members = b.members || (await this.getMembers(b.id, tenantId));
        
        return {
          ...b,
          pods: podsRes.rows || [],
          members,
        };
      })
    );

    return {
      tenant: tenant || { name: 'Tenant HQ', domain: 'workspace' },
      branches: branchesWithPods,
    };
  }
}
