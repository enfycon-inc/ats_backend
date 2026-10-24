import { assertPodsEnabled } from '../auth/workspace-features';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { resolveBranchId } from '../auth/utils/branch-resolver';
import type { AuthUser } from '../auth/interfaces/auth-user.interface';
import type { PrismaService } from '../prisma/prisma.service';

export interface JobStaffOption {
  id: string;
  fullName: string;
  email?: string;
  avatar?: string | null;
  /** Explicitly eligible to receive direct recruiter assignments. */
  canRecruit: boolean;
  canReview: boolean;
}

export interface JobPodOption {
  id: string;
  name: string;
  businessUnitId: string;
  branchId: string | null;
  podHeadId: string | null;
  podHeadName: string | null;
  memberCount: number;
}

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Pod Leads are restricted to their own pod. Job creators use their own-job scope instead. */
export function isPodScopedRecruiterAssigner(actor: Pick<AuthUser, 'permissions'>): boolean {
  const permissions = actor.permissions || [];
  return permissions.includes('job:assign_recruiter') &&
    !permissions.some(permission => [
      'job:override_assignment', 'tenant:manage', 'tenant:settings', 'platform:manage',
      'branch_admin:manage', 'job:create',
    ].includes(permission));
}

export async function resolveJobStaffingScope(prisma: PrismaService, actor: AuthUser, tenantId: string,
  requestedBranch?: string, requestedUnit?: string, permission = 'job:assign_recruiter', jobId?: string) {
  const podLeadAccess = permission === 'job:assign_recruiter' && isPodScopedRecruiterAssigner(actor);

  if (!actor.permissions?.includes(permission)) {
    throw new ForbiddenException(permission === 'job:assign_recruiter' ? 'Recruiter assignment permission is required.' : 'Pod assignment permission is required.');
  }
  for (const id of [requestedBranch, requestedUnit, jobId]) {
    if (id && !uuid.test(id)) throw new BadRequestException('Select a valid branch, unit, or job.');
  }
  let branchId = resolveBranchId(actor, requestedBranch);
  const permissions = actor.permissions || [];
  const tenantManager = permissions.some(p => ['tenant:settings', 'tenant:manage', 'platform:manage'].includes(p));
  const deliveryHead = permissions.includes('job:override_assignment');
  const branchManager = tenantManager || permissions.includes('branch_admin:manage') || deliveryHead;
  if (deliveryHead && (!actor.branchId || !actor.businessUnitId || (requestedBranch && requestedBranch !== actor.branchId) || (requestedUnit && requestedUnit !== actor.businessUnitId))) throw new ForbiddenException('Emergency assignments must stay in your current unit.');

  if (podLeadAccess) {
    await assertPodsEnabled(prisma, tenantId, actor.businessUnitId, actor.branchId);
    if (!jobId) throw new ForbiddenException('Pod Leads can only assign recruiters to jobs mapped to their pod.');
    const pod = await prisma.pod.findFirst({
      where: { tenantId, podHeadId: actor.dbId },
      select: { id: true, branchId: true, businessUnitId: true },
    });
    if (!pod) throw new ForbiddenException('You are not assigned as a Pod Lead.');
    const jobMapping = await prisma.jobPod.findUnique({
      where: { jobId_podId: { jobId, podId: pod.id } },
      select: { jobId: true },
    });
    if (!jobMapping) throw new ForbiddenException('You can only assign recruiters to jobs mapped to your pod.');
    if (requestedBranch && pod.branchId && requestedBranch !== pod.branchId) {
      throw new ForbiddenException('The selected branch is outside your pod scope.');
    }
    if (requestedUnit && pod.businessUnitId && requestedUnit !== pod.businessUnitId) {
      throw new ForbiddenException('The selected unit is outside your pod scope.');
    }
    return { branchId: pod.branchId || undefined, unitId: pod.businessUnitId || undefined, podId: pod.id };
  }

  let isJobOwner = false;
  let jobResolvedUnit: string | null = null;
  let jobResolvedBranch: string | null = null;

  if (jobId) {
    const job = await prisma.job.findFirst({
      where: { id: jobId, tenantId, deletedAt: null },
      select: { accountManagerId: true, recruitmentManagerId: true, branchId: true, businessUnitId: true },
    });
    if (!job) throw new ForbiddenException('The job is outside your job staffing scope.');
    if (deliveryHead && (job.branchId !== actor.branchId || job.businessUnitId !== actor.businessUnitId)) throw new ForbiddenException('Emergency assignments must stay in your current unit.');
    if (job) {
      isJobOwner = Boolean(
        (job.accountManagerId && (actor.dbId === job.accountManagerId || (actor as any).id === job.accountManagerId)) ||
        (job.recruitmentManagerId && (actor.dbId === job.recruitmentManagerId || (actor as any).id === job.recruitmentManagerId))
      );
      if (!branchManager && !isJobOwner) {
        throw new ForbiddenException('Account Managers can only assign staff to their own created jobs.');
      }
      if (!branchManager && ((requestedBranch && requestedBranch !== job.branchId) || (requestedUnit && requestedUnit !== job.businessUnitId))) {
        throw new ForbiddenException('Assignments must stay within the job branch and unit.');
      }
      jobResolvedBranch = job.branchId;
      jobResolvedUnit = job.businessUnitId;
      if (!branchId && jobResolvedBranch) branchId = jobResolvedBranch;
    }
  }

  const effectiveUnit = requestedUnit || jobResolvedUnit || actor.businessUnitId || null;

  if (!branchManager && !isJobOwner && (!actor.businessUnitId || (requestedUnit && requestedUnit !== actor.businessUnitId))) {
    throw new ForbiddenException('You can only select recruiters from your assigned unit.');
  }
  const unitId = effectiveUnit;
  if (unitId) {
    const unit = await prisma.businessUnit.findFirst({
      where: { id: unitId, tenantId, ...(branchId ? { branchId } : {}) }, select: { id: true },
    });
    if (!unit) throw new ForbiddenException('The selected unit is outside your job staffing scope.');
  }
  return { branchId, unitId };
}

