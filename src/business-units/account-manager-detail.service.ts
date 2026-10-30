import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { AuthUser } from '../auth/interfaces/auth-user.interface';
import { clientReadWhere } from '../clients/client-visibility';
import { normalizeJobStatus } from '../jobs/job-status-contract';
import { DeliveryDashboardService } from './delivery-dashboard.service';
import { AccountManagerDashboardService } from './account-manager-dashboard.service';
import { aggregateDeliveryPipeline } from './delivery-pipeline';
import { managerMilestones, metricPeriod, milestoneCondition, performanceTrendRange, performanceWeeks } from './manager-performance-sql';
import type { ManagerClientPerformance, ManagerDetailFilters, ManagerJobPerformance, ManagerPerformanceDetail } from './delivery-dashboard.contract';

type JobAggregate = { id: string; title: string; code: string; status: string; clientId: string | null; employmentType: string; positions: number;
  postedJobs: number; postedPositions: number; submissions: number; allSubmissions: number; offers: number; joined: number;
  groups: Parameters<typeof aggregateDeliveryPipeline>[0] };
type DetailsAggregate = { jobs: JobAggregate[]; submissions: { bucket: number; count: number }[] };

@Injectable()
export class AccountManagerDetailService {
  constructor(private readonly prisma: PrismaService, private readonly delivery: DeliveryDashboardService, private readonly comparison: AccountManagerDashboardService) {}

