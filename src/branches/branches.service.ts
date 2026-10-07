import { Injectable, Logger, NotFoundException, BadRequestException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateBranchDto } from './dtos/create-branch.dto';
import { UpdateBranchDto } from './dtos/update-branch.dto';

export interface BranchMember {
  id: string;
  email: string;
  fullName: string;
  roles: string[];
  isActive: boolean;
  podId: string | null;
  businessUnitId?: string | null;
  businessUnitName?: string | null;
  createdAt: string;
}

export interface BusinessUnitSummary {
  id: string;
  name: string;
  code: string | null;
  market: string;
  currency: string;
  shiftTiming: string | null;
  workStartTime: string | null;
  workEndTime: string | null;
  timezone: string | null;
  workingDays?: string[];
  breakDurationMinutes?: number;
  usersCount: number;
  jobsCount: number;
}

export interface BranchResponse {
  id: string;
  name: string;
  code: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  market: string;
  managers: { id: string; fullName: string; email: string }[];
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
  enableGlobalRemarks: boolean;
  selectedGlobalRemarkIds?: string | null;
  usersCount: number;
  jobsCount: number;
  podsCount: number;
  businessUnits?: BusinessUnitSummary[];
  members?: BranchMember[];
  createdAt: string;
}

@Injectable()
export class BranchesService {
  private readonly logger = new Logger(BranchesService.name);

  constructor(private readonly prisma: PrismaService) {}

  async findLocation(id: string, tenantId: string) {
    return this.prisma.branch.findFirst({ where: { id, tenantId },
      select: { id: true, name: true, code: true, city: true, country: true } });
  }

  private parseJsonArray(value: any, defaultValue: string[]): string[] {
    if (!value) return defaultValue;
    if (Array.isArray(value)) return value;
    if (typeof value === 'string') {
      try {
        const parsed = JSON.parse(value);
        return Array.isArray(parsed) ? parsed : defaultValue;
      } catch {
        return defaultValue;
      }
    }
    return defaultValue;
  }

  private formatBranch(b: any, members: BranchMember[] = []): BranchResponse {
    const podsCount = b._count?.pods ?? (Array.isArray(b.pods) ? b.pods.length : 0);
    const allowPods = podsCount > 0 ? (b.allowPods !== false) : false;

    const businessUnits: BusinessUnitSummary[] = Array.isArray(b.businessUnits)
      ? b.businessUnits.map((bu: any) => ({
          id: bu.id,
          name: bu.name,
          code: bu.code,
          market: bu.market,
          currency: bu.currency,
          shiftTiming: bu.shiftTiming || null,
          workStartTime: bu.workStartTime || null,
          workEndTime: bu.workEndTime || null,
          timezone: bu.timezone || null,
          workingDays: bu.workingDays || [],
          breakDurationMinutes: bu.breakDurationMinutes ?? 60,
          usersCount: bu._count?.users ?? bu.usersCount ?? 0,
          jobsCount: bu._count?.jobs ?? bu.jobsCount ?? 0,
        }))
      : [];

    return {
      id: b.id,
      name: b.name,
      code: b.code,
      city: b.city,
      state: b.state,
      country: b.country,
      market: b.market || 'INDIA',
      managers: b.users?.map(m => ({ id: m.id, fullName: m.fullName, email: m.email })) || [],
      isActive: b.isActive,
      allowNone: Boolean(b.allowNone),
      allowPods,
      allowAll: b.allowAll !== false,
      allowUnassigned: b.allowUnassigned !== false,
      podDistributionStrategy: (b.podDistributionStrategy || 'AUTO').toUpperCase() as 'AUTO' | 'MANUAL',
      requireAmJobApproval: b.requireAmJobApproval !== false,
      requireJobApproval: b.requireJobApproval !== false && b.requireAmJobApproval !== false,
      rolesRequiringApproval: this.parseJsonArray(b.rolesRequiringApproval, ['ACCOUNT_MANAGER', 'BD', 'RECRUITER']),
      defaultJobApproverRole: b.defaultJobApproverRole || 'POD_LEAD',
      allowedJobApproverRoles: this.parseJsonArray(b.allowedJobApproverRoles, ['POD_LEAD', 'DELIVERY_HEAD', 'PRIMARY_RECRUITER', 'BRANCH_ADMIN']),
      approvalRoutingMode: (b.approvalRoutingMode || 'FLEXIBLE') as 'FLEXIBLE' | 'ENFORCE_DEFAULT',
      timezone: b.timezone || (b.market === 'US' || b.country === 'United States' ? 'America/New_York' : 'Asia/Kolkata'),
      workStartTime: b.workStartTime || '09:00',
      workEndTime: b.workEndTime || '18:00',
      workingDays: this.parseJsonArray(b.workingDays, ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday']),
      shiftTiming: b.shiftTiming || (b.market === 'US' ? 'US Shift' : 'General Shift'),
      breakDurationMinutes: Number(b.breakDurationMinutes ?? 60),
      enableGlobalRemarks: Boolean(b.enableGlobalRemarks),
      selectedGlobalRemarkIds: b.selectedGlobalRemarkIds ?? 'ALL',
      usersCount: members.length,
      jobsCount: b._count?.jobs ?? b.jobsCount ?? 0,
      podsCount,
      businessUnits,
      members,
      createdAt: b.createdAt?.toISOString ? b.createdAt.toISOString() : String(b.createdAt),
    };
  }

  async create(dto: CreateBranchDto, tenantId: string): Promise<BranchResponse> {
    this.logger.log(`Creating branch "${dto.name}" for tenant ${tenantId}`);

    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { maxBranches: true },
    });
    const maxBranches = tenant?.maxBranches || 5;

