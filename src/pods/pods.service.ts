import {
  Injectable,
  Logger,
  NotFoundException,
  ConflictException,
  BadRequestException,
  ForbiddenException,
  Optional,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreatePodDto } from './dtos/create-pod.dto';
import { UpdatePodDto } from './dtos/update-pod.dto';
import type { AuthUser } from '../auth/interfaces/auth-user.interface';
import { AuthEmailService } from '../auth/services/auth-email.service';

export interface PodMember {
  avatar?: string | null;
  profilePicture?: string | null;
  id: string;
  fullName: string;
  email: string;
  systemRole: string;
}

export interface PodResponse {
  id: string;
  name: string;
  branchId: string | null;
  branchName: string | null;
  businessUnitId: string | null;
  businessUnitName: string | null;
  podHeadId: string | null;
  podHeadName: string | null;
  description: string | null;
  isAvailableForAssignment: boolean;
  members: PodMember[];
  jobsCount: number;
  createdAt: string;
}

@Injectable()
export class PodsService {
  private readonly logger = new Logger(PodsService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly emailService?: AuthEmailService,
  ) {}

  private async notifyPodLeadAssigned(params: {
    podHeadId: string;
    podName: string;
    tenantId: string;
    branchId?: string | null;
    businessUnitId?: string | null;
  }) {
    if (!this.emailService) return;
    try {
      const [user, tenant, branch, unit] = await Promise.all([
        this.prisma.user.findFirst({
          where: { id: params.podHeadId, tenantId: params.tenantId },
          select: { email: true, fullName: true },
        }),
        this.prisma.tenant.findFirst({
          where: { id: params.tenantId },
          select: { name: true, domain: true },
        }),
        params.branchId
          ? this.prisma.branch.findFirst({
              where: { id: params.branchId, tenantId: params.tenantId },
              select: { name: true },
            })
          : Promise.resolve(null),
        params.businessUnitId
          ? this.prisma.businessUnit.findFirst({
              where: { id: params.businessUnitId, tenantId: params.tenantId },
              select: { name: true },
            })
          : Promise.resolve(null),
      ]);

      if (!user?.email || !tenant?.name) return;

      await this.emailService.sendPodLeadAssignedEmail({
        tenantId: params.tenantId,
        to: user.email,
        fullName: user.fullName || 'Team Member',
        tenantName: tenant.name,
        subdomain: tenant.domain || '',
        podName: params.podName,
        branchName: branch?.name,
        unitName: unit?.name,
      });
    } catch (err: any) {
      this.logger.warn(`Failed to send Pod Lead assignment email: ${err?.message}`);
    }
  }

  /**
   * Helper: Promotes a user to the POD_LEAD-archetype role for their branch.
   * Finds any custom role whose systemRole = 'POD_LEAD' — regardless of display name
   * (e.g. "Team Lead", "Pod Head", "Senior Recruiter" etc.).
   * Prefers the branch-specific role if one exists.
   */
  private async promoteToPodHead(userId: string, tenantId: string, branchId?: string | null, txClient?: any) {
    const db = txClient || this.prisma;
    let effectiveBranchId = branchId;
    if (!effectiveBranchId) {
      const user = await db.user.findFirst({
        where: { id: userId },
        select: { branchId: true, assignedRoleIds: true },
      });
      effectiveBranchId = user?.branchId || null;
    }

    let role: { id: string } | null = null;
    if (effectiveBranchId) {
      role = await db.customRole.findFirst({
        where: { tenantId, branchId: effectiveBranchId, systemRole: { systemKey: 'POD_LEAD' } },
        select: { id: true },
      });
    }

    if (!role) {
      role = await db.customRole.findFirst({
        where: { tenantId, systemRole: { systemKey: 'POD_LEAD' } },
        select: { id: true },
        orderBy: { createdAt: 'asc' },
      });
    }

    if (!role) {
      this.logger.warn(
        `No custom role with systemRole=POD_LEAD found for tenant ${tenantId} (branch: ${effectiveBranchId}). Skipping auto-promotion.`,
      );
      return;
    }

    const userForRoles = await db.user.findFirst({
      where: { id: userId },
      select: { assignedRoleIds: true },
    });
    const currentRoles = Array.isArray(userForRoles?.assignedRoleIds) ? userForRoles.assignedRoleIds : [];
    const newAssignedRoleIds = Array.from(new Set([...currentRoles, role.id]));

    await db.user.update({
      where: { id: userId },
      data: {
        roleId: role.id,
        assignedRoleIds: newAssignedRoleIds,
      },
    });

    this.logger.log(`Promoted user ${userId} to POD_LEAD role (id: ${role.id}).`);
  }

