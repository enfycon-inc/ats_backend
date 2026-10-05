import { Injectable, Logger, NotFoundException, ConflictException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateBusinessUnitDto } from './dtos/create-business-unit.dto';
import { UpdateBusinessUnitDto } from './dtos/update-business-unit.dto';

// Shared by the picker and submission so a forged target cannot bypass eligibility.
export async function delegationTargets(prisma: PrismaService, user: any, jobId: string, tenantId: string) {
  if (!user?.permissions?.includes('job:delegate')) throw new ForbiddenException('Missing job:delegate permission.');
  if (!jobId) throw new BadRequestException('jobId is required.');
  const job = await prisma.job.findFirst({ where: { id: jobId, tenantId },  });
  if (!job) throw new NotFoundException('Job not found.');
  if (!job.branchId) throw new BadRequestException('Assign the job to a branch before delegating.');
  const tenantManager = user.permissions.some((p: string) => ['tenant:manage', 'tenant:settings', 'platform:manage'].includes(p));
  if (!tenantManager && (!user.branchId || user.branchId !== job.branchId)) throw new ForbiddenException('You can only delegate jobs from your branch.');
  const segmentId = null;
  if (!segmentId) throw new BadRequestException('Assign the job to an operating unit with a market segment before delegating.');
  const units = await prisma.businessUnit.findMany({
    where: { tenantId, marketSegmentId: segmentId,  branchId: { not: job.branchId! }, branch: { tenantId } },
    include: { marketSegment: true, branch: { select: { id: true, name: true } } },
    orderBy: { name: 'asc' },
  });
  return units.map(u => ({ id: u.id, name: u.name, branchId: u.branchId, branchName: u.branch?.name,
    marketSegmentId: u.marketSegmentId, market: u.marketSegment?.code, branch: u.branch }));
}

export interface BusinessUnitResponse {
  id: string;
  name: string;
  code: string | null;
  market: string;
  currency: string;
  branchId: string | null;
  branchName: string | null;
  branch?: {
    id: string;
    name: string;
    code: string | null;
    city: string | null;
    
  } | null;
  shiftTiming: string | null;
  workStartTime: string | null;
  workEndTime: string | null;
  timezone: string | null;
  workingDays?: string[];
  breakDurationMinutes?: number | null;
  admins?: { id: string; fullName: string; email: string }[];
  allowNone: boolean;
  allowPods: boolean;
  allowAll: boolean;
  allowUnassigned: boolean;
  podDistributionStrategy: string;
  usersCount: number;
  podsCount: number;
  createdAt: string;
}