    const currentBranchesCount = await this.prisma.branch.count({
      where: { tenantId },
    });

    if (currentBranchesCount >= maxBranches) {
      throw new BadRequestException(
        `Branch limit reached. Your subscription plan allows up to ${maxBranches} branches. Please upgrade your plan to add more branches.`
      );
    }

    const existing = await this.prisma.branch.findFirst({
      where: {
        tenantId,
        name: { equals: dto.name.trim(), mode: 'insensitive' },
      },
    });
    if (existing) {
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
    const enableGlobalRemarks = Boolean(dto.enableGlobalRemarks);

    const branch = await this.prisma.branch.create({
      data: {
        tenantId,
        name: dto.name.trim(),
        code,
        city: dto.city || null,
        state: dto.state || null,
        country: dto.country || 'India',
        market,
        timezone,
        workStartTime,
        workEndTime,
        workingDays,
        shiftTiming,
        breakDurationMinutes,
        enableGlobalRemarks,
      },
    });

    return this.findOne(branch.id, tenantId);
  }

  async findAll(tenantId: string): Promise<BranchResponse[]> {
    const [branches, allTenantUsers] = await Promise.all([
      this.prisma.branch.findMany({
        where: { tenantId },
        include: {
        users: {
            where: { customRole: { systemRole: { systemKey: 'BRANCH_ADMIN' } } },
            select: { id: true, fullName: true, email: true },
          },
          businessUnits: {
            include: {
              _count: { select: { users: true, } },
            },
            orderBy: { name: 'asc' },
          },
          _count: {
            select: {  pods: true },
          },
        },
        orderBy: { name: 'asc' },
      }),
      this.prisma.user.findMany({
        where: { tenantId, isActive: true },
        include: {
          customRole: {
            select: { name: true, systemRole: { select: { systemKey: true } } },
          },
          businessUnit: {
            select: { id: true, name: true },
          },
        },
        orderBy: { fullName: 'asc' },
      }),
    ]);

    return branches.map((b) => {
      const branchMembers: BranchMember[] = allTenantUsers
        .filter((u) => u.branchId === b.id)
        .map((u) => ({
          id: u.id,
          email: u.email,
          fullName: u.fullName,
          roles: [u.customRole?.name || u.customRole?.systemRole?.systemKey || 'RECRUITER'],
          isActive: u.isActive,
          podId: u.podId,
          businessUnitId: u.businessUnitId || null,
          businessUnitName: u.businessUnit?.name || null,
          createdAt: u.createdAt.toISOString(),
        }));

      return this.formatBranch(b, branchMembers);
    });
  }

  async getDelegationTargets(tenantId: string, sourceBranchId?: string) {
    return this.prisma.branch.findMany({
      where: { tenantId, ...(sourceBranchId ? { id: { not: sourceBranchId } } : {}) },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    });
  }