  /**
   * Helper: Demotes a user back to RECRUITER-archetype role when they are no longer a pod head.
   * Finds any custom role whose systemRole = 'RECRUITER' — regardless of display name.
   * Strips all custom roles whose systemRole = 'POD_LEAD' from user.assignedRoleIds and user.roleId.
   * Prefers the branch-specific role if one exists.
   */
  private async demoteFromPodHead(userId: string, tenantId: string, txClient?: any, excludePodId?: string) {
    const db = txClient || this.prisma;
    const otherPods = await db.pod.findFirst({
      where: {
        podHeadId: userId,
        tenantId,
        ...(excludePodId ? { id: { not: excludePodId } } : {}),
      },
      select: { id: true },
    });

    if (otherPods) {
      return;
    }

    const user = await db.user.findFirst({
      where: { id: userId, tenantId },
      select: { roleId: true, branchId: true, assignedRoleIds: true },
    });
    if (!user) return;
    const branchId = user.branchId || null;

    // Find all custom roles in this tenant associated with POD_LEAD
    const podLeadRoles = await db.customRole.findMany({
      where: { tenantId, systemRole: { systemKey: 'POD_LEAD' } },
      select: { id: true },
    });
    const podLeadRoleIds = new Set<string>(podLeadRoles.map((r: any) => r.id));

    let recruiterRole: { id: string } | null = null;
    if (branchId) {
      recruiterRole = await db.customRole.findFirst({
        where: { tenantId, branchId, systemRole: { systemKey: 'RECRUITER' } },
        select: { id: true },
      });
    }

    if (!recruiterRole) {
      recruiterRole = await db.customRole.findFirst({
        where: { tenantId, systemRole: { systemKey: 'RECRUITER' } },
        select: { id: true },
        orderBy: { createdAt: 'asc' },
      });
    }

    if (!recruiterRole && podLeadRoleIds.size === 0) {
      this.logger.warn(
        `No custom role with systemRole=RECRUITER found for tenant ${tenantId}. Skipping auto-demotion.`,
      );
      return;
    }

    const currentRoles: string[] = Array.isArray(user.assignedRoleIds) ? user.assignedRoleIds : [];
    // Cleanly filter out all POD_LEAD roles
    const filteredRoles = currentRoles.filter((rid: string) => !podLeadRoleIds.has(rid));

    if (recruiterRole && !filteredRoles.includes(recruiterRole.id)) {
      filteredRoles.push(recruiterRole.id);
    }

    let newRoleId = user.roleId;
    if (!newRoleId || podLeadRoleIds.has(newRoleId)) {
      newRoleId = recruiterRole?.id || filteredRoles[0] || null;
    }

    await db.user.update({
      where: { id: userId },
      data: {
        roleId: newRoleId,
        assignedRoleIds: filteredRoles,
      },
    });

    this.logger.log(`Demoted user ${userId} back to RECRUITER role (roleId: ${newRoleId}, assignedRoleIds: ${filteredRoles.join(', ')}).`);
  }

