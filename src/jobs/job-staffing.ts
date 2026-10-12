import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { resolveBranchId } from '../auth/utils/branch-resolver';
import type { AuthUser } from '../auth/interfaces/auth-user.interface';
import type { PrismaService } from '../prisma/prisma.service';

export interface JobStaffOption {
  id: string;
  fullName: string;
  email?: string;
  canRecruit: boolean;
  canReview: boolean;
}

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function resolveJobStaffingScope(prisma: PrismaService, actor: AuthUser, tenantId: string,
  requestedBranch?: string, requestedUnit?: string, permission = 'job:assign_recruiter', jobId?: string) {
  if (!actor.permissions?.includes(permission)) {
    throw new ForbiddenException(permission === 'job:assign_recruiter' ? 'Recruiter assignment permission is required.' : 'Pod assignment permission is required.');
  }
  for (const id of [requestedBranch, requestedUnit, jobId]) {
    if (id && !uuid.test(id)) throw new BadRequestException('Select a valid branch, unit, or job.');
  }
  let branchId = resolveBranchId(actor, requestedBranch);
  const tenantManager = actor.permissions.some(p => ['tenant:settings', 'tenant:manage', 'platform:manage'].includes(p));
  const deliveryHead = (actor.roles || []).some((r: string) => ['DELIVERY_HEAD', 'DELIVERYHEAD'].includes(r.toUpperCase().replace(/[\s-_]+/g, ''))) || actor.permissions.includes('job:assign');
  const branchManager = tenantManager || actor.permissions.includes('branch_admin:manage') || deliveryHead;

  let isJobOwner = false;
  let jobResolvedUnit: string | null = null;
  let jobResolvedBranch: string | null = null;

  if (jobId) {
    const job = await prisma.job.findFirst({
      where: { id: jobId, tenantId, deletedAt: null },
      select: { accountManagerId: true, recruitmentManagerId: true, branchId: true, businessUnitId: true },
    });
    if (job) {
      isJobOwner = Boolean(
        (job.accountManagerId && (actor.dbId === job.accountManagerId || (actor as any).id === job.accountManagerId)) ||
        (job.recruitmentManagerId && (actor.dbId === job.recruitmentManagerId || (actor as any).id === job.recruitmentManagerId))
      );
      if (!branchManager && !isJobOwner) {
        throw new ForbiddenException('Account Managers can only assign recruiters to their own created jobs.');
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
  requestedBranch?: string, requestedUnit?: string) {
  const { branchId, unitId } = await resolveJobStaffingScope(prisma, actor, tenantId, requestedBranch, requestedUnit, 'job:assign_pod');
  if (!unitId) throw new BadRequestException('Select an operating unit.');
  return prisma.pod.findMany({ where: { tenantId, businessUnitId: unitId, ...(branchId ? { branchId } : {}) },
    select: { id: true, name: true, businessUnitId: true, branchId: true, podHeadId: true }, orderBy: { name: 'asc' } });
}

export async function listJobStaff(prisma: PrismaService, actor: AuthUser, tenantId: string,
  requestedBranch?: string, requestedUnit?: string, jobId?: string): Promise<JobStaffOption[]> {
  const { branchId, unitId } = await resolveJobStaffingScope(prisma, actor, tenantId, requestedBranch, requestedUnit, 'job:assign_recruiter', jobId);
  return prisma.$queryRawUnsafe<JobStaffOption[]>(`
    SELECT staff.id, staff.full_name AS "fullName", staff.email AS "email", eligibility."canRecruit", eligibility."canReview"
    FROM ats.users staff
    CROSS JOIN LATERAL (
      SELECT COALESCE(BOOL_OR(role.permissions::jsonb ? 'submission:create'), false) AS "canRecruit",
             COALESCE(BOOL_OR(role.permissions::jsonb ? 'job:approve'), false) AS "canReview"
      FROM ats.custom_roles role
      WHERE role.tenant_id = staff.tenant_id
        AND (role.id = staff.role_id OR role.id = ANY(staff.assigned_role_ids))
        AND (role.branch_id IS NULL OR role.branch_id = staff.branch_id)
        AND (role.business_unit_id IS NULL OR role.business_unit_id = staff.business_unit_id)
    ) eligibility
    WHERE staff.tenant_id = $1::uuid AND staff.is_active = true AND staff.is_approved = true
      AND ($2::uuid IS NULL OR staff.branch_id = $2::uuid)
      AND ($3::uuid IS NULL OR staff.business_unit_id = $3::uuid)
      AND (eligibility."canRecruit" OR eligibility."canReview")
    ORDER BY staff.full_name, staff.id`, tenantId, branchId, unitId);
}

export async function validateJobRecruiters(prisma: PrismaService, actor: AuthUser, tenantId: string,
  ids: string[], branchId?: string | null, unitId?: string | null) {
  if (ids.some(id => !uuid.test(id))) throw new BadRequestException('Select valid recruiter IDs.');
  const eligible = await listJobStaff(prisma, actor, tenantId, branchId || undefined, unitId || undefined);
  const allowed = new Set(eligible.filter(staff => staff.canRecruit).map(staff => staff.id));
  if (ids.some(id => !allowed.has(id))) throw new ForbiddenException('A selected recruiter is outside the eligible job staffing scope.');
}