  async findOne(id: string, tenantId: string): Promise<BranchResponse> {
    const branch = await this.prisma.branch.findFirst({
      where: { id, tenantId },
      include: {
        users: {
            where: { customRole: { systemRole: { systemKey: 'BRANCH_ADMIN' } } },
            select: { id: true, fullName: true, email: true },
          },
        businessUnits: {
          include: {
            _count: { select: { users: true, } },
          },
          orderBy: { name: 'asc' },
        },
        _count: {
          select: {  pods: true },
        },
      },
    });

    if (!branch) {
      throw new NotFoundException(`Branch with ID "${id}" not found.`);
    }

    const members = await this.getMembers(id, tenantId);
    return this.formatBranch(branch, members);
  }

  async update(id: string, dto: UpdateBranchDto, tenantId: string): Promise<BranchResponse> {
    const existing = await this.findOne(id, tenantId);

    if (dto.name && dto.name.trim().toUpperCase() !== existing.name.toUpperCase()) {
      const nameCheck = await this.prisma.branch.findFirst({
        where: {
          tenantId,
          name: { equals: dto.name.trim(), mode: 'insensitive' },
          id: { not: id },
        },
      });
      if (nameCheck) {
        throw new ConflictException(`A branch with the name "${dto.name}" already exists.`);
      }
    }

    const name = dto.name !== undefined ? dto.name.trim() : existing.name;
    const code = dto.code !== undefined ? dto.code.trim().toUpperCase() : existing.code;
    const city = dto.city !== undefined ? dto.city : existing.city;
    const state = dto.state !== undefined ? dto.state : existing.state;
    const country = (dto.country !== undefined ? dto.country : existing.country) || 'India';
    const market = dto.market !== undefined ? dto.market.trim().toUpperCase() : existing.market;
    const isActive = dto.isActive !== undefined ? dto.isActive : existing.isActive;
    const allowNone = dto.allowNone !== undefined ? dto.allowNone : existing.allowNone;
    let allowPods = dto.allowPods !== undefined ? dto.allowPods : existing.allowPods;
    if (allowNone) {
      allowPods = false;
    }

    if (allowPods) {
      const podsCount = await this.prisma.pod.count({
        where: { branchId: id, tenantId },
      });
      if (podsCount === 0) {
        throw new BadRequestException(
          'Recruitment Pod System cannot be enabled: No recruitment pods have been created for this branch yet. Please create a pod first.'
        );
      }
    }

    const allowAll = dto.allowAll !== undefined ? dto.allowAll : existing.allowAll;
    const allowUnassigned = dto.allowUnassigned !== undefined ? dto.allowUnassigned : existing.allowUnassigned;
    const podDistributionStrategy = dto.podDistributionStrategy !== undefined ? dto.podDistributionStrategy : existing.podDistributionStrategy;
    const requireJobApproval =
      dto.requireJobApproval !== undefined
        ? dto.requireJobApproval
        : dto.requireAmJobApproval !== undefined
        ? dto.requireAmJobApproval
        : existing.requireJobApproval;
    const requireAmJobApproval = requireJobApproval;
    const rolesRequiringApproval =
      dto.rolesRequiringApproval !== undefined
        ? JSON.stringify(dto.rolesRequiringApproval)
        : JSON.stringify(existing.rolesRequiringApproval || ['ACCOUNT_MANAGER', 'BD', 'RECRUITER']);
    const defaultJobApproverRole = dto.defaultJobApproverRole !== undefined ? dto.defaultJobApproverRole : existing.defaultJobApproverRole;
    const allowedJobApproverRoles =
      dto.allowedJobApproverRoles !== undefined
        ? JSON.stringify(dto.allowedJobApproverRoles)
        : JSON.stringify(existing.allowedJobApproverRoles || ['POD_LEAD', 'DELIVERY_HEAD', 'PRIMARY_RECRUITER', 'BRANCH_ADMIN']);
    const approvalRoutingMode = dto.approvalRoutingMode !== undefined ? dto.approvalRoutingMode : existing.approvalRoutingMode;
    const timezone = dto.timezone !== undefined ? dto.timezone : existing.timezone;
    const workStartTime = dto.workStartTime !== undefined ? dto.workStartTime : existing.workStartTime;
    const workEndTime = dto.workEndTime !== undefined ? dto.workEndTime : existing.workEndTime;
    const workingDays = dto.workingDays !== undefined ? JSON.stringify(dto.workingDays) : JSON.stringify(existing.workingDays);
    const shiftTiming = dto.shiftTiming !== undefined ? dto.shiftTiming : existing.shiftTiming;
    const breakDurationMinutes = dto.breakDurationMinutes !== undefined ? dto.breakDurationMinutes : existing.breakDurationMinutes;
    const enableGlobalRemarks = dto.enableGlobalRemarks !== undefined ? Boolean(dto.enableGlobalRemarks) : existing.enableGlobalRemarks;

    await this.prisma.branch.update({
      where: { id },
      data: {
        name,
        code,
        city,
        state,
        country,
        market,
        isActive,
        allowNone,
        allowPods,
        allowAll,
        allowUnassigned,
        podDistributionStrategy,
        requireAmJobApproval,
        requireJobApproval,
        rolesRequiringApproval,
        defaultJobApproverRole,
        allowedJobApproverRoles,
        approvalRoutingMode,
        timezone,
        workStartTime,
        workEndTime,
        workingDays,
        shiftTiming,
        breakDurationMinutes,
        enableGlobalRemarks,
      },
    });

    return this.findOne(id, tenantId);
  }