  /**
   * Helper: Validates that all candidate users for a pod:
   * 1. Exist, belong to the tenant, and are active/approved.
   * 2. Belong to the specified operating unit.
   * 3. Hold an eligible recruiter role archetype (NOT higher-privilege administrative roles).
   * 4. Are NOT currently assigned to another pod (podId IS NULL, or equals currentPodId if updating).
   */
  private async validateRecruiters(
    tx: any,
    userIds: string[],
    tenantId: string,
    businessUnitId: string,
    currentPodId?: string,
  ): Promise<void> {
    if (!userIds || userIds.length === 0) return;

    const users = await tx.user.findMany({
      where: { id: { in: userIds }, tenantId },
      include: {
        pod: { select: { id: true, name: true } },
        customRole: {
          select: {
            id: true,
            name: true,
            systemRole: { select: { systemKey: true } },
          },
        },
      },
    });

    if (users.length !== userIds.length) {
      const foundIds = new Set(users.map((u: any) => u.id));
      const missingId = userIds.find((id) => !foundIds.has(id));
      throw new NotFoundException(`User with ID ${missingId} not found in this organization.`);
    }

    // Collect all role IDs from users (both roleId and assignedRoleIds)
    const allRoleIds = new Set<string>();
    users.forEach((u: any) => {
      if (u.roleId) allRoleIds.add(u.roleId);
      if (Array.isArray(u.assignedRoleIds)) {
        u.assignedRoleIds.forEach((rid: string) => allRoleIds.add(rid));
      }
    });

    const customRoles = await tx.customRole.findMany({
      where: { id: { in: Array.from(allRoleIds) } },
      select: {
        id: true,
        name: true,
        systemRole: { select: { systemKey: true } },
      },
    });
    const roleMap = new Map<string, any>(customRoles.map((r: any) => [r.id, r]));

    for (const u of users) {
      if (!u.isActive || !u.isApproved) {
        throw new BadRequestException(`User "${u.fullName}" is not an active, approved staff member.`);
      }

      if (u.businessUnitId && u.businessUnitId !== businessUnitId) {
        throw new ConflictException(
          `User "${u.fullName}" belongs to a different operating unit. Only recruiters from this operating unit can be assigned.`,
        );
      }

      const userRoleIds = [
        u.roleId,
        ...(Array.isArray(u.assignedRoleIds) ? u.assignedRoleIds : []),
      ].filter(Boolean);
      const userRoles = userRoleIds.map((rid: string) => roleMap.get(rid)).filter(Boolean);
      const effectiveRoles = userRoles.length > 0 ? userRoles : (u.customRole ? [u.customRole] : []);

      const isRecruiterRole = effectiveRoles.some((r: any) => {
        const sysKey = (r.systemRole?.systemKey || '').toUpperCase();
        const roleName = (r.name || '').toUpperCase();
        return (
          sysKey === 'RECRUITER' ||
          sysKey === 'POD_LEAD' ||
          roleName === 'RECRUITER' ||
          roleName.includes('RECRUITER') ||
          roleName.includes('POD LEAD') ||
          roleName.includes('TEAM LEAD')
        );
      });

      if (!isRecruiterRole) {
        throw new BadRequestException(
          `User "${u.fullName}" cannot be added to a recruitment pod because they do not have an eligible recruiter role.`,
        );
      }

      if (u.podId && (!currentPodId || u.podId !== currentPodId)) {
        const otherPodName = u.pod?.name || 'another pod';
        throw new ConflictException(
          `User "${u.fullName}" is already assigned to recruitment pod "${otherPodName}". You must remove them from "${otherPodName}" before assigning them to this pod.`,
        );
      }
    }
  }

