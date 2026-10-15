import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { AuthUser } from '../auth/interfaces/auth-user.interface';
import { DELIVERY_STAGES, type DeliveryDashboard, type DeliveryStage } from './delivery-dashboard.contract';
import { aggregateDeliveryPipeline, deliveryStageWhere } from './delivery-pipeline';

@Injectable()
export class DeliveryDashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async scope(user: AuthUser) {
    if (!user.permissions?.includes('unit_admin:manage') || !user.dbId || !user.tenantId) throw new ForbiddenException('Unit management permission is required.');
    // Refresh membership from the database; a stale token cannot select a former unit.
    const member = await this.prisma.user.findFirst({ where: { id: user.dbId, tenantId: user.tenantId, isActive: true, isApproved: true }, select: { branchId: true, businessUnitId: true } });
    if (!member?.branchId || !member.businessUnitId) throw new ForbiddenException('An active branch and unit assignment is required.');
    const where = { tenantId: user.tenantId, branchId: member.branchId, businessUnitId: member.businessUnitId };
    const unit = await this.prisma.businessUnit.findFirst({ where: { id: where.businessUnitId, tenantId: where.tenantId, branchId: where.branchId }, select: { id: true, name: true, branch: { select: { name: true } } } });
    if (!unit) throw new ForbiddenException('Your current unit assignment is unavailable.');
    return { where, unit };
  }

  async dashboard(user: AuthUser, stageInput = 'review', submissionPage = 1, memberPage = 1): Promise<DeliveryDashboard> {
    if (!DELIVERY_STAGES.includes(stageInput as DeliveryStage) || !Number.isSafeInteger(submissionPage) || submissionPage < 1 || submissionPage > 100000 || !Number.isSafeInteger(memberPage) || memberPage < 1 || memberPage > 100000) throw new BadRequestException('Invalid dashboard filters.');
    const stage = stageInput as DeliveryStage;
    const { where, unit } = await this.scope(user);
    const has = (permission: string) => user.permissions?.includes(permission) === true;
    const seeJobs = has('job:view');
    const seeSubmissions = has('submission:view');
    const seeMembers = has('user:manage');
    const seePods = has('pod:view');
    const submissionWhere = { tenantId: where.tenantId, job: { ...where, deletedAt: null } };
    const stageWhere = { AND: [submissionWhere, deliveryStageWhere(stage)] };
    const now = new Date();
    const [groups, activeJobs, jobs, members, memberTotal, pods, submissions, submissionTotal, interviewRounds, submissionTargets] = await Promise.all([
      seeSubmissions ? this.prisma.recruiterSubmission.groupBy({ by: ['finalStatus', 'l1Status', 'l2Status', 'l3Status'], where: submissionWhere, _count: { _all: true } }) : null,
      seeJobs ? this.prisma.job.count({ where: { ...where, deletedAt: null, status: { in: ['ACTIVE', 'Active'] } } }) : null,
      seeJobs ? this.prisma.$queryRaw<DeliveryDashboard['jobs']>`
        SELECT j.id, j.job_title AS "jobTitle", j.job_code AS "jobCode", j.urgency, j.status,
          CASE WHEN ${seeSubmissions} THEN (SELECT COUNT(*)::int FROM ats.recruiter_submissions s WHERE s.job_id = j.id AND s.tenant_id = ${where.tenantId}::uuid) ELSE NULL END AS submissions
        FROM ats.jobs j
        WHERE j.tenant_id = ${where.tenantId}::uuid AND j.branch_id = ${where.branchId}::uuid
          AND j.business_unit_id = ${where.businessUnitId}::uuid AND j.deleted_at IS NULL AND UPPER(j.status) = 'ACTIVE'
        ORDER BY CASE UPPER(j.urgency) WHEN 'URGENT' THEN 0 WHEN 'HOT' THEN 1 WHEN 'HIGH' THEN 2 WHEN 'WARM' THEN 3 WHEN 'MEDIUM' THEN 4 ELSE 5 END, j.created_at DESC, j.id
        LIMIT 8
      ` : [],
      seeMembers ? this.prisma.user.findMany({ where: { ...where, isApproved: false, requestedRole: { not: null } }, select: { id: true, fullName: true, email: true, requestedRole: true }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], skip: (memberPage - 1) * 10, take: 10 }) : null,
      seeMembers ? this.prisma.user.count({ where: { ...where, isApproved: false, requestedRole: { not: null } } }) : null,
      seePods ? this.prisma.pod.findMany({ where, select: { id: true, name: true, _count: { select: { users: { where: { ...where, isActive: true } }, ...(seeJobs ? { jobPods: { where: { job: { ...where, deletedAt: null, status: { in: ['ACTIVE', 'Active'] } } } } } : {}) } } }, orderBy: { name: 'asc' }, take: 8 }) : null,
      seeSubmissions ? this.prisma.recruiterSubmission.findMany({ where: stageWhere, select: { id: true, finalStatus: true, updatedAt: true, candidate: { select: { fullName: true, tenantId: true } }, job: { select: { jobTitle: true } } }, orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }], skip: (submissionPage - 1) * 10, take: 10 }) : null,
      seeSubmissions ? this.prisma.recruiterSubmission.count({ where: stageWhere }) : null,
      seeSubmissions ? Promise.all((['l1', 'l2', 'l3'] as const).map(async round => {
        const rows = await this.prisma.recruiterSubmission.findMany({
          where: { AND: [submissionWhere, deliveryStageWhere(round), { [`${round}Status`]: 'SCHEDULED', [`${round}Date`]: { gte: now } }] },
          select: { id: true, l1Date: true, l2Date: true, l3Date: true, candidate: { select: { fullName: true, tenantId: true } }, job: { select: { jobTitle: true } } },
          orderBy: { [`${round}Date`]: 'asc' }, take: 10,
        });
        return rows.map(row => ({ id: row.id, candidateName: row.candidate.tenantId === where.tenantId ? row.candidate.fullName || 'Name unavailable' : 'Name unavailable', jobTitle: row.job.jobTitle, round, date: row[`${round}Date`]!.toISOString() }));
      })) : null,
      seeJobs && seeSubmissions ? this.prisma.job.aggregate({ where: { ...where, deletedAt: null }, _sum: { submissionRequired: true } }) : null,
    ]);
    return {
      unit: { id: unit.id, name: unit.name, branchName: unit.branch?.name || '' }, activeJobs,
      submissionRequired: submissionTargets ? submissionTargets._sum.submissionRequired ?? 0 : null,
      pipeline: groups ? aggregateDeliveryPipeline(groups) : null,
      jobs,
      pendingUsers: members, pendingUserTotal: memberTotal, pendingUserPage: memberPage,
      pods: pods?.map(pod => ({ id: pod.id, name: pod.name, members: pod._count.users, jobs: seeJobs ? pod._count.jobPods : null })) ?? null,
      submissions: submissions?.map(submission => ({ id: submission.id, candidateName: submission.candidate.tenantId === where.tenantId ? submission.candidate.fullName || 'Name unavailable' : 'Name unavailable', jobTitle: submission.job.jobTitle, finalStatus: submission.finalStatus, updatedAt: submission.updatedAt.toISOString() })) ?? null,
      submissionTotal, submissionPage, stage,
      interviews: interviewRounds?.flat().sort((a, b) => a.date.localeCompare(b.date)).slice(0, 10) ?? null,
    };
  }

  async setMemberActive(user: AuthUser, id: string, isActive: unknown) {
    if (!user.permissions?.includes('user:manage')) throw new ForbiddenException('User management permission is required.');
    if (typeof isActive !== 'boolean') throw new BadRequestException('Choose an active or inactive account status.');
    if (id === user.dbId) throw new ForbiddenException('You cannot change your own account status here.');
    const { where } = await this.scope(user);
    return this.prisma.$transaction(async tx => {
      const target = await tx.user.findFirst({ where: { ...where, id }, select: { assignedRoleIds: true, roleId: true, isActive: true, updatedAt: true } });
      if (!target) throw new NotFoundException('Member not found in your current unit.');
      const roleIds = [...new Set([...target.assignedRoleIds, ...(target.roleId ? [target.roleId] : [])])];
      const roles = await tx.customRole.findMany({ where: { tenantId: where.tenantId, id: { in: roleIds } }, select: { permissions: true } });
      const actorPermissions = user.permissions || [];
      if (roles.length !== roleIds.length || roles.some(role => !Array.isArray(role.permissions) || role.permissions.some(permission => typeof permission !== 'string' || !actorPermissions.includes(permission)))) throw new ForbiddenException('You cannot manage an account with permissions beyond your own.');
      if (target.isActive === isActive) return { id, isActive };
      const result = await tx.user.updateMany({ where: { ...where, id, updatedAt: target.updatedAt }, data: { isActive } });
      if (!result.count) throw new ConflictException('Member changed. Refresh your unit dashboard and try again.');
      await tx.auditLog.create({ data: { tenantId: where.tenantId, actorId: user.dbId, actorEmail: user.email, action: 'UNIT_MEMBER_ACCESS_CHANGED', targetType: 'user', targetId: id, details: { branchId: where.branchId, businessUnitId: where.businessUnitId, before: target.isActive, after: isActive } } });
      return { id, isActive };
    });
  }
}