  async toggleGlobalRemarks(id: string, tenantId: string, enabled?: boolean, selectedGlobalRemarkIds?: string): Promise<BranchResponse> {
    const existing = await this.findOne(id, tenantId);
    const nextState = enabled !== undefined ? Boolean(enabled) : !existing.enableGlobalRemarks;

    const data: any = { enableGlobalRemarks: nextState };
    if (selectedGlobalRemarkIds !== undefined) {
      data.selectedGlobalRemarkIds = selectedGlobalRemarkIds;
    }

    await this.prisma.branch.update({
      where: { id },
      data,
    });
    return this.findOne(id, tenantId);
  }

  async remove(id: string, tenantId: string) {
    const existing = await this.findOne(id, tenantId);

    const totalBranches = await this.prisma.branch.count({ where: { tenantId } });
    if (totalBranches <= 1) {
      throw new BadRequestException('Cannot delete the primary/only branch of your company workspace.');
    }

    const [usersCount, jobsCount, podsCount] = await Promise.all([
      this.prisma.user.count({ where: { branchId: id } }),
      this.prisma.job.count({ where: { branchId: id } }),
      this.prisma.pod.count({ where: { branchId: id } }),
    ]);

    if (usersCount > 0 || jobsCount > 0 || podsCount > 0) {
      throw new BadRequestException(
        `Cannot delete branch "${existing.name}". It currently has ${usersCount} assigned user(s), ${jobsCount} job(s), and ${podsCount} pod(s). Reassign or archive them before deleting this branch.`
      );
    }

    await this.prisma.branch.delete({ where: { id } });
    return { message: 'Branch deleted successfully.' };
  }

  async getMembers(branchId: string, tenantId: string, businessUnitId?: string): Promise<BranchMember[]> {
    const users = await this.prisma.user.findMany({
      where: {
        tenantId,
        isActive: true,
        branchId,
        ...(businessUnitId ? { businessUnitId } : {}),
      },
      include: {
        customRole: {
          select: { name: true, systemRole: { select: { systemKey: true } } },
        },
        businessUnit: {
          select: { id: true, name: true },
        },
      },
      orderBy: { fullName: 'asc' },
    });

    return users.map((u) => ({
      id: u.id,
      email: u.email,
      fullName: u.fullName,
      roles: [u.customRole?.name || u.customRole?.systemRole?.systemKey || 'RECRUITER'],
      isActive: u.isActive,
      podId: u.podId,
      businessUnitId: u.businessUnitId || null,
      businessUnitName: u.businessUnit?.name || null,
      createdAt: u.createdAt.toISOString(),
    }));
  }