  /**
   * Helper: Resolves and enforces the operating unit and branch scope for pod operations.
   * Delivery Heads and Unit Admins are strictly isolated to their assigned business unit.
   * Tenant Admins can select any operating unit or operate across all units.
   */
  async resolveScope(
    tenantId: string,
    user: AuthUser,
    requestedBusinessUnitId?: string,
    requestedBranchId?: string,
    requireUnit = false,
  ): Promise<{ branchId?: string; businessUnitId?: string }> {
    const permissions = user?.permissions || [];
    const roles = Array.isArray(user?.roles) ? user.roles.map((r: string) => r.toUpperCase()) : [];
    const sysRole = (user?.systemRole || '').toUpperCase();

    const isTenantAdmin =
      roles.includes('TENANT_ADMIN') ||
      roles.includes('SUPER_ADMIN') ||
      sysRole === 'TENANT_ADMIN' ||
      sysRole === 'SUPER_ADMIN' ||
      permissions.includes('tenant:manage') ||
      permissions.includes('tenant:settings') ||
      permissions.includes('platform:manage');

    const cleanReqUnit =
      requestedBusinessUnitId && !['all', 'null', 'undefined', ''].includes(requestedBusinessUnitId.toLowerCase())
        ? requestedBusinessUnitId
        : undefined;

    const cleanReqBranch =
      requestedBranchId && !['all', 'null', 'undefined', ''].includes(requestedBranchId.toLowerCase())
        ? requestedBranchId
        : undefined;

    if (isTenantAdmin) {
      let branchId = cleanReqBranch;
      let businessUnitId = cleanReqUnit;

      if (businessUnitId) {
        const bu = await this.prisma.businessUnit.findFirst({
          where: { id: businessUnitId, tenantId },
          select: { id: true, branchId: true },
        });
        if (!bu) {
          throw new NotFoundException('Operating unit not found.');
        }
        if (branchId && bu.branchId && branchId !== bu.branchId) {
          throw new BadRequestException('Selected operating unit does not belong to the selected branch.');
        }
        branchId = bu.branchId || branchId;
      }

      if (requireUnit && !businessUnitId) {
        throw new BadRequestException('An operating unit is required for this recruitment pod operation.');
      }

      return { branchId, businessUnitId };
    }

    // Delivery Head & Unit Admin: strictly scoped to their assigned business unit
    const isUnitAdmin =
      roles.includes('UNIT_ADMIN') ||
      sysRole === 'UNIT_ADMIN' ||
      permissions.includes('unit_admin:manage');

    const isDeliveryHead =
      roles.includes('DELIVERY_HEAD') ||
      sysRole === 'DELIVERY_HEAD';

    if (isUnitAdmin || isDeliveryHead) {
      if (!user.businessUnitId) {
        throw new ForbiddenException('You are not assigned to an operating unit.');
      }

      if (cleanReqUnit && cleanReqUnit !== user.businessUnitId) {
        throw new ForbiddenException('You do not have access to pods outside your assigned operating unit.');
      }

      const bu = await this.prisma.businessUnit.findFirst({
        where: { id: user.businessUnitId, tenantId },
        select: { id: true, branchId: true },
      });

      return {
        businessUnitId: user.businessUnitId,
        branchId: bu?.branchId || user.branchId || undefined,
      };
    }

    // Branch Admin (without delivery head or unit admin roles)
    const isBranchAdmin =
      roles.includes('BRANCH_ADMIN') ||
      sysRole === 'BRANCH_ADMIN' ||
      permissions.includes('branch_admin:manage');

    if (isBranchAdmin) {
      if (!user.branchId) {
        throw new ForbiddenException('You are not assigned to any branch office.');
      }
      if (cleanReqBranch && cleanReqBranch !== user.branchId) {
        throw new ForbiddenException('You can only access pods within your assigned branch.');
      }
      let branchId = user.branchId;
      let businessUnitId = cleanReqUnit;
      if (businessUnitId) {
        const bu = await this.prisma.businessUnit.findFirst({
          where: { id: businessUnitId, tenantId, branchId },
          select: { id: true, branchId: true },
        });
        if (!bu) {
          throw new ForbiddenException('Operating unit does not belong to your assigned branch.');
        }
      }
      if (requireUnit && !businessUnitId) {
        throw new BadRequestException('An operating unit is required for this recruitment pod operation.');
      }
      return { branchId, businessUnitId };
    }

    // Staff / Recruiter / Pod Lead
    if (user.businessUnitId) {
      if (cleanReqUnit && cleanReqUnit !== user.businessUnitId) {
        throw new ForbiddenException('You do not have access to pods outside your assigned operating unit.');
      }
      return {
        businessUnitId: user.businessUnitId,
        branchId: user.branchId || undefined,
      };
    }

    if (user.branchId) {
      if (cleanReqBranch && cleanReqBranch !== user.branchId) {
        throw new ForbiddenException('You can only access pods within your assigned branch.');
      }
      return {
        branchId: user.branchId,
        businessUnitId: cleanReqUnit,
      };
    }

    throw new ForbiddenException('You do not have an assigned operating unit or branch office.');
  }

  /**
   * Helper: Asserts that the authenticated user has access to view or mutate a specific pod.
   */
  async assertPodAccess(tenantId: string, user: AuthUser, pod: PodResponse | any): Promise<void> {
    if (!pod) {
      throw new NotFoundException('Recruitment pod not found.');
    }
    const permissions = user?.permissions || [];
    const roles = Array.isArray(user?.roles) ? user.roles.map((r: string) => r.toUpperCase()) : [];
    const sysRole = (user?.systemRole || '').toUpperCase();

    const isTenantAdmin =
      roles.includes('TENANT_ADMIN') ||
      roles.includes('SUPER_ADMIN') ||
      sysRole === 'TENANT_ADMIN' ||
      sysRole === 'SUPER_ADMIN' ||
      permissions.includes('tenant:manage') ||
      permissions.includes('tenant:settings') ||
      permissions.includes('platform:manage');

    if (isTenantAdmin) return;

    const isUnitAdmin =
      roles.includes('UNIT_ADMIN') ||
      sysRole === 'UNIT_ADMIN' ||
      permissions.includes('unit_admin:manage');

    const isDeliveryHead =
      roles.includes('DELIVERY_HEAD') ||
      sysRole === 'DELIVERY_HEAD';

    if (isUnitAdmin || isDeliveryHead) {
      if (!user.businessUnitId || pod.businessUnitId !== user.businessUnitId) {
        throw new ForbiddenException('You do not have access to pods outside your assigned operating unit.');
      }
      return;
    }

    const isBranchAdmin =
      roles.includes('BRANCH_ADMIN') ||
      sysRole === 'BRANCH_ADMIN' ||
      permissions.includes('branch_admin:manage');

    if (isBranchAdmin) {
      if (!user.branchId || (pod.branchId && pod.branchId !== user.branchId)) {
        throw new ForbiddenException('You do not have access to pods outside your assigned branch.');
      }
      return;
    }

    const isMember =
      pod.podHeadId === user.dbId ||
      (Array.isArray(pod.members) && pod.members.some((m: any) => m.id === user.dbId)) ||
      (Array.isArray(pod.users) && pod.users.some((u: any) => u.id === user.dbId));

    if (isMember) return;

    if (user.businessUnitId && pod.businessUnitId === user.businessUnitId) return;

    throw new ForbiddenException('You do not have access to this recruitment pod.');
  }