export async function listJobPods(prisma: PrismaService, actor: AuthUser, tenantId: string,
  requestedBranch?: string, requestedUnit?: string, jobId?: string) {
  const { branchId, unitId } = await resolveJobStaffingScope(prisma, actor, tenantId, requestedBranch, requestedUnit, 'job:assign_pod', jobId);
  await assertPodsEnabled(prisma, tenantId, unitId, branchId);
  if (!unitId) throw new BadRequestException('Select an operating unit.');
  const pods = await prisma.pod.findMany({
    where: { tenantId, businessUnitId: unitId, ...(branchId ? { branchId } : {}) },
    select: {
      id: true,
      name: true,
      businessUnitId: true,
      branchId: true,
      podHeadId: true,
      podHead: { select: { fullName: true } },
      _count: { select: { users: true } },
    },
    orderBy: { name: 'asc' },
  });
  return pods.map(pod => ({
    id: pod.id,
    name: pod.name,
    businessUnitId: pod.businessUnitId,
    branchId: pod.branchId,
    podHeadId: pod.podHeadId,
    podHeadName: pod.podHead?.fullName || null,
    memberCount: pod._count.users,
  }));
}

export async function listJobStaff(prisma: PrismaService, actor: AuthUser, tenantId: string,
  requestedBranch?: string, requestedUnit?: string, jobId?: string): Promise<JobStaffOption[]> {
  const { branchId, unitId, podId } = await resolveJobStaffingScope(prisma, actor, tenantId, requestedBranch, requestedUnit, 'job:assign_recruiter', jobId);
  return prisma.$queryRawUnsafe<JobStaffOption[]>(`
    WITH RECURSIVE recruiter_role_tree(tenant_id, id, base_role_id) AS (
      SELECT role.tenant_id, role.id, role.base_role_id
      FROM ats.custom_roles role
      JOIN ats.system_roles system_role ON system_role.id = role.system_role_id
      WHERE system_role.system_key = 'RECRUITER'

      UNION

      SELECT child.tenant_id, child.id, child.base_role_id
      FROM ats.custom_roles child
      JOIN recruiter_role_tree parent
        ON parent.tenant_id = child.tenant_id AND parent.id = child.base_role_id
    )
    SELECT staff.id, staff.full_name AS "fullName", staff.email AS "email", staff.profile_picture AS "avatar", eligibility."canRecruit", eligibility."canReview"
    FROM ats.users staff
    CROSS JOIN LATERAL (
      SELECT COALESCE(BOOL_OR(recruiter_role.id IS NOT NULL), false) AS "canRecruit",
             COALESCE(BOOL_OR(role.permissions::jsonb ? 'job:approve'), false) AS "canReview"
      FROM ats.custom_roles role
      LEFT JOIN recruiter_role_tree recruiter_role
        ON recruiter_role.tenant_id = role.tenant_id AND recruiter_role.id = role.id
      WHERE role.tenant_id = staff.tenant_id
        AND (role.id = staff.role_id OR role.id = ANY(staff.assigned_role_ids))
        AND (role.branch_id IS NULL OR role.branch_id = staff.branch_id)
        AND (role.business_unit_id IS NULL OR role.business_unit_id = staff.business_unit_id)
    ) eligibility
    WHERE staff.tenant_id = $1::uuid AND staff.is_active = true AND staff.is_approved = true
      AND ($2::uuid IS NULL OR staff.branch_id = $2::uuid)
      AND ($3::uuid IS NULL OR staff.business_unit_id = $3::uuid)
      AND ($4::uuid IS NULL OR staff.pod_id = $4::uuid)
      AND eligibility."canRecruit"
    ORDER BY staff.full_name, staff.id`, tenantId, branchId, unitId, podId || null);
}

export async function validateJobRecruiters(prisma: PrismaService, actor: AuthUser, tenantId: string,
  ids: string[], branchId?: string | null, unitId?: string | null, jobId?: string) {
  if (ids.some(id => !uuid.test(id))) throw new BadRequestException('Select valid recruiter IDs.');
  const eligible = await listJobStaff(prisma, actor, tenantId, branchId || undefined, unitId || undefined, jobId);
  const allowed = new Set(eligible.filter(staff => staff.canRecruit).map(staff => staff.id));
  if (ids.some(id => !allowed.has(id))) throw new ForbiddenException('A selected recruiter is outside the eligible job staffing scope.');
}
