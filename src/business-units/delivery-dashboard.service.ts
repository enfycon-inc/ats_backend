import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma } from '@prisma/client';
import type { DeliveryFilterOption, DeliveryFilterOptions } from './delivery-dashboard.contract';
import type { AuthUser } from '../auth/interfaces/auth-user.interface';
import { DELIVERY_STAGES, type DeliveryDashboard, type DeliveryStage } from './delivery-dashboard.contract';
import { aggregateDeliveryPipeline, deliveryStageWhere } from './delivery-pipeline';
import { deliveryAnalytics } from './delivery-analytics';

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

  async filterOptions(user: AuthUser, kind: string, search = '', page = 1): Promise<DeliveryFilterOptions> {
    if (!['client', 'postedBy', 'submittedBy'].includes(kind) || !Number.isSafeInteger(page) || page < 1 || page > 100000 || search.length > 150) throw new BadRequestException('Invalid filter options.');
    if (!user.permissions?.includes('submission:view')) throw new ForbiddenException('Submission view permission is required.');
    const { where } = await this.scope(user);
    const entities = kind === 'client' ? Prisma.sql`
      SELECT DISTINCT c.id::text AS id,c.client_name AS name,NULL::text AS email
      FROM scoped s JOIN ats.clients c ON c.id=s.client_id AND c.tenant_id=${where.tenantId}::uuid`
      : kind === 'postedBy' ? Prisma.sql`
      SELECT DISTINCT u.id::text AS id,u.full_name AS name,u.email
      FROM scoped s JOIN ats.users u ON u.id=s.created_by_user_id AND u.tenant_id=${where.tenantId}::uuid`
      : Prisma.sql`
      SELECT DISTINCT u.id::text AS id,u.full_name AS name,u.email
      FROM scoped s LEFT JOIN LATERAL (
        SELECT e.actor_id FROM ats.submission_events e WHERE e.submission_id=s.id AND e.tenant_id=${where.tenantId}::uuid AND e.kind='CREATED'
        ORDER BY e.sequence ASC,e.id ASC LIMIT 1
      ) original ON true
      JOIN ats.users u ON u.id::text=COALESCE(original.actor_id,s.recruiter_id) AND u.tenant_id=${where.tenantId}::uuid
      WHERE s.submission_origin<>'WEBSITE'
      UNION SELECT 'website','Website Applicant',NULL::text FROM scoped WHERE submission_origin='WEBSITE'`;
    const rows = await this.prisma.$queryRaw<DeliveryFilterOption[]>(Prisma.sql`
      WITH scoped AS (
        SELECT s.id,s.recruiter_id,s.submission_origin,j.client_id,j.created_by_user_id
        FROM ats.recruiter_submissions s JOIN ats.jobs j ON j.id=s.job_id AND j.tenant_id=s.tenant_id
        WHERE s.tenant_id=${where.tenantId}::uuid AND j.branch_id=${where.branchId}::uuid AND j.business_unit_id=${where.businessUnitId}::uuid AND j.deleted_at IS NULL
      ), entities AS (${entities})
      SELECT id,COALESCE(name,email,'Name unavailable') AS name,email FROM entities
      WHERE POSITION(LOWER(${search.trim()}) IN LOWER(COALESCE(name,'') || ' ' || COALESCE(email,'')))>0
      ORDER BY name ASC NULLS LAST,id ASC LIMIT 26 OFFSET ${(page - 1) * 25}`);
    return { items: rows.slice(0, 25), nextPage: rows.length > 25 ? page + 1 : null };
  }

  async jobDrilldown(user: AuthUser, filters: Record<string, string>) {
    if (!user.permissions?.includes('job:view')) throw new ForbiddenException('Job view permission is required.');
    if (filters.cities && !user.permissions?.includes('user:manage')) throw new ForbiddenException('User management permission is required for staff city comparisons.');
    const { where } = await this.scope(user);
    const result = await deliveryAnalytics(this.prisma, where, { jobs: true, submissions: user.permissions.includes('submission:view'), members: false }, { ...filters, jobPage: filters.jobPage || '1' }, 'all', 1);
    return result.jobResults!;
  }

  async dashboard(user: AuthUser, stageInput = 'review', submissionPage = 1, memberPage = 1, filters: Record<string, string> = {}): Promise<DeliveryDashboard> {
    if (!DELIVERY_STAGES.includes(stageInput as DeliveryStage) || !Number.isSafeInteger(submissionPage) || submissionPage < 1 || submissionPage > 100000 || !Number.isSafeInteger(memberPage) || memberPage < 1 || memberPage > 100000) throw new BadRequestException('Invalid dashboard filters.');
    const stage = stageInput as DeliveryStage;
    const { where, unit } = await this.scope(user);
    const has = (permission: string) => user.permissions?.includes(permission) === true;
    const seeJobs = has('job:view');
    const seeSubmissions = has('submission:view');
    const seeMembers = has('user:manage');
    const seePods = has('pod:view');
    if (filters.cities && !seeMembers) throw new ForbiddenException('User management permission is required for staff city comparisons.');
    const analytics = filters.analytics === '1' ? await deliveryAnalytics(this.prisma, where, { jobs: seeJobs, submissions: seeSubmissions, members: seeMembers }, filters, stage, submissionPage) : undefined;
    const submissionWhere = { tenantId: where.tenantId, job: { ...where, deletedAt: null } };
    const text = (key: string) => String(filters[key] || '').trim().slice(0, 150);
    const search = text('search'), status = text('status');
    const identity = (value: string) => ({ OR: [{ fullName: { contains: value, mode: 'insensitive' as const } }, { email: { contains: value, mode: 'insensitive' as const } }] });
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const ids = (key: string, website = false): string[] => {
      const raw = filters[key];
      if (!raw) return [];
      if (typeof raw !== 'string' || raw.length > 3700) throw new BadRequestException('Select valid filter options.');
      const list = raw.split(',');
      if (list.length > 100 || list.some(id => !uuid.test(id) && !(website && id === 'website'))) throw new BadRequestException('Select valid filter options.');
      return [...new Set(list)];
    };
    const postedBy = ids('postedBy'), client = ids('client'), submittedBy = ids('submittedBy', true);
    const recruiterIdsFilter = submittedBy.filter(id => id !== 'website');
    let stageWhere: import('@prisma/client').Prisma.RecruiterSubmissionWhereInput = { AND: [submissionWhere, deliveryStageWhere(stage),
      ...(search ? [{ OR: [{ candidate: { tenantId: where.tenantId, ...identity(search) } }, { job: { jobTitle: { contains: search, mode: 'insensitive' as const } } }, { job: { jobCode: { contains: search, mode: 'insensitive' as const } } }] }] : []),
      ...(postedBy.length ? [{ job: { createdByUser: { tenantId: where.tenantId, id: { in: postedBy } } } }] : []),
      ...(client.length ? [{ job: { clientRef: { tenantId: where.tenantId, id: { in: client } } } }] : []),
      ...(submittedBy.length ? [{ OR: [
        ...(submittedBy.includes('website') ? [{ submissionOrigin: 'WEBSITE' }] : []),
        ...(recruiterIdsFilter.length ? [{ submissionOrigin: { not: 'WEBSITE' }, OR: [{ events: { some: { tenantId: where.tenantId, kind: 'CREATED', actorId: { in: recruiterIdsFilter } } } }, { AND: [{ events: { none: { kind: 'CREATED', tenantId: where.tenantId, actorId: { not: null } } } }, { recruiterId: { in: recruiterIdsFilter } }] }] }] : []),
      ] }] : []),
      ...(status ? [stage === 'l1' ? { l1Status: status } : stage === 'l2' ? { l2Status: status } : stage === 'l3' ? { l3Status: status } : { finalStatus: status }] : []),
    ] };
    if (analytics) stageWhere = { ...submissionWhere, id: { in: analytics.submissionIds } };
    const now = new Date();
    const [groups, activeJobs, jobs, members, memberTotal, pods, submissions, submissionTotal, interviewRounds, submissionTargets] = await Promise.all([
      analytics ? analytics.groups : seeSubmissions ? this.prisma.recruiterSubmission.groupBy({ by: ['finalStatus', 'l1Status', 'l2Status', 'l3Status'], where: submissionWhere, _count: { _all: true } }) : null,
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
      seeSubmissions ? this.prisma.recruiterSubmission.findMany({ where: stageWhere, select: { id: true, events: { where: { kind: 'CREATED', tenantId: where.tenantId }, orderBy: { sequence: 'asc' }, take: 1, select: { actorId: true, actorName: true } }, recruiterId: true, submissionOrigin: true, createdAt: true, finalStatus: true, l1Status: true, l2Status: true, l3Status: true, l1Date: true, l2Date: true, l3Date: true, updatedAt: true, candidate: { select: { fullName: true, email: true, tenantId: true } }, job: { select: { id: true, jobTitle: true, jobCode: true, createdAt: true, createdByUser: { select: { fullName: true, email: true, city:true, tenantId: true } }, clientRef: { select: { clientName: true, tenantId: true } } } } }, orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }], skip: analytics ? 0 : (submissionPage - 1) * 10, take: 10 }) : null,
      analytics ? analytics.submissionTotal : seeSubmissions ? this.prisma.recruiterSubmission.count({ where: stageWhere }) : null,
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
    const recruiterIds = [...new Set((submissions || []).map(item => item.events?.[0]?.actorId || item.recruiterId).filter((id): id is string => !!id))];
    const recruiters = recruiterIds.length ? await this.prisma.user.findMany({ where: { tenantId: where.tenantId, id: { in: recruiterIds } }, select: { id: true, fullName: true, email: true, city:true } }) : [];
    const recruiterById = new Map(recruiters.map(person => [person.id, person]));
    if (analytics) submissions?.sort((first, second) => analytics.submissionIds.indexOf(first.id) - analytics.submissionIds.indexOf(second.id));
    return {
      analytics,
      unit: { id: unit.id, name: unit.name, branchName: unit.branch?.name || '' }, activeJobs,
      submissionRequired: analytics ? null : submissionTargets ? submissionTargets._sum.submissionRequired ?? 0 : null,
      pipeline: seeSubmissions && groups ? aggregateDeliveryPipeline(groups) : null,
      jobs,
      pendingUsers: members, pendingUserTotal: memberTotal, pendingUserPage: memberPage,
      pods: pods?.map(pod => ({ id: pod.id, name: pod.name, members: pod._count.users, jobs: seeJobs ? pod._count.jobPods : null })) ?? null,
      submissions: submissions?.map(submission => {
        const creator = submission.job.createdByUser?.tenantId === where.tenantId ? submission.job.createdByUser : null;
        const submitterId = submission.events?.[0]?.actorId || submission.recruiterId;
        const recruiter = submitterId ? recruiterById.get(submitterId) : null;
        const ownCandidate = submission.candidate.tenantId === where.tenantId;
        return { id: submission.id, offeredAt: analytics?.offeredDates[submission.id] || null, candidateName: ownCandidate ? submission.candidate.fullName || 'Name unavailable' : 'Name unavailable', candidateEmail: ownCandidate ? submission.candidate.email : null,
          jobId: submission.job.id, jobTitle: submission.job.jobTitle, jobCode: submission.job.jobCode, clientName: submission.job.clientRef?.tenantId === where.tenantId ? submission.job.clientRef.clientName : null,
          postedBy: { name: creator?.fullName || 'Name unavailable', email: creator?.email || null, city:creator?.city||null }, postedAt: submission.job.createdAt.toISOString(),
          submittedBy: { city:submission.submissionOrigin === 'WEBSITE' ? null : recruiter?.city||null, name: submission.submissionOrigin === 'WEBSITE' ? 'Website Applicant' : recruiter?.fullName || submission.events?.[0]?.actorName || 'Name unavailable', email: submission.submissionOrigin === 'WEBSITE' ? (ownCandidate ? submission.candidate.email : null) : recruiter?.email || null },
          submittedAt: submission.createdAt.toISOString(), origin: submission.submissionOrigin,
          finalStatus: submission.finalStatus, stageStatus: (stage === 'l1' ? submission.l1Status : stage === 'l2' ? submission.l2Status : stage === 'l3' ? submission.l3Status : submission.finalStatus) || 'PENDING', updatedAt: submission.updatedAt.toISOString(),
          rounds: [{ name: 'L1', status: submission.l1Status, date: submission.l1Date?.toISOString() || null }, { name: 'L2', status: submission.l2Status, date: submission.l2Date?.toISOString() || null }, { name: 'L3', status: submission.l3Status, date: submission.l3Date?.toISOString() || null }],
        };
      }) ?? null,
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