  /**
   * Create a new recruitment pod
   */
  async create(dto: CreatePodDto, tenantId: string, branchId?: string, businessUnitId?: string): Promise<PodResponse> {
    this.logger.log(`Creating pod "${dto.name}" for tenant ${tenantId}`);

    let effectiveBusinessUnitId = dto.businessUnitId || businessUnitId || null;
    let effectiveBranchId = dto.branchId || branchId || null;

    if (!effectiveBusinessUnitId) {
      throw new BadRequestException('Recruitment pods must be assigned to an operating unit.');
    }

    const bu = await this.prisma.businessUnit.findFirst({
      where: { id: effectiveBusinessUnitId, tenantId },
      select: { id: true, branchId: true },
    });
    if (!bu) {
      throw new NotFoundException('Operating unit not found.');
    }
    effectiveBranchId = bu.branchId || effectiveBranchId;
    if (!effectiveBranchId) {
      throw new BadRequestException('Recruitment pods must be assigned to a branch office.');
    }

    return await this.prisma.$transaction(async (tx) => {
      // 1. Name uniqueness within operating unit
      const nameCheck = await tx.pod.findFirst({
        where: {
          tenantId,
          name: { equals: dto.name.trim(), mode: 'insensitive' },
          businessUnitId: effectiveBusinessUnitId,
        },
      });
      if (nameCheck) {
        throw new ConflictException(
          `A pod with the name "${dto.name}" already exists in this operating unit.`,
        );
      }

      // 2. Collect all target users to validate
      const targetUserIds = new Set<string>();
      if (dto.podHeadId) targetUserIds.add(dto.podHeadId);
      if (dto.recruiterIds && dto.recruiterIds.length > 0) {
        dto.recruiterIds.forEach((id) => targetUserIds.add(id));
      }

      if (targetUserIds.size > 0) {
        await this.validateRecruiters(
          tx,
          Array.from(targetUserIds),
          tenantId,
          effectiveBusinessUnitId,
        );
      }

      // 3. Pod Lead can only lead one pod at a time
      if (dto.podHeadId) {
        const existingHeadOfPod = await tx.pod.findFirst({
          where: { podHeadId: dto.podHeadId, tenantId },
          select: { id: true, name: true },
        });
        if (existingHeadOfPod) {
          throw new ConflictException(
            `This staff member is already the Pod Lead of "${existingHeadOfPod.name}". A user can only lead one pod at a time.`,
          );
        }
      }

      // 4. Create the pod
      const pod = await tx.pod.create({
        data: {
          tenantId,
          branchId: effectiveBranchId,
          businessUnitId: effectiveBusinessUnitId,
          name: dto.name.trim(),
          podHeadId: dto.podHeadId || null,
          description: dto.description?.trim() || null,
          isAvailableForAssignment: true,
        },
      });

      // 5. Assign pod head and recruiters
      const allMembers = Array.from(targetUserIds);
      if (allMembers.length > 0) {
        await tx.user.updateMany({
          where: { id: { in: allMembers }, tenantId },
          data: { podId: pod.id },
        });
      }

      // 6. Promote pod head role
      if (dto.podHeadId) {
        await this.promoteToPodHead(dto.podHeadId, tenantId, effectiveBranchId, tx);
      }

      return pod.id;
    }).then(async (podId) => {
      if (dto.podHeadId) {
        this.notifyPodLeadAssigned({
          podHeadId: dto.podHeadId,
          podName: dto.name.trim(),
          tenantId,
          branchId: effectiveBranchId,
          businessUnitId: effectiveBusinessUnitId,
        }).catch((err) => {
          this.logger.warn(`Failed to notify pod lead: ${err?.message}`);
        });
      }
      return this.findOne(podId, tenantId);
    });
  }

