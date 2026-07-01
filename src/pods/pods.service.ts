import { Injectable, Logger, NotFoundException, BadRequestException, ConflictException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
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

  constructor(private readonly db: DatabaseService) {}

  /**
   * Helper: Promotes a user to POD_LEAD role
   */
  private async promoteToPodHead(userId: string, tenantId: string) {
    const roleRes = await this.db.query(
      "SELECT id FROM custom_roles WHERE tenant_id = $1 AND name = 'POD_LEAD' LIMIT 1",
      [tenantId]
    );
    if (roleRes.rows.length === 0) {
      this.logger.warn(`POD_LEAD role not found for tenant ${tenantId}. Skipping automatic role promotion.`);
      return;
    }
    const roleId = roleRes.rows[0].id;
    await this.db.query(
      "UPDATE users SET role_id = $1, roles = ARRAY['POD_LEAD'] WHERE id = $2 AND tenant_id = $3",
      [roleId, userId, tenantId]
    );
  }

  /**
   * Helper: Demotes a user back to RECRUITER role
   */
  private async demoteFromPodHead(userId: string, tenantId: string) {
    // Check if user is head of any other pod
    const otherPods = await this.db.query(
      "SELECT id FROM pods WHERE pod_head_id = $1 AND tenant_id = $2 LIMIT 1",
      [userId, tenantId]
    );
    if (otherPods.rows.length > 0) {
      // User is still head of another pod, do not demote
      return;
    }

    const roleRes = await this.db.query(
      "SELECT id FROM custom_roles WHERE tenant_id = $1 AND name = 'RECRUITER' LIMIT 1",
      [tenantId]
    );
    if (roleRes.rows.length === 0) {
      this.logger.warn(`RECRUITER role not found for tenant ${tenantId}. Skipping automatic role demotion.`);
      return;
    }
    const roleId = roleRes.rows[0].id;
    await this.db.query(
      "UPDATE users SET role_id = $1, roles = ARRAY['RECRUITER'] WHERE id = $2 AND tenant_id = $3",
      [roleId, userId, tenantId]
    );
  }

  /**
   * Create a new recruitment pod
   */
  async create(dto: CreatePodDto, tenantId: string): Promise<PodResponse> {
    this.logger.log(`Creating pod "${dto.name}" for tenant ${tenantId}`);

    // Check name uniqueness in tenant
    const nameCheck = await this.db.query(
      "SELECT 1 FROM pods WHERE tenant_id = $1 AND UPPER(name) = $2",
      [tenantId, dto.name.toUpperCase().trim()]
    );
    if (nameCheck.rows.length > 0) {
      throw new ConflictException(`A pod with the name "${dto.name}" already exists.`);
    }

    // Insert Pod
    const res = await this.db.query(
      `INSERT INTO pods (tenant_id, name, pod_head_id, description, is_available_for_assignment)
       VALUES ($1, $2, $3, $4, TRUE)
       RETURNING *`,
      [tenantId, dto.name.trim(), dto.podHeadId || null, dto.description || null]
    );
    const pod = res.rows[0];

    // If pod head is designated, promote them and assign to the pod
    if (dto.podHeadId) {
      await this.promoteToPodHead(dto.podHeadId, tenantId);
      await this.db.query(
        "UPDATE users SET pod_id = $1 WHERE id = $2 AND tenant_id = $3",
        [pod.id, dto.podHeadId, tenantId]
      );
    }

    // Assign recruiter members if provided
    if (dto.recruiterIds && dto.recruiterIds.length > 0) {
      await this.db.query(
        "UPDATE users SET pod_id = $1 WHERE id = ANY($2) AND tenant_id = $3",
        [pod.id, dto.recruiterIds, tenantId]
      );
    }

    return this.findOne(pod.id, tenantId);
  }

  /**
   * List all pods for a tenant
   */
  async findAll(tenantId: string): Promise<PodResponse[]> {
    const podsRes = await this.db.query(
      `SELECT p.*, h.full_name as pod_head_name,
              (SELECT COUNT(*)::int FROM job_pods WHERE pod_id = p.id) as jobs_count
       FROM pods p
       LEFT JOIN users h ON h.id = p.pod_head_id
       WHERE p.tenant_id = $1
       ORDER BY p.name ASC`,
      [tenantId]
    );

    const pods = podsRes.rows;
    const result: PodResponse[] = [];

    for (const pod of pods) {
      const membersRes = await this.db.query(
        `SELECT u.id, u.full_name as "fullName", u.email, cr.system_role as "systemRole"
         FROM users u
         LEFT JOIN custom_roles cr ON u.role_id = cr.id
         WHERE u.pod_id = $1 AND u.tenant_id = $2
         ORDER BY u.full_name ASC`,
        [pod.id, tenantId]
      );

      result.push({
        id: pod.id,
        name: pod.name,
        podHeadId: pod.pod_head_id,
        podHeadName: pod.pod_head_name,
        description: pod.description,
        isAvailableForAssignment: pod.is_available_for_assignment,
        members: membersRes.rows,
        jobsCount: pod.jobs_count || 0,
        createdAt: pod.created_at,
      });
    }

    return result;
  }

  /**
   * Find a single pod by ID
   */
  async findOne(id: string, tenantId: string): Promise<PodResponse> {
    const res = await this.db.query(
      `SELECT p.*, h.full_name as pod_head_name,
              (SELECT COUNT(*)::int FROM job_pods WHERE pod_id = p.id) as jobs_count
       FROM pods p
       LEFT JOIN users h ON h.id = p.pod_head_id
       WHERE p.id = $1 AND p.tenant_id = $2`,
      [id, tenantId]
    );

    if (res.rows.length === 0) {
      throw new NotFoundException(`Recruitment Pod with ID ${id} not found.`);
    }

    const pod = res.rows[0];
    const membersRes = await this.db.query(
      `SELECT u.id, u.full_name as "fullName", u.email, cr.system_role as "systemRole"
       FROM users u
       LEFT JOIN custom_roles cr ON u.role_id = cr.id
       WHERE u.pod_id = $1 AND u.tenant_id = $2
       ORDER BY u.full_name ASC`,
      [pod.id, tenantId]
    );

    return {
      id: pod.id,
      name: pod.name,
      podHeadId: pod.pod_head_id,
      podHeadName: pod.pod_head_name,
      description: pod.description,
      isAvailableForAssignment: pod.is_available_for_assignment,
      members: membersRes.rows,
      jobsCount: pod.jobs_count || 0,
      createdAt: pod.created_at,
    };
  }

  /**
   * Find the team (pod) of the logged-in user
   */
  async findMyTeam(userId: string, tenantId: string): Promise<PodResponse> {
    const userRes = await this.db.query(
      "SELECT pod_id FROM users WHERE id = $1 AND tenant_id = $2 LIMIT 1",
      [userId, tenantId]
    );
    if (userRes.rows.length === 0 || !userRes.rows[0].pod_id) {
      throw new NotFoundException("You are not currently assigned to any Recruitment Pod.");
    }
    return this.findOne(userRes.rows[0].pod_id, tenantId);
  }

  /**
   * Get recruiters not assigned to any pod
   */
  async getAvailableRecruiters(tenantId: string): Promise<any[]> {
    const res = await this.db.query(
      `SELECT u.id, u.full_name as "fullName", u.email, cr.name as "roleName"
       FROM users u
       LEFT JOIN custom_roles cr ON u.role_id = cr.id
       WHERE u.tenant_id = $1 
         AND u.pod_id IS NULL 
         AND u.is_active = TRUE 
         AND u.is_approved = TRUE
         AND (cr.system_role IN ('RECRUITER', 'POD_LEAD') OR cr.name = 'RECRUITER')
       ORDER BY u.full_name ASC`,
      [tenantId]
    );
    return res.rows;
  }

  /**
   * Update a pod
   */
  async update(id: string, dto: UpdatePodDto, tenantId: string): Promise<PodResponse> {
    const podRes = await this.db.query(
      "SELECT * FROM pods WHERE id = $1 AND tenant_id = $2 LIMIT 1",
      [id, tenantId]
    );
    if (podRes.rows.length === 0) {
      throw new NotFoundException(`Pod not found.`);
    }
    const existingPod = podRes.rows[0];

    // Check name uniqueness if changed
    if (dto.name && dto.name.toUpperCase().trim() !== existingPod.name.toUpperCase().trim()) {
      const nameCheck = await this.db.query(
        "SELECT 1 FROM pods WHERE tenant_id = $1 AND UPPER(name) = $2 AND id <> $3",
        [tenantId, dto.name.toUpperCase().trim(), id]
      );
      if (nameCheck.rows.length > 0) {
        throw new ConflictException(`A pod with the name "${dto.name}" already exists.`);
      }
    }

    const name = dto.name !== undefined ? dto.name.trim() : existingPod.name;
    const podHeadId = dto.podHeadId !== undefined ? dto.podHeadId : existingPod.pod_head_id;
    const description = dto.description !== undefined ? dto.description : existingPod.description;

    // Update pod
    await this.db.query(
      `UPDATE pods 
       SET name = $1, pod_head_id = $2, description = $3, updated_at = NOW() 
       WHERE id = $4 AND tenant_id = $5`,
      [name, podHeadId, description, id, tenantId]
    );

    // If pod head changed, demote old head, promote new head
    if (dto.podHeadId !== undefined && dto.podHeadId !== existingPod.pod_head_id) {
      if (existingPod.pod_head_id) {
        await this.demoteFromPodHead(existingPod.pod_head_id, tenantId);
      }
      if (podHeadId) {
        await this.promoteToPodHead(podHeadId, tenantId);
        // Ensure the new head is member of this pod
        await this.db.query(
          "UPDATE users SET pod_id = $1 WHERE id = $2 AND tenant_id = $3",
          [id, podHeadId, tenantId]
        );
      }
    }

    // Sync recruiter members
    if (dto.recruiterIds !== undefined) {
      const newRecruiterIds = dto.recruiterIds || [];
      // If pod head is set, keep them in the recruiters list
      if (podHeadId && !newRecruiterIds.includes(podHeadId)) {
        newRecruiterIds.push(podHeadId);
      }

      // Remove members who are no longer in this pod
      if (newRecruiterIds.length > 0) {
        await this.db.query(
          "UPDATE users SET pod_id = NULL WHERE pod_id = $1 AND id NOT IN (SELECT unnest($2::uuid[])) AND tenant_id = $3",
          [id, newRecruiterIds, tenantId]
        );
      } else {
        await this.db.query(
          "UPDATE users SET pod_id = NULL WHERE pod_id = $1 AND tenant_id = $2",
          [id, tenantId]
        );
      }

      // Add new members
      if (newRecruiterIds.length > 0) {
        await this.db.query(
          "UPDATE users SET pod_id = $1 WHERE id = ANY($2) AND tenant_id = $3",
          [id, newRecruiterIds, tenantId]
        );
      }
    }

    return this.findOne(id, tenantId);
  }

  /**
   * Delete a pod and release members
   */
  async remove(id: string, tenantId: string) {
    const podRes = await this.db.query(
      "SELECT * FROM pods WHERE id = $1 AND tenant_id = $2 LIMIT 1",
      [id, tenantId]
    );
    if (podRes.rows.length === 0) {
      throw new NotFoundException(`Pod not found.`);
    }
    const pod = podRes.rows[0];

    // Demote pod head if applicable
    if (pod.pod_head_id) {
      await this.demoteFromPodHead(pod.pod_head_id, tenantId);
    }

    // Remove users' pod association
    await this.db.query(
      "UPDATE users SET pod_id = NULL WHERE pod_id = $1 AND tenant_id = $2",
      [id, tenantId]
    );

    // Delete pod
    await this.db.query(
      "DELETE FROM pods WHERE id = $1 AND tenant_id = $2",
      [id, tenantId]
    );

    return { message: 'Pod deleted successfully.' };
  }

  /**
   * Reset the round robin cycle for all pods
   */
  async resetCycle(tenantId: string) {
    await this.db.query(
      "UPDATE pods SET is_available_for_assignment = TRUE WHERE tenant_id = $1",
      [tenantId]
    );
    return { message: 'Round-robin assignment availability cycle has been reset.' };
  }
}