  async assignUser(branchId: string, userId: string, tenantId: string, roles?: string[], businessUnitId?: string) {
    await this.findOne(branchId, tenantId);
    const user = await this.prisma.user.findFirst({
      where: { id: userId, tenantId },
    });
    if (!user) {
      throw new NotFoundException('User not found in tenant.');
    }

    let targetUnitId = businessUnitId;
    if (targetUnitId) {
      const bu = await this.prisma.businessUnit.findFirst({
        where: { id: targetUnitId, tenantId, branchId },
      });
      if (!bu) {
        throw new BadRequestException('Specified business unit does not belong to this branch.');
      }
    } else if (!user.businessUnitId || user.branchId !== branchId) {
      const firstBu = await this.prisma.businessUnit.findFirst({
        where: { tenantId, branchId },
        orderBy: { createdAt: 'asc' },
      });
      if (firstBu) {
        targetUnitId = firstBu.id;
      }
    }

    const updateData: any = {
      branchId,
      ...(targetUnitId ? { businessUnitId: targetUnitId } : {}),
    };

    if (roles && Array.isArray(roles) && roles.length > 0) {
      const customRoles = await this.prisma.customRole.findMany({
        where: {
          tenantId,
          OR: [
            { name: { in: roles } },
            { id: { in: roles.filter((r) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(r)) } },
            { systemRole: { systemKey: { in: roles } } },
          ],
        },
        orderBy: [
          { isSystem: 'asc' },
          { createdAt: 'desc' },
        ],
      });

      const roleIds = customRoles.map((r) => r.id);
      const roleId = roleIds[0] || null;

      if (roleId) {
        updateData.roleId = roleId;
        updateData.assignedRoleIds = roleIds;
      }
    }

    await this.prisma.user.update({
      where: { id: userId },
      data: updateData,
    });

    return { message: 'User assigned to branch and unit successfully.' };
  }

  async updateManagers(branchId: string, managerIds: string[], tenantId: string) {
    await this.findOne(branchId, tenantId);

    if (managerIds && managerIds.length > 0) {
      const mgrs = await this.prisma.user.findMany({
        where: { id: { in: managerIds }, tenantId },
      });
      if (mgrs.length !== managerIds.length) {
        throw new NotFoundException('Some selected manager users were not found in tenant.');
      }

      const branchAdminRole = await this.prisma.customRole.findFirst({
        where: {
          tenantId,
          OR: [{ branchId }, { branchId: null }],
          AND: [
            {
              OR: [
                { systemRole: { systemKey: 'BRANCH_ADMIN' } },
                { name: { in: ['BRANCH_ADMIN', 'Branch Admin', 'BRANCH ADMIN'], mode: 'insensitive' } },
              ],
            },
          ],
        },
        orderBy: [
          { isSystem: 'asc' },
          { createdAt: 'asc' },
        ],
      });

      for (const mgr of mgrs) {
        const updatedRoleIds = branchAdminRole?.id
          ? Array.from(new Set([...(mgr.assignedRoleIds || []), branchAdminRole.id]))
          : (mgr.assignedRoleIds || []);

        await this.prisma.user.update({
          where: { id: mgr.id },
          data: {
            branchId,
            assignedRoleIds: updatedRoleIds,
            ...(branchAdminRole?.id ? { roleId: branchAdminRole.id } : {}),
          },
        });
      }
    }

    await this.prisma.branch.update({
      where: { id: branchId },
      data: { 
        managers: {
          set: managerIds.map(id => ({ id }))
        }
      },
    });

    return this.findOne(branchId, tenantId);
  }

  async getHierarchy(tenantId: string) {
    try {
      const [tenant, branchesList, pods] = await Promise.all([
        this.prisma.tenant.findUnique({
          where: { id: tenantId },
          select: { id: true, name: true, domain: true },
        }),
        this.findAll(tenantId),
        this.prisma.pod.findMany({
          where: { tenantId },
          select: { id: true, name: true, branchId: true },
        }),
      ]);

      const podsByBranch = new Map<string, any[]>();
      pods.forEach((p) => {
        if (p.branchId) {
          const list = podsByBranch.get(p.branchId) || [];
          list.push(p);
          podsByBranch.set(p.branchId, list);
        }
      });

      const branchesWithPods = branchesList.map((b) => ({
        ...b,
        pods: podsByBranch.get(b.id) || [],
      }));

      return {
        tenant: tenant || { name: 'Tenant HQ', domain: 'workspace' },
        branches: branchesWithPods,
      };
    } catch (err) {
      this.logger.error('Error in getHierarchy:', err);
      return {
        tenant: { name: 'Tenant HQ', domain: 'workspace' },
        branches: [],
      };
    }
  }
}