  /**
   * List all pods for a tenant (scoped to operating unit or branch)
   */
  async findAll(tenantId: string, branchId?: string, businessUnitId?: string): Promise<PodResponse[]> {
    const where: any = { tenantId };
    if (businessUnitId && businessUnitId !== 'all') {
      where.businessUnitId = businessUnitId;
    } else if (branchId && branchId !== 'all') {
      where.branchId = branchId;
    }

    const pods = await this.prisma.pod.findMany({
      where,
      include: {
        podHead: { select: { fullName: true } },
        branch: { select: { name: true } },
        businessUnit: { select: { name: true } },
        _count: { select: { jobPods: true } },
        users: {
          include: {
            customRole: { select: { systemRole: { select: { systemKey: true } } } },
          },
          orderBy: { fullName: 'asc' },
        },
      },
      orderBy: { name: 'asc' },
    });

    return pods.map((p) => ({
      id: p.id,
      name: p.name,
      branchId: p.branchId || null,
      branchName: p.branch?.name || null,
      businessUnitId: p.businessUnitId || null,
      businessUnitName: p.businessUnit?.name || null,
      podHeadId: p.podHeadId || null,
      podHeadName: p.podHead?.fullName || null,
      description: p.description,
      isAvailableForAssignment: p.isAvailableForAssignment,
      members: p.users.map((u) => ({
        id: u.id,
        fullName: u.fullName,
        email: u.email,
        avatar: u.profilePicture || null,
        profilePicture: u.profilePicture || null,
        systemRole: u.customRole?.systemRole?.systemKey || 'RECRUITER',
      })),
      jobsCount: p._count.jobPods,
      createdAt: p.createdAt.toISOString(),
    }));
  }

  /**
   * Find a single pod by ID
   */
  async findOne(id: string, tenantId: string): Promise<PodResponse> {
    const pod = await this.prisma.pod.findFirst({
      where: { id, tenantId },
      include: {
        podHead: { select: { fullName: true } },
        branch: { select: { name: true } },
        businessUnit: { select: { name: true } },
        _count: { select: { jobPods: true } },
        users: {
          include: {
            customRole: { select: { systemRole: { select: { systemKey: true } } } },
          },
          orderBy: { fullName: 'asc' },
        },
      },
    });

    if (!pod) {
      throw new NotFoundException(`Recruitment Pod with ID ${id} not found.`);
    }

    return {
      id: pod.id,
      name: pod.name,
      branchId: pod.branchId || null,
      branchName: pod.branch?.name || null,
      businessUnitId: pod.businessUnitId || null,
      businessUnitName: pod.businessUnit?.name || null,
      podHeadId: pod.podHeadId || null,
      podHeadName: pod.podHead?.fullName || null,
      description: pod.description,
      isAvailableForAssignment: pod.isAvailableForAssignment,
      members: pod.users.map((u) => ({
        id: u.id,
        fullName: u.fullName,
        email: u.email,
        avatar: u.profilePicture || null,
        profilePicture: u.profilePicture || null,
        systemRole: u.customRole?.systemRole?.systemKey || 'RECRUITER',
      })),
      jobsCount: pod._count.jobPods,
      createdAt: pod.createdAt.toISOString(),
    };
  }