@Injectable()
export class BusinessUnitsService {
  private readonly logger = new Logger(BusinessUnitsService.name);

  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateBusinessUnitDto, tenantId: string): Promise<BusinessUnitResponse> {
    this.logger.log(`Creating business unit "${dto.name}" for tenant ${tenantId}`);

    let branch: any = null;
    if (dto.branchId) {
      branch = await this.prisma.branch.findFirst({
        where: { id: dto.branchId, tenantId },
      });
      if (!branch) {
        throw new NotFoundException(`Branch with ID "${dto.branchId}" not found.`);
      }
    }

    const existing = await this.prisma.businessUnit.findFirst({
      where: {
        tenantId,
        ...(dto.branchId ? { branchId: dto.branchId } : {}),
        name: { equals: dto.name.trim(), mode: 'insensitive' },
      },
    });

    if (existing) {
      throw new ConflictException(`A business unit with the name "${dto.name}" already exists in this branch.`);
    }

    const code = dto.code ? dto.code.trim().toUpperCase() : dto.name.substring(0, 4).toUpperCase();
    const market = dto.market ? dto.market.trim().toUpperCase() : (branch?.market || 'US');
    const currency = dto.currency ? dto.currency.trim().toUpperCase() : (market === 'INDIA' ? 'INR' : 'USD');
    const shiftTiming = dto.shiftTiming || branch?.shiftTiming || (market === 'US' ? 'US Shift' : 'General Shift');
    const workStartTime = dto.workStartTime || branch?.workStartTime || '09:00';
    const workEndTime = dto.workEndTime || branch?.workEndTime || '18:00';
    const timezone = dto.timezone || branch?.timezone || (market === 'US' ? 'America/New_York' : 'Asia/Kolkata');
    const workingDays = dto.workingDays || ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
    const breakDurationMinutes = dto.breakDurationMinutes !== undefined ? dto.breakDurationMinutes : 60;
    const allowNone = dto.allowNone !== undefined ? dto.allowNone : false;
    const allowPods = dto.allowPods !== undefined ? dto.allowPods : true;
    const allowAll = dto.allowAll !== undefined ? dto.allowAll : true;
    const allowUnassigned = dto.allowUnassigned !== undefined ? dto.allowUnassigned : true;
    const podDistributionStrategy = dto.podDistributionStrategy || 'AUTO';

    const bu = await this.prisma.businessUnit.create({ // @ts-ignore

      data: {
        tenantId,
        ...(dto.branchId ? { branchId: dto.branchId } : {}),
          name: dto.name.trim(),
          code,

          ...((dto as any).marketSegmentId ? { marketSegmentId: (dto as any).marketSegmentId } : {}),
        jobCodePattern: (dto as any).jobCodePattern || null,
        shiftTiming,
        workStartTime,
        workEndTime,
        timezone,
        workingDays,
        breakDurationMinutes,
        allowNone,
        allowPods,
        allowAll,
        allowUnassigned,
        podDistributionStrategy,
      },
    });

    return this.findOne(bu.id, tenantId);
  }

  async findAll(tenantId: string, branchId?: string): Promise<BusinessUnitResponse[]> {
    const units = await this.prisma.businessUnit.findMany({
      where: {
        tenantId,
        ...(branchId ? { branchId } : {}),
      },
      include: {
        branch: {
          select: { id: true, name: true, code: true, city: true, country: true },
        },
        marketSegment: {
          select: { id: true, name: true, code: true },
        },
        _count: {
          select: {
            users: true,
            pods: true,
          },
        },
      },
      orderBy: { name: 'asc' },
    });

    return units.map((bu) => ({
      id: bu.id,
      name: bu.name,
      code: bu.code,
      market: (bu as any).marketSegment?.code || 'US',
      marketSegmentId: bu.marketSegmentId || null,
      marketSegment: (bu as any).marketSegment || null,
      jobCodePattern: bu.jobCodePattern || null,
      currency: (bu as any).marketSegment?.defaultCurrency || 'USD',
      branchId: bu.branchId || null,
      branchName: bu.branch?.name || null,
      branch: bu.branch
        ? {
            id: bu.id,
            name: bu.name,
            code: bu.code,
            city: bu.city,
          }
        : null,
      shiftTiming: bu.shiftTiming || null,
      workStartTime: bu.workStartTime || null,
      workEndTime: bu.workEndTime || null,
      timezone: bu.timezone || null,
      workingDays: bu.workingDays || [],
      breakDurationMinutes: bu.breakDurationMinutes ?? 60,
      allowNone: bu.allowNone ?? false,
      allowPods: bu.allowPods ?? true,
      allowAll: bu.allowAll ?? true,
      allowUnassigned: bu.allowUnassigned ?? true,
      podDistributionStrategy: bu.podDistributionStrategy || 'AUTO',
      usersCount: bu._count.users,
      podsCount: bu._count.pods,
      createdAt: bu.createdAt.toISOString(),
    }));
  }

  async findOne(id: string, tenantId: string): Promise<BusinessUnitResponse> {
    const bu = await this.prisma.businessUnit.findFirst({
      where: { id, tenantId },
      include: {
        branch: {
          select: { id: true, name: true, code: true, city: true, country: true },
        },
        marketSegment: {
          select: { id: true, name: true, code: true },
        },
        admins: {
          select: { id: true, fullName: true, email: true },
        },
        _count: {
          select: {
            users: true,
            pods: true,
          },
        },
      },
    });

    if (!bu) {
      throw new NotFoundException(`Business Unit with ID ${id} not found.`);
    }

    return {
      id: bu.id,
      name: bu.name,
      code: bu.code,
      market: (bu as any).marketSegment?.code || 'US',
      marketSegmentId: bu.marketSegmentId || null,
      marketSegment: (bu as any).marketSegment || null,
      jobCodePattern: bu.jobCodePattern || null,
      currency: (bu as any).marketSegment?.defaultCurrency || 'USD',
      branchId: bu.branchId || null,
      branchName: bu.branch?.name || null,
      branch: bu.branch
        ? {
            id: bu.id,
            name: bu.name,
            code: bu.code,
            city: bu.city,
          }
        : null,
      shiftTiming: bu.shiftTiming || null,
      workStartTime: bu.workStartTime || null,
      workEndTime: bu.workEndTime || null,
      timezone: bu.timezone || null,
      workingDays: bu.workingDays || [],
      breakDurationMinutes: bu.breakDurationMinutes ?? 60,
      allowNone: bu.allowNone ?? false,
      allowPods: bu.allowPods ?? true,
      allowAll: bu.allowAll ?? true,
      allowUnassigned: bu.allowUnassigned ?? true,
      podDistributionStrategy: bu.podDistributionStrategy || 'AUTO',
      usersCount: bu._count.users,
      podsCount: bu._count.pods,
      admins: (bu as any).admins || [],
      createdAt: bu.createdAt.toISOString(),
    } as any;
  }

  async update(id: string, dto: UpdateBusinessUnitDto, tenantId: string): Promise<BusinessUnitResponse> {
    const existing = await this.findOne(id, tenantId);
    const targetBranchId = dto.branchId !== undefined ? dto.branchId : existing.branchId;

    if (dto.name && dto.name.trim().toUpperCase() !== existing.name.toUpperCase()) {
      const conflict = await this.prisma.businessUnit.findFirst({
        where: {
          tenantId,
          ...(targetBranchId ? { branchId: targetBranchId } : {}),
          name: { equals: dto.name.trim(), mode: 'insensitive' },
          id: { not: id },
        },
      });

      if (conflict) {
        throw new ConflictException(`A business unit with the name "${dto.name}" already exists in this branch.`);
      }
    }

    const name = dto.name !== undefined ? dto.name.trim() : existing.name;
    const code = dto.code !== undefined ? dto.code.trim().toUpperCase() : existing.code;
    const market = dto.market !== undefined ? dto.market.trim().toUpperCase() : ((existing as any).marketSegment?.code || 'US');
    const currency = dto.currency !== undefined ? dto.currency.trim().toUpperCase() : ((existing as any).marketSegment?.defaultCurrency || 'USD');
    const shiftTiming = dto.shiftTiming !== undefined ? dto.shiftTiming : existing.shiftTiming;
    const workStartTime = dto.workStartTime !== undefined ? dto.workStartTime : existing.workStartTime;
    const workEndTime = dto.workEndTime !== undefined ? dto.workEndTime : existing.workEndTime;
    const timezone = dto.timezone !== undefined ? dto.timezone : existing.timezone;
    const workingDays = dto.workingDays !== undefined ? dto.workingDays : existing.workingDays;
    const breakDurationMinutes = dto.breakDurationMinutes !== undefined ? dto.breakDurationMinutes : existing.breakDurationMinutes;
    const allowNone = dto.allowNone !== undefined ? dto.allowNone : existing.allowNone;
    const allowPods = dto.allowPods !== undefined ? dto.allowPods : existing.allowPods;
    const allowAll = dto.allowAll !== undefined ? dto.allowAll : existing.allowAll;
    const allowUnassigned = dto.allowUnassigned !== undefined ? dto.allowUnassigned : existing.allowUnassigned;
    const podDistributionStrategy = dto.podDistributionStrategy !== undefined ? dto.podDistributionStrategy : existing.podDistributionStrategy;

    await this.prisma.businessUnit.update({ // @ts-ignore

      where: { id },
      data: {
        ...(dto.branchId !== undefined ? { branchId: dto.branchId || null } : {}),
          ...((dto as any).marketSegmentId !== undefined ? { marketSegmentId: (dto as any).marketSegmentId || null } : {}),
        ...((dto as any).jobCodePattern !== undefined ? { jobCodePattern: (dto as any).jobCodePattern || null } : {}),
        name,
        code,
        shiftTiming,
        workStartTime,
        workEndTime,
        timezone,
        workingDays,
        breakDurationMinutes,
        allowNone,
        allowPods,
        allowAll,
        allowUnassigned,
        podDistributionStrategy,
      },
    });

    return this.findOne(id, tenantId);
  }

  async getDelegationTargets(user: any, jobId: string, tenantId: string) {
    return delegationTargets(this.prisma, user, jobId, tenantId);
  }

  async remove(id: string, tenantId: string) {
    const existing = await this.findOne(id, tenantId);

    if (existing.usersCount > 0 ) {
      throw new BadRequestException(
        `Cannot delete business unit "${existing.name}". It currently has ${existing.usersCount} assigned member(s) . Reassign them before deleting this unit.`
      );
    }

    await this.prisma.businessUnit.delete({
      where: { id },
    });
    return { message: 'Business Unit deleted successfully.' };
  }

  async getMembers(unitId: string, tenantId: string) {
    await this.findOne(unitId, tenantId);

    const members = await this.prisma.user.findMany({
      where: {
        tenantId,
        businessUnitId: unitId,
      },
      select: {
        id: true,
        email: true,
        fullName: true,
        firstName: true,
        lastName: true,
        profilePicture: true,
        isActive: true,
        branchId: true,
        branch: {
          select: { id: true, name: true, city: true },
        },
        customRole: {
          select: { id: true, name: true, systemRole: { select: { systemKey: true } } },
        },
        pod: {
          select: { id: true, name: true },
        },
      },
      orderBy: { fullName: 'asc' },
    });

    return members.map((m) => ({
      id: m.id,
      email: m.email,
      fullName: m.fullName,
      firstName: m.firstName,
      lastName: m.lastName,
      profilePicture: m.profilePicture,
      isActive: m.isActive,
      branchId: m.branchId,
      branchName: m.branch?.name || null,
      roleName: m.customRole?.name || 'Recruiter',
      systemRole: m.customRole?.systemRole?.systemKey || null,
      podId: m.pod?.id || null,
      podName: m.pod?.name || null,
    }));
  }

  async getCandidateStaff(unitId: string, tenantId: string) {
    const unit = await this.findOne(unitId, tenantId);

    const users = await this.prisma.user.findMany({
      where: {
        tenantId,
        isActive: true,
      },
      select: {
        id: true,
        email: true,
        fullName: true,
        firstName: true,
        lastName: true,
        profilePicture: true,
        isActive: true,
        branchId: true,
        businessUnitId: true,
        branch: {
          select: { id: true, name: true, city: true },
        },
        businessUnit: {
          select: { id: true, name: true, code: true },
        },
        customRole: {
          select: { id: true, name: true, systemRole: { select: { systemKey: true } } },
        },
        pod: {
          select: { id: true, name: true },
        },
      },
      orderBy: [{ fullName: 'asc' }],
    });

    return users.map((u) => ({
      id: u.id,
      email: u.email,
      fullName: u.fullName,
      firstName: u.firstName,
      lastName: u.lastName,
      profilePicture: u.profilePicture,
      isActive: u.isActive,
      branchId: u.branchId,
      branchName: u.branch?.name || null,
      currentUnitId: u.businessUnitId,
      currentUnitName: u.businessUnit?.name || null,
      roleName: u.customRole?.name || 'Recruiter',
      systemRole: u.customRole?.systemRole?.systemKey || null,
      podName: u.pod?.name || null,
      isAssigned: u.businessUnitId === unitId,
      isSameBranch: unit.branchId ? u.branchId === unit.branchId : true,
    }));
  }

  async assignMembers(unitId: string, userIds: string[], tenantId: string) {
    const unit = await this.prisma.businessUnit.findFirst({
      where: { id: unitId, tenantId },
    });

    if (!unit) {
      throw new NotFoundException(`Operating Unit with ID ${unitId} not found.`);
    }

    // 1. Unassign users currently in this unit who are not in userIds
    await this.prisma.user.updateMany({
      where: {
        tenantId,
        businessUnitId: unitId,
        id: { notIn: userIds },
      },
      data: {
        businessUnitId: null,
      },
    });

    // 2. Assign selected userIds to this unit
    if (userIds.length > 0) {
      await this.prisma.user.updateMany({
        where: {
          tenantId,
          id: { in: userIds },
        },
        data: {
          businessUnitId: unit.id,
          ...(unit.branchId ? { branchId: unit.branchId } : {}),
        },
      });
    }

    return this.getMembers(unitId, tenantId);
  }

  async removeMember(unitId: string, userId: string, tenantId: string) {
    await this.prisma.user.updateMany({
      where: {
        id: userId,
        businessUnitId: unitId,
        tenantId,
      },
      data: {
        businessUnitId: null,
      },
    });
    return { message: 'Member unassigned successfully.' };
  }

  async updateAdmins(unitId: string, adminIds: string[], tenantId: string) {
    await this.findOne(unitId, tenantId);

    if (adminIds && adminIds.length > 0) {
      const admins = await this.prisma.user.findMany({
        where: { id: { in: adminIds }, tenantId },
      });
      if (admins.length !== adminIds.length) {
        throw new NotFoundException('Some selected admin users were not found in tenant.');
      }

      const unitAdminRole = await this.prisma.customRole.findFirst({
        where: {
          tenantId,
          AND: [
            {
              OR: [
                { systemRole: { systemKey: 'UNIT_ADMIN' } },
                { name: { in: ['UNIT_ADMIN', 'Unit Admin', 'UNIT ADMIN'], mode: 'insensitive' } },
              ],
            },
          ],
        },
        orderBy: [
          { isSystem: 'asc' },
          { createdAt: 'asc' },
        ],
      });

      for (const adm of admins) {
        const updatedRoleIds = unitAdminRole?.id
          ? Array.from(new Set([...(adm.assignedRoleIds || []), unitAdminRole.id]))
          : (adm.assignedRoleIds || []);

        await this.prisma.user.update({
          where: { id: adm.id },
          data: {
            businessUnitId: unitId,
            assignedRoleIds: updatedRoleIds,
            ...(unitAdminRole?.id ? { roleId: unitAdminRole.id } : {}),
          },
        });
      }
    }

    await this.prisma.businessUnit.update({ // @ts-ignore

      where: { id: unitId },
      data: { 
        admins: {
          set: adminIds.map(id => ({ id }))
        }
      },
    });

    return this.findOne(unitId, tenantId);
  }
}

