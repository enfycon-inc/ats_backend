import { Injectable, Logger, NotFoundException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreatePodDto } from './dtos/create-pod.dto';
import { UpdatePodDto } from './dtos/update-pod.dto';

export interface PodMember {
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

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Helper: Promotes a user to POD_LEAD role
   */
  private async promoteToPodHead(userId: string, tenantId: string) {
    const role = await this.prisma.customRole.findFirst({
      where: {
        tenantId,
        OR: [
          { systemRole: 'POD_LEAD' },
          { name: { in: ['POD_LEAD', 'Pod Lead', 'POD LEAD'], mode: 'insensitive' } },
        ],
      },
      select: { id: true },
    });

    if (!role) {
      this.logger.warn(`POD_LEAD role not found for tenant ${tenantId}. Skipping automatic role promotion.`);
      return;
    }

    await this.prisma.user.update({
      where: { id: userId },
      data: {
        roleId: role.id,
        assignedRoleIds: [role.id],
      },
    });
  }

  /**
   * Helper: Demotes a user back to RECRUITER role
   */
  private async demoteFromPodHead(userId: string, tenantId: string) {
    const otherPods = await this.prisma.pod.findFirst({
      where: { podHeadId: userId, tenantId },
      select: { id: true },
    });

    if (otherPods) {
      return;
    }

    const role = await this.prisma.customRole.findFirst({
      where: {
        tenantId,
        OR: [
          { systemRole: 'RECRUITER' },
          { name: { in: ['RECRUITER', 'Recruiter'], mode: 'insensitive' } },
        ],
      },
      select: { id: true },
    });

    if (!role) {
      this.logger.warn(`RECRUITER role not found for tenant ${tenantId}. Skipping automatic role demotion.`);
      return;
    }

    await this.prisma.user.update({
      where: { id: userId },
      data: {
        roleId: role.id,
        assignedRoleIds: [role.id],
      },
    });
  }

  /**
   * Create a new recruitment pod
   */
  async create(dto: CreatePodDto, tenantId: string, branchId?: string): Promise<PodResponse> {
    this.logger.log(`Creating pod "${dto.name}" for tenant ${tenantId}`);

    let effectiveBranchId = dto.branchId || branchId || null;
    if (!effectiveBranchId) {
      const defaultBranch = await this.prisma.branch.findFirst({
        where: { tenantId },
        orderBy: { createdAt: 'asc' },
        select: { id: true },
      });
      effectiveBranchId = defaultBranch?.id || null;
    }

    const nameCheck = await this.prisma.pod.findFirst({
      where: {
        tenantId,
        name: { equals: dto.name.trim(), mode: 'insensitive' },
        branchId: effectiveBranchId,
      },
    });
    if (nameCheck) {
      throw new ConflictException(`A pod with the name "${dto.name}" already exists in this branch.`);
    }

    const pod = await this.prisma.pod.create({
      data: {
        tenantId,
        branchId: effectiveBranchId,
        name: dto.name.trim(),
        podHeadId: dto.podHeadId || null,
        description: dto.description || null,
        isAvailableForAssignment: true,
      },
    });

    if (dto.podHeadId) {
      await this.promoteToPodHead(dto.podHeadId, tenantId);
      await this.prisma.user.update({
        where: { id: dto.podHeadId },
        data: { podId: pod.id },
      });
    }

    if (dto.recruiterIds && dto.recruiterIds.length > 0) {
      await this.prisma.user.updateMany({
        where: { id: { in: dto.recruiterIds }, tenantId },
        data: { podId: pod.id },
      });
    }

    return this.findOne(pod.id, tenantId);
  }