  /**
   * Find the team (pod) of the logged-in user
   */
  async findMyTeam(userId: string, tenantId: string): Promise<PodResponse> {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, tenantId },
      select: { podId: true },
    });

    let podId = user?.podId;
    if (!podId) {
      const headPod = await this.prisma.pod.findFirst({
        where: { tenantId, podHeadId: userId },
        select: { id: true },
      });
      podId = headPod?.id || null;
    }

    if (!podId) {
      throw new NotFoundException('You are not currently assigned to any Recruitment Pod.');
    }

    return this.findOne(podId, tenantId);
  }

  /**
   * Get recruiters not assigned to any pod (scoped to operating unit or branch)
   */
  async getAvailableRecruiters(tenantId: string, branchId?: string, businessUnitId?: string): Promise<any[]> {
    const where: any = {
      tenantId,
      podId: null,
      isActive: true,
      isApproved: true,
    };

    if (businessUnitId && businessUnitId !== 'all') {
      if (branchId && branchId !== 'all') {
        where.AND = [
          { OR: [{ businessUnitId }, { businessUnitId: null }] },
          { branchId },
        ];
      } else {
        where.businessUnitId = businessUnitId;
      }
    } else if (branchId && branchId !== 'all') {
      where.branchId = branchId;
    }

    const users = await this.prisma.user.findMany({
      where,
      include: {
        customRole: { select: { id: true, name: true, systemRole: { select: { systemKey: true } } } },
      },
      orderBy: { fullName: 'asc' },
    });

    // Collect all role IDs across users (both roleId and assignedRoleIds)
    const allRoleIds = new Set<string>();
    users.forEach((u: any) => {
      if (u.roleId) allRoleIds.add(u.roleId);
      if (Array.isArray(u.assignedRoleIds)) {
        u.assignedRoleIds.forEach((rid: string) => allRoleIds.add(rid));
      }
    });

    const customRoles = await this.prisma.customRole.findMany({
      where: { id: { in: Array.from(allRoleIds) } },
      select: {
        id: true,
        name: true,
        systemRole: { select: { systemKey: true } },
      },
    });
    const roleMap = new Map<string, any>(customRoles.map((r: any) => [r.id, r]));

    const eligible = users.filter((u: any) => {
      const userRoleIds = [
        u.roleId,
        ...(Array.isArray(u.assignedRoleIds) ? u.assignedRoleIds : []),
      ].filter(Boolean);
      const userRoles = userRoleIds.map((rid: string) => roleMap.get(rid)).filter(Boolean);
      const effectiveRoles = userRoles.length > 0 ? userRoles : (u.customRole ? [u.customRole] : []);

      return effectiveRoles.some((r: any) => {
        const sysKey = (r.systemRole?.systemKey || '').toUpperCase();
        const roleName = (r.name || '').toUpperCase();
        return (
          sysKey === 'RECRUITER' ||
          sysKey === 'POD_LEAD' ||
          roleName === 'RECRUITER' ||
          roleName.includes('RECRUITER') ||
          roleName.includes('POD LEAD') ||
          roleName.includes('TEAM LEAD')
        );
      });
    });

    return eligible.map((u: any) => {
      const userRoleIds = [
        u.roleId,
        ...(Array.isArray(u.assignedRoleIds) ? u.assignedRoleIds : []),
      ].filter(Boolean);
      const userRoles = userRoleIds.map((rid: string) => roleMap.get(rid)).filter(Boolean);

      const recruiterRole = userRoles.find((r: any) => {
        const sysKey = (r.systemRole?.systemKey || '').toUpperCase();
        const roleName = (r.name || '').toUpperCase();
        return (
          sysKey === 'RECRUITER' ||
          sysKey === 'POD_LEAD' ||
          roleName === 'RECRUITER' ||
          roleName.includes('RECRUITER') ||
          roleName.includes('POD LEAD') ||
          roleName.includes('TEAM LEAD')
        );
      });

      return {
        id: u.id,
        fullName: u.fullName,
        email: u.email,
        roleName: recruiterRole?.name || u.customRole?.name || 'Recruiter',
        avatar: u.profilePicture || null,
        profilePicture: u.profilePicture || null,
        systemRole: recruiterRole?.systemRole?.systemKey || u.customRole?.systemRole?.systemKey || 'RECRUITER',
        businessUnitId: u.businessUnitId || null,
        branchId: u.branchId || null,
      };
    });
  }

  /**
   * Update a pod
   */
  async update(id: string, dto: UpdatePodDto, tenantId: string): Promise<PodResponse> {
    const existingPod = await this.prisma.pod.findFirst({
      where: { id, tenantId },
      include: { users: { select: { id: true } } },
    });

    if (!existingPod) {
      throw new NotFoundException(`Pod not found.`);
    }

    const businessUnitId = dto.businessUnitId !== undefined ? dto.businessUnitId : existingPod.businessUnitId;
    if (!businessUnitId) {
      throw new BadRequestException('Recruitment pods must belong to an operating unit.');
    }

    let branchId = dto.branchId !== undefined ? dto.branchId : existingPod.branchId;
    if (businessUnitId && businessUnitId !== existingPod.businessUnitId) {
      const bu = await this.prisma.businessUnit.findFirst({
        where: { id: businessUnitId, tenantId },
        select: { id: true, branchId: true },
      });
      if (!bu) {
        throw new NotFoundException('Operating unit not found.');
      }
      branchId = bu.branchId || branchId;
    }
    if (!branchId) {
      throw new BadRequestException('Recruitment pods must belong to a branch office.');
    }

    const effectivePodName = dto.name !== undefined && dto.name.trim() ? dto.name.trim() : existingPod.name;

    return await this.prisma.$transaction(async (tx) => {
      // 1. Check name uniqueness
      if (dto.name && dto.name.trim().toUpperCase() !== existingPod.name.toUpperCase()) {
        const nameCheck = await tx.pod.findFirst({
          where: {
            tenantId,
            name: { equals: dto.name.trim(), mode: 'insensitive' },
            businessUnitId,
            id: { not: id },
          },
        });
        if (nameCheck) {
          throw new ConflictException(
            `A pod with the name "${dto.name}" already exists in this operating unit.`,
          );
        }
      }

      const name = dto.name !== undefined ? dto.name.trim() : existingPod.name;
      const podHeadId = dto.podHeadId !== undefined ? dto.podHeadId : existingPod.podHeadId;
      const description = dto.description !== undefined ? dto.description : existingPod.description;

      // 2. Pod head validation
      if (dto.podHeadId && dto.podHeadId !== existingPod.podHeadId) {
        const existingHeadOfPod = await tx.pod.findFirst({
          where: { podHeadId: dto.podHeadId, tenantId, id: { not: id } },
          select: { id: true, name: true },
        });
        if (existingHeadOfPod) {
          throw new ConflictException(
            `This staff member is already the Pod Lead of "${existingHeadOfPod.name}". A user can only lead one pod at a time.`,
          );
        }
      }

      // 3. Collect target users to validate
      const targetUserIds = new Set<string>();
      if (podHeadId) targetUserIds.add(podHeadId);
      if (dto.recruiterIds !== undefined) {
        dto.recruiterIds.forEach((rid) => targetUserIds.add(rid));
      }

      if (targetUserIds.size > 0) {
        await this.validateRecruiters(
          tx,
          Array.from(targetUserIds),
          tenantId,
          businessUnitId,
          id, // currentPodId allowed
        );
      }

      // 4. Update the pod
      await tx.pod.update({
        where: { id },
        data: {
          name,
          branchId,
          businessUnitId,
          podHeadId,
          description,
        },
      });

      // 5. Pod head role adjustments
      if (dto.podHeadId !== undefined && dto.podHeadId !== existingPod.podHeadId) {
        if (existingPod.podHeadId) {
          await this.demoteFromPodHead(existingPod.podHeadId, tenantId, tx, id);
        }
        if (podHeadId) {
          await this.promoteToPodHead(podHeadId, tenantId, branchId, tx);
          await tx.user.update({
            where: { id: podHeadId },
            data: { podId: id },
          });
        }
      }

      // 6. Recruiter membership adjustments
      if (dto.recruiterIds !== undefined) {
        const newRecruiterIds = new Set(dto.recruiterIds || []);
        if (podHeadId) newRecruiterIds.add(podHeadId);

        // Unassign removed members
        await tx.user.updateMany({
          where: {
            podId: id,
            tenantId,
            id: { notIn: Array.from(newRecruiterIds) },
          },
          data: { podId: null },
        });

        // Assign kept/new members
        if (newRecruiterIds.size > 0) {
          await tx.user.updateMany({
            where: { id: { in: Array.from(newRecruiterIds) }, tenantId },
            data: { podId: id },
          });
        }
      }

      return id;
    }).then(async (podId) => {
      if (dto.podHeadId && dto.podHeadId !== existingPod.podHeadId) {
        this.notifyPodLeadAssigned({
          podHeadId: dto.podHeadId,
          podName: effectivePodName,
          tenantId,
          branchId,
          businessUnitId,
        }).catch((err) => {
          this.logger.warn(`Failed to notify pod lead: ${err?.message}`);
        });
      }
      return this.findOne(podId, tenantId);
    });
  }

  /**
   * Delete a pod and release members
   */
  async remove(id: string, tenantId: string) {
    const pod = await this.prisma.pod.findFirst({
      where: { id, tenantId },
    });

    if (!pod) {
      throw new NotFoundException(`Pod not found.`);
    }

    if (pod.podHeadId) {
      await this.demoteFromPodHead(pod.podHeadId, tenantId, undefined, id);
    }

    await this.prisma.user.updateMany({
      where: { podId: id, tenantId },
      data: { podId: null },
    });

    await this.prisma.pod.delete({
      where: { id },
    });

    return { message: 'Pod deleted successfully.' };
  }

  /**
   * Reset the round robin cycle for all pods
   */
  async resetCycle(tenantId: string, branchId?: string, businessUnitId?: string) {
    const where: any = { tenantId };
    if (businessUnitId && businessUnitId !== 'all') {
      where.businessUnitId = businessUnitId;
    } else if (branchId && branchId !== 'all') {
      where.branchId = branchId;
    }

    const unitScope = businessUnitId && businessUnitId !== 'all' ? businessUnitId : null;
    const branchScope = !unitScope && branchId && branchId !== 'all' ? branchId : null;
    await this.prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM ats.business_units
        WHERE tenant_id = ${tenantId}::uuid
          AND (${unitScope}::uuid IS NULL OR id = ${unitScope}::uuid)
          AND (${branchScope}::uuid IS NULL OR branch_id = ${branchScope}::uuid)
        ORDER BY id FOR UPDATE`;
      await tx.pod.updateMany({ where, data: { isAvailableForAssignment: true } });
    });

    return { message: 'Round-robin cycle reset successfully.' };
  }
}
