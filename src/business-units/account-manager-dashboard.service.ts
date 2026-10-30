import { BadRequestException, ConflictException, ForbiddenException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import type { AuthUser } from '../auth/interfaces/auth-user.interface';
import { DeliveryDashboardService } from './delivery-dashboard.service';
import { aggregateDeliveryPipeline } from './delivery-pipeline';
import { managerMilestones, metricPeriod, milestoneCondition, performanceTrendRange, performanceWeeks } from './manager-performance-sql';
import { MANAGER_SORTS, type ManagerDashboard, type ManagerDashboardFilters, type ManagerComparisonRow } from './delivery-dashboard.contract';

type PipelineGroups = Parameters<typeof aggregateDeliveryPipeline>[0];
type AggregateRow = { id: string; name: string; email: string | null; avatar: string | null; postedJobs: number; activeJobs: number; closedJobs: number; positions: number; submissions: number; offers: number; joined: number; undated: number; undatedJoined: number; undatedPosted: number; groups: PipelineGroups };
type QueryResult = { weekly: { bucket: number; count: number }[]; managers: AggregateRow[]; roster: { id: string; name: string }[]; unassignedJobs: number; clients: { id: string; name: string }[]; markets: string[]; employmentTypes: string[] };

@Injectable()
export class AccountManagerDashboardService {
  constructor(private readonly prisma: PrismaService, private readonly delivery: DeliveryDashboardService) {}

  async dashboard(user: AuthUser, input: ManagerDashboardFilters, resolvedScope?: Awaited<ReturnType<DeliveryDashboardService['scope']>>): Promise<ManagerDashboard> {
    const { search = '', clientId = '', market = '', employmentType = '', accountManagerId = '', from = '', to = '', sort = 'joined', direction = sort === 'name' ? 'asc' : 'desc', offset = 0, limit = 10, snapshot } = input;
    const uuid = (value: unknown) => typeof value === 'string' && (!value || /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value));
    const date = (value: unknown) => typeof value === 'string' && (!value || /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value);
    if (typeof search !== 'string' || search.length > 100 || typeof market !== 'string' || market.length > 100 || typeof employmentType !== 'string' || employmentType.length > 100
      || typeof clientId !== 'string' || (clientId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(clientId))
      || !uuid(accountManagerId) || !date(from) || !date(to) || Boolean(from) !== Boolean(to) || (from && (Date.parse(to) <= Date.parse(from) || Date.parse(to) - Date.parse(from) > 366 * 86400000))
      || !MANAGER_SORTS.includes(sort) || !['asc', 'desc'].includes(direction) || !Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 100
      || (snapshot !== undefined && (typeof snapshot !== 'string' || !/^[a-f0-9]{64}$/.test(snapshot)))) throw new BadRequestException('Invalid account manager dashboard filters.');
    const { where, unit } = resolvedScope ?? await this.delivery.scope(user);
    const has = (permission: string) => user.permissions?.includes(permission) === true;
    if (!has('user:manage')) throw new ForbiddenException('User management permission is required to compare account managers.');
    const seeJobs = has('job:view');
    const seeSubmissions = has('submission:view');
    const seeReview = seeSubmissions && has('submission:internal_screening');
    const seeClients = seeJobs && has('client:view');
    const jobSorts = ['activeJobs', 'postedJobs', 'closedJobs', 'positions'];
    if ((!seeJobs && (clientId || market || employmentType || jobSorts.includes(sort))) || (!seeClients && clientId)
      || (!seeSubmissions && sort !== 'name' && !jobSorts.includes(sort)) || (sort === 'review' && !seeReview)) throw new ForbiddenException('The selected filters or sort require additional read permissions.');
    const period = (column: Prisma.Sql) => metricPeriod(column, from, to);
    const { start: trendFrom, end: trendTo } = performanceTrendRange(from, to);

    // One statement supplies a consistent aggregate snapshot. Aggregate jobs and
    // submissions separately so a one-to-many join cannot multiply job totals.
    const [result] = await this.prisma.$queryRaw<QueryResult[]>(Prisma.sql`
      WITH RECURSIVE manager_roles(id) AS (
        SELECT cr.id FROM ats.custom_roles cr JOIN ats.system_roles sr ON sr.id = cr.system_role_id
        WHERE cr.tenant_id = ${where.tenantId}::uuid AND sr.system_key = 'ACCOUNT_MANAGER'
        UNION
        SELECT cr.id FROM ats.custom_roles cr JOIN manager_roles parent ON cr.base_role_id = parent.id
        WHERE cr.tenant_id = ${where.tenantId}::uuid
      ), portfolio AS (
        SELECT j.id, j.account_manager_id, j.status, j.client_id, j.market, j.job_type, j.no_of_positions, j.approved_at
        FROM ats.jobs j
        WHERE ${seeJobs || seeSubmissions} AND j.tenant_id = ${where.tenantId}::uuid AND j.branch_id = ${where.branchId}::uuid
          AND j.business_unit_id = ${where.businessUnitId}::uuid AND j.deleted_at IS NULL
          AND UPPER(COALESCE(j.approval_status, '')) = 'APPROVED' AND UPPER(j.status) NOT IN ('DRAFT', 'REJECTED')
      ), filtered_jobs AS (
        SELECT p.id, p.account_manager_id, p.status, p.no_of_positions, p.approved_at FROM portfolio p
        WHERE (${clientId} = '' OR p.client_id::text = ${clientId})
          AND (${market} = '' OR p.market = ${market}) AND (${employmentType} = '' OR p.job_type = ${employmentType})
      ), roster AS (
        SELECT u.id, u.full_name, u.email, u.profile_picture FROM ats.users u
        WHERE u.tenant_id = ${where.tenantId}::uuid AND u.branch_id = ${where.branchId}::uuid
          AND u.business_unit_id = ${where.businessUnitId}::uuid AND u.is_active AND u.is_approved
          AND (EXISTS (SELECT 1 FROM manager_roles r WHERE r.id = u.role_id OR r.id = ANY(u.assigned_role_ids))
            OR (${seeJobs} AND EXISTS (SELECT 1 FROM portfolio p WHERE p.account_manager_id = u.id)))
      ), managers AS (
        SELECT r.id, r.full_name, r.email, r.profile_picture FROM roster r
        WHERE (${accountManagerId} = '' OR r.id::text = ${accountManagerId})
          AND (POSITION(LOWER(${search.trim()}) IN LOWER(r.full_name)) > 0 OR POSITION(LOWER(${search.trim()}) IN LOWER(r.email)) > 0)
      ), job_counts AS (
        SELECT account_manager_id, COUNT(*) FILTER (WHERE ${period(Prisma.sql`approved_at`)})::int AS posted,
          COUNT(*) FILTER (WHERE UPPER(status) = 'ACTIVE')::int AS active,
          COUNT(*) FILTER (WHERE UPPER(status) = 'CLOSED')::int AS closed,
          COUNT(*) FILTER (WHERE approved_at IS NULL)::int AS undated_posted,
          COALESCE(SUM(no_of_positions) FILTER (WHERE ${period(Prisma.sql`approved_at`)}), 0)::int AS positions
        FROM filtered_jobs GROUP BY account_manager_id
      ), submission_groups AS (
        ${seeSubmissions ? Prisma.sql`
          SELECT j.account_manager_id, s.final_status, s.l1_status, s.l2_status, s.l3_status, COUNT(*)::int AS count
          FROM filtered_jobs j JOIN ats.recruiter_submissions s ON s.job_id = j.id AND s.tenant_id = ${where.tenantId}::uuid
          GROUP BY j.account_manager_id, s.final_status, s.l1_status, s.l2_status, s.l3_status
        ` : Prisma.sql`SELECT NULL::uuid AS account_manager_id, ''::text AS final_status, ''::text AS l1_status, NULL::text AS l2_status, NULL::text AS l3_status, 0::int AS count WHERE FALSE`}
      ), milestones AS (
        ${managerMilestones(where.tenantId, seeSubmissions)}
      ), outcomes AS (
        SELECT account_manager_id, COUNT(*) FILTER (WHERE ${period(Prisma.sql`created_at`)})::int AS submissions,
          COUNT(*) FILTER (WHERE ${milestoneCondition('OFFER', from, to)})::int AS offers,
          COUNT(*) FILTER (WHERE ${milestoneCondition('JOIN', from, to)})::int AS joined,
          COUNT(*) FILTER (WHERE (final_status = 'OFFER' AND offered_at IS NULL) OR (final_status = 'JOIN' AND joined_at IS NULL))::int AS undated,
          COUNT(*) FILTER (WHERE final_status = 'JOIN' AND joined_at IS NULL)::int AS undated_joined
        FROM milestones GROUP BY account_manager_id
      ), weekly AS (
        SELECT FLOOR(EXTRACT(EPOCH FROM (s.joined_at - ${trendFrom})) / 604800)::int AS bucket, COUNT(*)::int AS count
        FROM milestones s JOIN managers m ON m.id = s.account_manager_id
        WHERE s.joined_at >= ${trendFrom} AND s.joined_at < ${trendTo}
        GROUP BY bucket
      ), pipeline AS (
        SELECT account_manager_id, jsonb_agg(jsonb_build_object('finalStatus', final_status, 'l1Status', l1_status,
          'l2Status', l2_status, 'l3Status', l3_status, '_count', jsonb_build_object('_all', count))) AS groups
        FROM submission_groups GROUP BY account_manager_id
      )
      SELECT COALESCE((SELECT jsonb_agg(jsonb_build_object('id', m.id, 'name', m.full_name, 'email', m.email, 'avatar', m.profile_picture,
          'postedJobs', COALESCE(j.posted, 0), 'activeJobs', COALESCE(j.active, 0), 'closedJobs', COALESCE(j.closed, 0), 'positions', COALESCE(j.positions, 0), 'undatedPosted', COALESCE(j.undated_posted, 0),
          'submissions', COALESCE(o.submissions, 0), 'offers', COALESCE(o.offers, 0), 'joined', COALESCE(o.joined, 0), 'undated', COALESCE(o.undated, 0), 'undatedJoined', COALESCE(o.undated_joined, 0),
          'groups', COALESCE(p.groups, '[]'::jsonb)) ORDER BY m.id)
        FROM managers m LEFT JOIN job_counts j ON j.account_manager_id = m.id LEFT JOIN pipeline p ON p.account_manager_id = m.id LEFT JOIN outcomes o ON o.account_manager_id = m.id), '[]'::jsonb) AS managers,
        COALESCE((SELECT jsonb_agg(jsonb_build_object('id', id, 'name', full_name) ORDER BY full_name, id) FROM roster), '[]'::jsonb) AS roster,
        COALESCE((SELECT jsonb_agg(jsonb_build_object('bucket', bucket, 'count', count) ORDER BY bucket) FROM weekly), '[]'::jsonb) AS weekly,
        (SELECT COUNT(*)::int FROM filtered_jobs j WHERE j.account_manager_id IS NULL) AS "unassignedJobs",
        ${seeClients ? Prisma.sql`COALESCE((SELECT jsonb_agg(jsonb_build_object('id', c.id, 'name', c.client_name) ORDER BY c.client_name, c.id)
          FROM ats.clients c WHERE c.tenant_id = ${where.tenantId}::uuid AND EXISTS (SELECT 1 FROM portfolio p WHERE p.client_id = c.id)), '[]'::jsonb)` : Prisma.sql`'[]'::jsonb`} AS clients,
        ${seeJobs ? Prisma.sql`COALESCE((SELECT jsonb_agg(v.market ORDER BY v.market) FROM (SELECT DISTINCT market FROM portfolio WHERE market IS NOT NULL AND market <> '') v), '[]'::jsonb)` : Prisma.sql`'[]'::jsonb`} AS markets,
        ${seeJobs ? Prisma.sql`COALESCE((SELECT jsonb_agg(v.job_type ORDER BY v.job_type) FROM (SELECT DISTINCT job_type FROM portfolio WHERE job_type IS NOT NULL AND job_type <> '') v), '[]'::jsonb)` : Prisma.sql`'[]'::jsonb`} AS "employmentTypes"
    `);
    const rows: ManagerComparisonRow[] = result.managers.map(manager => {
      const pipeline = aggregateDeliveryPipeline(manager.groups);
      return { id: manager.id, name: manager.name, email: manager.email, avatar: manager.avatar,
        postedJobs: seeJobs ? manager.postedJobs : null, activeJobs: seeJobs ? manager.activeJobs : null,
        closedJobs: seeJobs ? manager.closedJobs : null, positions: seeJobs ? manager.positions : null,
        submissions: seeSubmissions ? manager.submissions : null, review: seeReview ? pipeline.review : null,
        l1: seeSubmissions ? pipeline.l1 : null, l2: seeSubmissions ? pipeline.l2 : null, l3: seeSubmissions ? pipeline.l3 : null,
        offers: seeSubmissions ? manager.offers : null, joined: seeSubmissions ? manager.joined : null, closed: seeSubmissions ? pipeline.closed : null };
    });
    rows.sort((a, b) => (direction === 'asc' ? 1 : -1) * (sort === 'name' ? a.name.localeCompare(b.name) : (a[sort] ?? 0) - (b[sort] ?? 0))
      || (seeSubmissions ? (b.submissions ?? 0) - (a.submissions ?? 0) : 0) || a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
    const tie = (a: { id: string; name: string }, b: { id: string; name: string }) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id);
    const pipeline = result.managers.map(manager => {
      const stages = aggregateDeliveryPipeline(manager.groups);
      return { id: manager.id, name: manager.name, review: seeReview ? stages.review : null, l1: stages.l1, l2: stages.l2, l3: stages.l3, offers: stages.offers };
    });
    const pipelineSize = (row: typeof pipeline[number]) => (row.review ?? 0) + row.l1 + row.l2 + row.l3 + row.offers;
    const charts = seeSubmissions ? {
      closures: [...rows].sort((a, b) => (b.joined ?? 0) - (a.joined ?? 0) || tie(a, b)).slice(0, 5).map(row => ({ id: row.id, name: row.name, count: row.joined! })),
      pipeline: pipeline.sort((a, b) => pipelineSize(b) - pipelineSize(a) || tie(a, b)).slice(0, 5),
      weekly: performanceWeeks(trendFrom, trendTo, result.weekly), weeklyScope: from ? 'selected-period' as const : 'last-12-weeks' as const,
      undatedClosures: result.managers.reduce((total, manager) => total + manager.undatedJoined, 0),
    } : null;
    const digest = createHash('sha256').update(JSON.stringify({ where, permissions: [...(user.permissions || [])].sort(), search, clientId, market, employmentType, accountManagerId, from, to, sort, direction, rows, charts })).digest('hex');
    if (snapshot && digest !== snapshot) throw new ConflictException('Dashboard changed. Refresh to load the latest comparison.');
    const sum = (key: 'postedJobs' | 'activeJobs' | 'joined') => rows.reduce((total, row) => total + (row[key] ?? 0), 0);
    return { charts: offset === 0 ? charts : null, unit: { id: unit.id, name: unit.name, branchName: unit.branch?.name || '' }, rows: rows.slice(offset, offset + limit), total: rows.length, offset,
      nextOffset: offset + limit < rows.length ? offset + limit : null, snapshot: digest, updatedAt: new Date().toISOString(),
      summary: { postedJobs: seeJobs ? sum('postedJobs') : null, activeJobs: seeJobs ? sum('activeJobs') : null, joined: seeSubmissions ? sum('joined') : null, unassignedJobs: seeJobs ? result.unassignedJobs : null },
      options: { clients: result.clients, markets: result.markets, employmentTypes: result.employmentTypes }, managers: result.roster,
      undatedOutcomes: seeSubmissions ? result.managers.reduce((total, manager) => total + manager.undated, 0) : null,
      undatedPostedJobs: seeJobs ? result.managers.reduce((total, manager) => total + manager.undatedPosted, 0) : null };
  }
}