  /**
   * List all pods for a tenant (optionally scoped to a branch)
   */
  async findAll(tenantId: string, branchId?: string): Promise<PodResponse[]> {
    const where: any = { tenantId };
    if (branchId) {
      where.branchId = branchId;
    }

    const pods = await this.prisma.pod.findMany({
      where,
      include: {
        podHead: { select: { fullName: true } },
        branch: { select: { name: true } },
        _count: { select: { jobPods: true } },
        users: {
          include: {
            customRole: { select: { systemRole: true } },
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
      podHeadId: p.podHeadId || null,
      podHeadName: p.podHead?.fullName || null,
      description: p.description,
      isAvailableForAssignment: p.isAvailableForAssignment,
      members: p.users.map((u) => ({
        id: u.id,
        fullName: u.fullName,
        email: u.email,
        systemRole: u.customRole?.systemRole || 'RECRUITER',
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
        _count: { select: { jobPods: true } },
        users: {
          include: {
            customRole: { select: { systemRole: true } },
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
      podHeadId: pod.podHeadId || null,
      podHeadName: pod.podHead?.fullName || null,
      description: pod.description,
      isAvailableForAssignment: pod.isAvailableForAssignment,
      members: pod.users.map((u) => ({
        id: u.id,
        fullName: u.fullName,
        email: u.email,
        systemRole: u.customRole?.systemRole || 'RECRUITER',
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

    if (!user || !user.podId) {
      throw new NotFoundException('You are not currently assigned to any Recruitment Pod.');
    }

    return this.findOne(user.podId, tenantId);
  }

  /**
   * Get recruiters not assigned to any pod (optionally scoped to a branch)
   */
  async getAvailableRecruiters(tenantId: string, branchId?: string): Promise<any[]> {
    const where: any = {
      tenantId,
      podId: null,
      isActive: true,
      isApproved: true,
      customRole: {
        OR: [
          { systemRole: { in: ['RECRUITER', 'POD_LEAD'] } },
          { name: { in: ['RECRUITER', 'POD_LEAD', 'POD LEAD', 'Recruiter', 'Pod Lead'], mode: 'insensitive' } },
        ],
      },
    };

    if (branchId) {
      where.OR = [
        { branchId },
        { assignedBranchIds: { has: branchId } },
      ];
    }

    const users = await this.prisma.user.findMany({
      where,
      include: {
        customRole: { select: { name: true, systemRole: true } },
      },
      orderBy: { fullName: 'asc' },
    });

    return users.map((u) => ({
      id: u.id,
      fullName: u.fullName,
      email: u.email,
      roleName: u.customRole?.name || 'Staff',
      systemRole: u.customRole?.systemRole || 'RECRUITER',
    }));
  }

  /**
   * Update a pod
   */
  async update(id: string, dto: UpdatePodDto, tenantId: string): Promise<PodResponse> {
    const existingPod = await this.prisma.pod.findFirst({
      where: { id, tenantId },
    });

    if (!existingPod) {
      throw new NotFoundException(`Pod not found.`);
    }

    if (dto.name && dto.name.trim().toUpperCase() !== existingPod.name.toUpperCase()) {
      const branchId = dto.branchId !== undefined ? dto.branchId : existingPod.branchId;
      const nameCheck = await this.prisma.pod.findFirst({
        where: {
          tenantId,
          name: { equals: dto.name.trim(), mode: 'insensitive' },
          branchId,
          id: { not: id },
        },
      });
      if (nameCheck) {
        throw new ConflictException(`A pod with the name "${dto.name}" already exists in this branch.`);
      }
    }

    const name = dto.name !== undefined ? dto.name.trim() : existingPod.name;
    const branchId = dto.branchId !== undefined ? dto.branchId : existingPod.branchId;
    const podHeadId = dto.podHeadId !== undefined ? dto.podHeadId : existingPod.podHeadId;
    const description = dto.description !== undefined ? dto.description : existingPod.description;

    await this.prisma.pod.update({
      where: { id },
      data: {
        name,
        branchId,
        podHeadId,
        description,
      },
    });

    if (dto.podHeadId !== undefined && dto.podHeadId !== existingPod.podHeadId) {
      if (existingPod.podHeadId) {
        await this.demoteFromPodHead(existingPod.podHeadId, tenantId);
      }
      if (podHeadId) {
        await this.promoteToPodHead(podHeadId, tenantId);
        await this.prisma.user.update({
          where: { id: podHeadId },
          data: { podId: id },
        });
      }
    }

    if (dto.recruiterIds !== undefined) {
      const newRecruiterIds = dto.recruiterIds || [];
      if (podHeadId && !newRecruiterIds.includes(podHeadId)) {
        newRecruiterIds.push(podHeadId);
      }

      await this.prisma.user.updateMany({
        where: {
          podId: id,
          tenantId,
          id: { notIn: newRecruiterIds },
        },
        data: { podId: null },
      });

      if (newRecruiterIds.length > 0) {
        await this.prisma.user.updateMany({
          where: { id: { in: newRecruiterIds }, tenantId },
          data: { podId: id },
        });
      }
    }

    return this.findOne(id, tenantId);
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
      await this.demoteFromPodHead(pod.podHeadId, tenantId);
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
  async resetCycle(tenantId: string, branchId?: string) {
    const where: any = { tenantId };
    if (branchId) {
      where.branchId = branchId;
    }

    await this.prisma.pod.updateMany({
      where,
      data: { isAvailableForAssignment: true },
    });

    return { message: 'Round-robin assignment availability cycle has been reset.' };
  }
}