  async detail(user: AuthUser, managerId: string, filters: ManagerDetailFilters): Promise<ManagerPerformanceDetail> {
    const { from = '', to = '', clientId = '', employmentType = '', jobSearch = '', jobStatus = '', jobPage = 1, clientPage = 1, clientMode = 'added', attention } = filters;
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(managerId)
      || typeof jobSearch !== 'string' || jobSearch.length > 100 || typeof jobStatus !== 'string' || (jobStatus && !normalizeJobStatus(jobStatus))
      || !Number.isSafeInteger(jobPage) || jobPage < 1 || !Number.isSafeInteger(clientPage) || clientPage < 1
      || !['added', 'portfolio'].includes(clientMode) || (attention !== undefined && !['review', 'uncovered'].includes(attention))) throw new BadRequestException('Invalid manager performance filters.');
    const scope = await this.delivery.scope(user);
    const base = await this.comparison.dashboard(user, { accountManagerId: managerId, from, to, clientId, employmentType }, scope);
    const manager = base.rows[0];
    if (!manager) throw new NotFoundException('Account manager is unavailable in your current unit.');
    const has = (permission: string) => user.permissions?.includes(permission) === true;
    const jobsAllowed = has('job:view'), submissionsAllowed = has('submission:view'), reviewAllowed = submissionsAllowed && has('submission:internal_screening');
    const clientsAllowed = has('client:view');
    if ((attention === 'review' && (!jobsAllowed || !reviewAllowed)) || (attention === 'uncovered' && (!jobsAllowed || !submissionsAllowed))) throw new ForbiddenException('The selected queue requires additional permissions.');
    const { where } = scope;
    const actor = { ...user, branchId: where.branchId, businessUnitId: where.businessUnitId };
    // Reuse the actual client-directory policy, including unit ownership and
    // tenant-configured visibility. Do not infer visibility from job ownership.
    const clientWhere = clientsAllowed ? await clientReadWhere(this.prisma, where.tenantId, actor) : null;
    const clients = clientWhere ? await this.prisma.client.findMany({ where: { AND: [clientWhere, { deletedAt: null }, { OR: [
      { createdBy: managerId }, { jobsAsClient: { some: { ...where, accountManagerId: managerId, deletedAt: null } } },
    ] }] }, select: { id: true, clientName: true, createdBy: true, createdAt: true, status: true }, orderBy: [{ clientName: 'asc' }, { id: 'asc' }] }) : [];
    if (clientId && !clients.some(client => client.id === clientId)) throw new NotFoundException('Client is unavailable in this manager view.');
    const { start, end } = performanceTrendRange(from, to);
    const period = (column: Prisma.Sql) => metricPeriod(column, from, to);
    const [aggregate] = await this.prisma.$queryRaw<DetailsAggregate[]>(Prisma.sql`
      WITH filtered_jobs AS (
        SELECT j.id, j.job_title, j.job_code, j.status, j.client_id, j.job_type, j.no_of_positions, j.approved_at, j.account_manager_id
        FROM ats.jobs j WHERE ${jobsAllowed || submissionsAllowed} AND j.tenant_id = ${where.tenantId}::uuid AND j.branch_id = ${where.branchId}::uuid
          AND j.business_unit_id = ${where.businessUnitId}::uuid AND j.account_manager_id = ${managerId}::uuid AND j.deleted_at IS NULL
          AND UPPER(COALESCE(j.approval_status, '')) = 'APPROVED' AND UPPER(j.status) NOT IN ('DRAFT', 'REJECTED')
          AND (${clientId} = '' OR j.client_id::text = ${clientId}) AND (${employmentType} = '' OR j.job_type = ${employmentType})
      ), milestones AS (${managerMilestones(where.tenantId, submissionsAllowed)}), outcomes AS (
        SELECT job_id, COUNT(*)::int AS all_submissions, COUNT(*) FILTER (WHERE ${period(Prisma.sql`created_at`)})::int AS submissions,
          COUNT(*) FILTER (WHERE ${milestoneCondition('OFFER', from, to)})::int AS offers,
          COUNT(*) FILTER (WHERE ${milestoneCondition('JOIN', from, to)})::int AS joined FROM milestones GROUP BY job_id
      ), stage_groups AS (
        ${submissionsAllowed ? Prisma.sql`SELECT s.job_id, s.final_status, s.l1_status, s.l2_status, s.l3_status, COUNT(*)::int AS count
          FROM ats.recruiter_submissions s JOIN filtered_jobs j ON j.id = s.job_id WHERE s.tenant_id = ${where.tenantId}::uuid
          GROUP BY s.job_id, s.final_status, s.l1_status, s.l2_status, s.l3_status`
        : Prisma.sql`SELECT NULL::uuid AS job_id, ''::text AS final_status, ''::text AS l1_status, NULL::text AS l2_status, NULL::text AS l3_status, 0::int AS count WHERE FALSE`}
      ), pipeline AS (
        SELECT job_id, jsonb_agg(jsonb_build_object('finalStatus', final_status, 'l1Status', l1_status, 'l2Status', l2_status,
          'l3Status', l3_status, '_count', jsonb_build_object('_all', count))) AS groups FROM stage_groups GROUP BY job_id
      ), weekly AS (
        SELECT FLOOR(EXTRACT(EPOCH FROM (created_at - ${start})) / 604800)::int AS bucket, COUNT(*)::int AS count
        FROM milestones WHERE created_at >= ${start} AND created_at < ${end} GROUP BY bucket
      ) SELECT COALESCE((SELECT jsonb_agg(jsonb_build_object('id', j.id, 'title', j.job_title, 'code', j.job_code, 'status', j.status,
          'clientId', j.client_id, 'employmentType', j.job_type, 'positions', j.no_of_positions,
          'postedJobs', CASE WHEN ${period(Prisma.sql`j.approved_at`)} THEN 1 ELSE 0 END,
          'postedPositions', CASE WHEN ${period(Prisma.sql`j.approved_at`)} THEN j.no_of_positions ELSE 0 END,
          'submissions', COALESCE(o.submissions, 0), 'allSubmissions', COALESCE(o.all_submissions, 0), 'offers', COALESCE(o.offers, 0), 'joined', COALESCE(o.joined, 0),
          'groups', COALESCE(p.groups, '[]'::jsonb)) ORDER BY j.job_title, j.id)
        FROM filtered_jobs j LEFT JOIN outcomes o ON o.job_id = j.id LEFT JOIN pipeline p ON p.job_id = j.id), '[]'::jsonb) AS jobs,
        COALESCE((SELECT jsonb_agg(jsonb_build_object('bucket', bucket, 'count', count) ORDER BY bucket) FROM weekly), '[]'::jsonb) AS submissions
    `);
    const clientMap = new Map(clients.map(client => [client.id, client]));
    const rawJobMap = new Map(aggregate.jobs.map(job => [job.id, job]));
    const jobs: ManagerJobPerformance[] = aggregate.jobs.map(job => ({
      id: job.id, title: job.title, code: job.code, status: job.status, clientId: job.clientId && clientMap.has(job.clientId) ? job.clientId : null,
      clientName: job.clientId ? clientMap.get(job.clientId)?.clientName ?? null : null, employmentType: job.employmentType,
      positions: job.positions, postedJobs: job.postedJobs, postedPositions: job.postedPositions,
      submissions: submissionsAllowed ? job.submissions : null, offers: submissionsAllowed ? job.offers : null, joined: submissionsAllowed ? job.joined : null,
      review: reviewAllowed ? aggregateDeliveryPipeline(job.groups).review : null,
    }));
    const inPeriod = (value: Date) => !from || (value.getTime() >= Date.parse(from) && value.getTime() < Date.parse(to));
    const jobsByClient = new Map<string, ManagerJobPerformance[]>();
    for (const job of jobs) if (job.clientId) { const group = jobsByClient.get(job.clientId) ?? []; group.push(job); jobsByClient.set(job.clientId, group); }
    const relevantClients = clients.filter(client => (!clientId || client.id === clientId) && (!employmentType || jobsByClient.has(client.id)));
    const clientRows: ManagerClientPerformance[] = relevantClients.map(client => {
      const portfolio = jobsByClient.get(client.id) ?? [];
      const sum = (field: 'postedJobs' | 'postedPositions' | 'submissions' | 'review' | 'offers' | 'joined') => portfolio.reduce((total, job) => total + (job[field] ?? 0), 0);
      return { id: client.id, name: client.clientName, status: client.status, addedByManager: client.createdBy === managerId, addedAt: client.createdAt.toISOString(),
        postedJobs: jobsAllowed ? sum('postedJobs') : null, activeJobs: jobsAllowed ? portfolio.filter(job => job.status.toUpperCase() === 'ACTIVE').length : null,
        closedJobs: jobsAllowed ? portfolio.filter(job => job.status.toUpperCase() === 'CLOSED').length : null, positions: jobsAllowed ? sum('postedPositions') : null,
        submissions: submissionsAllowed ? sum('submissions') : null, review: reviewAllowed ? sum('review') : null,
        offers: submissionsAllowed ? sum('offers') : null, joined: submissionsAllowed ? sum('joined') : null };
    });
    const added = relevantClients.filter(client => client.createdBy === managerId && inPeriod(client.createdAt));
    const portfolioIds = new Set(jobs.map(job => job.clientId).filter(Boolean));
    const visibleClients = clientRows.filter(client => clientMode === 'added' ? client.addedByManager && inPeriod(new Date(client.addedAt)) : jobsAllowed && portfolioIds.has(client.id));
    const weekCounts = new Map<number, number>();
    for (const client of relevantClients) if (client.createdBy === managerId && client.createdAt >= start && client.createdAt < end) {
      const bucket = Math.floor((client.createdAt.getTime() - start.getTime()) / (7 * 86400000)); weekCounts.set(bucket, (weekCounts.get(bucket) ?? 0) + 1);
    }
    const tableJobs = jobs.filter(job => (!jobStatus || normalizeJobStatus(job.status) === normalizeJobStatus(jobStatus))
      && `${job.title} ${job.code} ${job.clientName ?? ''}`.toLowerCase().includes(jobSearch.trim().toLowerCase())
      && (!attention || (attention === 'review' ? (job.review ?? 0) > 0 : job.status.toUpperCase() === 'ACTIVE' && rawJobMap.get(job.id)?.allSubmissions === 0)));
    const limit = 20;
    return { manager, unit: base.unit, pipeline: base.charts?.pipeline[0] ?? null,
      weekly: { submissions: submissionsAllowed ? performanceWeeks(start, end, aggregate.submissions) : null, closures: base.charts?.weekly ?? null,
        clientsAdded: clientsAllowed ? performanceWeeks(start, end, [...weekCounts].map(([bucket, count]) => ({ bucket, count }))) : null },
      weeklyScope: from ? 'selected-period' : 'last-12-weeks',
      attention: { uncoveredJobs: jobsAllowed && submissionsAllowed ? aggregate.jobs.filter(job => job.status.toUpperCase() === 'ACTIVE' && job.allSubmissions === 0).length : null, pendingReview: manager.review },
      jobs: { rows: jobsAllowed ? tableJobs.slice((jobPage - 1) * limit, jobPage * limit) : [], total: jobsAllowed ? tableJobs.length : 0, page: jobPage, limit },
      clients: { rows: visibleClients.slice((clientPage - 1) * limit, clientPage * limit), total: visibleClients.length, page: clientPage, limit,
        added: clientsAllowed ? added.length : null, portfolio: clientsAllowed && jobsAllowed ? portfolioIds.size : null,
        closures: clientsAllowed && submissionsAllowed ? [...visibleClients].sort((a, b) => (b.joined ?? 0) - (a.joined ?? 0) || a.name.localeCompare(b.name)).slice(0, 5).map(client => ({ id: client.id, name: client.name, count: client.joined! })) : [] },
      options: { clients: clients.map(client => ({ id: client.id, name: client.clientName })), employmentTypes: base.options.employmentTypes },
      undatedOutcomes: base.undatedOutcomes, undatedPostedJobs: base.undatedPostedJobs };
  }
}
