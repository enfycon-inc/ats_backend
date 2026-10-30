import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import type { AuthUser } from '../auth/interfaces/auth-user.interface';
import { loadWorkspaceFeatures } from '../auth/workspace-features';
import { clientReadWhere } from '../clients/client-visibility';
import { DeliveryDashboardService } from './delivery-dashboard.service';
import { aggregateDeliveryPipeline } from './delivery-pipeline';
import {
  metricPeriod,
  milestoneCondition,
  performanceTrendRange,
  performanceWeeks,
} from './manager-performance-sql';
import {
  RECRUITER_SORTS,
  type RecruiterDashboard,
  type RecruiterFilters,
  type RecruiterRow,
  type RecruiterDetailFilters,
  type RecruiterPerformance,
  type RecruiterDetailRow,
} from './delivery-dashboard.contract';

type Groups = Parameters<typeof aggregateDeliveryPipeline>[0];
type RawRow = {
  id: string;
  name: string;
  email: string;
  avatar: string | null;
  pod: string | null;
  directActive: number;
  sharedJobs: number;
  submissions: number;
  offers: number;
  joined: number;
  undated: number;
  groups: Groups;
};
type Aggregate = {
  rows: RawRow[];
  roster: { id: string; name: string }[];
  pods: { id: string; name: string }[];
  activeJobs: number;
  unattributed: number;
  weekly: { bucket: number; submissions: number; closures: number }[];
};
const uuid = (s: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);

@Injectable()
export class RecruiterPerformanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly delivery: DeliveryDashboardService,
  ) {}

  private validate(input: RecruiterFilters) {
    const {
      search = '',
      recruiterId = '',
      podId = '',
      from = '',
      to = '',
      sort = 'joined',
      direction = 'desc',
      offset = 0,
      limit = 10,
      snapshot,
    } = input;
    const date = (s: string) =>
      typeof s === 'string' &&
      (!s ||
        (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(s) &&
          Number.isFinite(Date.parse(s)) &&
          new Date(s).toISOString() === s));
    if (
      typeof search !== 'string' ||
      search.length > 100 ||
      typeof recruiterId !== 'string' ||
      (recruiterId && !uuid(recruiterId)) ||
      typeof podId !== 'string' ||
      (podId && !uuid(podId)) ||
      !date(from) ||
      !date(to) ||
      Boolean(from) !== Boolean(to) ||
      (from &&
        (Date.parse(to) <= Date.parse(from) ||
          Date.parse(to) - Date.parse(from) > 366 * 86400000)) ||
      !RECRUITER_SORTS.includes(sort) ||
      !['asc', 'desc'].includes(direction) ||
      !Number.isSafeInteger(offset) ||
      offset < 0 ||
      offset > 100000 ||
      !Number.isSafeInteger(limit) ||
      limit < 1 ||
      limit > 100 ||
      (snapshot !== undefined && !/^[a-f0-9]{64}$/.test(snapshot))
    )
      throw new BadRequestException('Invalid recruiter performance filters.');
  }

  private async context(user: AuthUser, input: RecruiterFilters) {
    this.validate(input);
    const scope = await this.delivery.scope(user);
    const has = (p: string) => user.permissions?.includes(p) === true;
    if (!has('user:manage'))
      throw new ForbiddenException(
        'User management permission is required to compare recruiters.',
      );
    const jobs = has('job:view'),
      subs = has('submission:view'),
      review = subs && has('submission:internal_screening');
    const features = await loadWorkspaceFeatures(
      this.prisma,
      scope.where.tenantId,
      scope.where.businessUnitId,
      scope.where.branchId,
    );
    const pods = has('pod:view') && features.podsEnabled;
    const sort = input.sort ?? (subs ? 'joined' : 'name');
    if (
      (input.podId && !pods) ||
      (['directActive', 'sharedJobs'].includes(sort) && !jobs) ||
      (sort === 'sharedJobs' && !pods) ||
      (!subs && !['name', 'directActive', 'sharedJobs'].includes(sort)) ||
      (sort === 'review' && !review)
    )
      throw new ForbiddenException(
        'Additional read permissions are required for these filters.',
      );
    return { ...scope, jobs, subs, review, pods, features, sort };
  }

  // Shared scope for both endpoints. Never cast the legacy varchar recruiter_id:
  // sentinel website applicants and malformed identifiers must remain unattributed.
  private ctes(
    ctx: Awaited<ReturnType<RecruiterPerformanceService['context']>>,
    input: RecruiterFilters,
  ) {
    const { where, jobs, subs, features } = ctx;
    return Prisma.sql`WITH RECURSIVE recruiter_roles(id) AS (
      SELECT cr.id FROM ats.custom_roles cr JOIN ats.system_roles sr ON sr.id = cr.system_role_id
      WHERE cr.tenant_id = ${where.tenantId}::uuid AND sr.system_key = 'RECRUITER'
      UNION SELECT cr.id FROM ats.custom_roles cr JOIN recruiter_roles r ON cr.base_role_id = r.id WHERE cr.tenant_id = ${where.tenantId}::uuid
    ), scoped_jobs AS (
      SELECT j.id, j.job_title, j.job_code, j.status, j.client_id, j.account_manager_id, j.keep_existing_submissions_open FROM ats.jobs j
      WHERE ${jobs || subs} AND j.tenant_id = ${where.tenantId}::uuid AND j.branch_id = ${where.branchId}::uuid AND j.business_unit_id = ${where.businessUnitId}::uuid
        AND j.deleted_at IS NULL AND UPPER(COALESCE(j.approval_status, '')) = 'APPROVED' AND UPPER(j.status) NOT IN ('DRAFT', 'REJECTED')
    ), unit_users AS (
      SELECT u.id, u.full_name, u.email, u.profile_picture, u.pod_id, u.role_id, u.assigned_role_ids FROM ats.users u
      WHERE u.tenant_id = ${where.tenantId}::uuid AND u.branch_id = ${where.branchId}::uuid AND u.business_unit_id = ${where.businessUnitId}::uuid AND u.is_active AND u.is_approved
    ), roster AS (
      SELECT u.* FROM unit_users u WHERE EXISTS (SELECT 1 FROM recruiter_roles r WHERE r.id = u.role_id OR r.id = ANY(u.assigned_role_ids))
        OR (${jobs} AND EXISTS (SELECT 1 FROM ats.job_recruiters jr JOIN scoped_jobs j ON j.id = jr.job_id WHERE jr.recruiter_id = u.id))
        OR (${subs} AND EXISTS (SELECT 1 FROM ats.recruiter_submissions s JOIN scoped_jobs j ON j.id = s.job_id WHERE s.tenant_id = ${where.tenantId}::uuid AND s.recruiter_id::text = u.id::text))
    ), members AS (
      SELECT r.* FROM roster r WHERE (${input.recruiterId ?? ''} = '' OR r.id::text = ${input.recruiterId ?? ''}) AND (${input.podId ?? ''} = '' OR r.pod_id::text = ${input.podId ?? ''})
        AND (POSITION(LOWER(${input.search?.trim() ?? ''}) IN LOWER(r.full_name)) > 0 OR POSITION(LOWER(${input.search?.trim() ?? ''}) IN LOWER(r.email)) > 0)
    ), assignments AS (
      SELECT m.id AS recruiter_id, j.id AS job_id, BOOL_OR(a.direct) AS direct FROM members m
      JOIN LATERAL (
        SELECT jr.job_id, true AS direct FROM ats.job_recruiters jr WHERE jr.recruiter_id = m.id
        UNION ALL SELECT jp.job_id, false AS direct FROM ats.job_pods jp JOIN ats.pods p ON p.id = jp.pod_id
          WHERE ${features.podsEnabled && ctx.pods} AND jp.pod_id = m.pod_id AND p.tenant_id = ${where.tenantId}::uuid AND p.branch_id = ${where.branchId}::uuid AND p.business_unit_id = ${where.businessUnitId}::uuid
          AND EXISTS (SELECT 1 FROM ats.custom_roles cr WHERE cr.tenant_id = ${where.tenantId}::uuid AND (cr.id = m.role_id OR cr.id = ANY(m.assigned_role_ids)) AND cr.permissions @> '"job:submit_pod_jobs"'::jsonb)
      ) a ON TRUE JOIN scoped_jobs j ON j.id = a.job_id WHERE ${jobs} GROUP BY m.id, j.id
    ), attributed AS (
      SELECT s.id, s.job_id, s.candidate_id, s.recruiter_id, s.created_at, s.final_status, s.l1_status, s.l2_status, s.l3_status,
        s.l1_date, s.l2_date, s.l3_date, m.id AS member_id
      FROM ats.recruiter_submissions s JOIN scoped_jobs j ON j.id = s.job_id JOIN members m ON m.id::text = s.recruiter_id::text
      JOIN ats.candidates c ON c.id = s.candidate_id AND c.tenant_id = s.tenant_id AND c.deleted_at IS NULL WHERE ${subs} AND s.tenant_id = ${where.tenantId}::uuid
    ), milestones AS (
      SELECT s.*, ev.offered_at, ev.joined_at FROM attributed s LEFT JOIN LATERAL (
        SELECT MIN(e.created_at) FILTER (WHERE e.details #>> '{changes,finalStatus,after}' = 'OFFER' AND e.details #>> '{changes,finalStatus,before}' IS DISTINCT FROM 'OFFER') AS offered_at,
          MIN(e.created_at) FILTER (WHERE e.details #>> '{changes,finalStatus,after}' = 'JOIN' AND e.details #>> '{changes,finalStatus,before}' IS DISTINCT FROM 'JOIN') AS joined_at
        FROM ats.submission_events e WHERE e.submission_id = s.id AND e.tenant_id = ${where.tenantId}::uuid AND e.kind = 'UPDATE'
      ) ev ON TRUE
    )`;
  }

  async dashboard(
    user: AuthUser,
    input: RecruiterFilters = {},
  ): Promise<RecruiterDashboard> {
    const ctx = await this.context(user, input);
    return this.comparison(ctx, user, input);
  }

  private async comparison(
    ctx: Awaited<ReturnType<RecruiterPerformanceService['context']>>,
    user: AuthUser,
    input: RecruiterFilters,
  ): Promise<RecruiterDashboard> {
    const {
      from = '',
      to = '',
      offset = 0,
      limit = 10,
      direction = ctx.sort === 'name' ? 'asc' : 'desc',
    } = input;
    const period = (column: Prisma.Sql) => metricPeriod(column, from, to);
    const { start, end } = performanceTrendRange(from, to);
    const [raw] = await this.prisma.$queryRaw<
      Aggregate[]
    >(Prisma.sql`${this.ctes(ctx, input)}, counts AS (
      SELECT member_id, COUNT(*) FILTER (WHERE ${period(Prisma.sql`created_at`)})::int AS submissions,
        COUNT(*) FILTER (WHERE ${milestoneCondition('OFFER', from, to)})::int AS offers, COUNT(*) FILTER (WHERE ${milestoneCondition('JOIN', from, to)})::int AS joined,
        COUNT(*) FILTER (WHERE (final_status = 'OFFER' AND offered_at IS NULL) OR (final_status = 'JOIN' AND joined_at IS NULL))::int AS undated
      FROM milestones GROUP BY member_id
    ), groups AS (
      SELECT member_id, final_status, l1_status, l2_status, l3_status, COUNT(*)::int AS n FROM attributed GROUP BY member_id, final_status, l1_status, l2_status, l3_status
    ), pipelines AS (
      SELECT member_id, jsonb_agg(jsonb_build_object('finalStatus',final_status,'l1Status',l1_status,'l2Status',l2_status,'l3Status',l3_status,'_count',jsonb_build_object('_all',n))) AS groups FROM groups GROUP BY member_id
    ), jobs AS (
      SELECT a.recruiter_id, COUNT(*) FILTER (WHERE a.direct AND UPPER(j.status)='ACTIVE')::int AS direct,
        COUNT(*) FILTER (WHERE NOT a.direct AND UPPER(j.status)='ACTIVE')::int AS shared FROM assignments a JOIN scoped_jobs j ON j.id=a.job_id GROUP BY a.recruiter_id
    ), weekly AS (
      SELECT FLOOR(EXTRACT(EPOCH FROM (d.date - ${start}))/604800)::int AS bucket,
        COUNT(*) FILTER (WHERE d.kind='submission')::int AS submissions, COUNT(*) FILTER (WHERE d.kind='closure')::int AS closures
      FROM milestones m CROSS JOIN LATERAL (VALUES (m.created_at,'submission'),(m.joined_at,'closure')) d(date,kind)
      WHERE d.date >= ${start} AND d.date < ${end} GROUP BY bucket
    ) SELECT COALESCE((SELECT jsonb_agg(jsonb_build_object('id',m.id,'name',m.full_name,'email',m.email,'avatar',m.profile_picture,'pod',${ctx.pods ? Prisma.sql`p.name` : Prisma.sql`NULL`},
      'directActive',COALESCE(j.direct,0),'sharedJobs',COALESCE(j.shared,0),'submissions',COALESCE(c.submissions,0),'offers',COALESCE(c.offers,0),'joined',COALESCE(c.joined,0),'undated',COALESCE(c.undated,0),'groups',COALESCE(g.groups,'[]'::jsonb)))
      FROM members m LEFT JOIN jobs j ON j.recruiter_id=m.id LEFT JOIN counts c ON c.member_id=m.id LEFT JOIN pipelines g ON g.member_id=m.id
      LEFT JOIN ats.pods p ON p.id=m.pod_id AND p.tenant_id=${ctx.where.tenantId}::uuid AND p.branch_id=${ctx.where.branchId}::uuid AND p.business_unit_id=${ctx.where.businessUnitId}::uuid),'[]'::jsonb) AS rows,
      COALESCE((SELECT jsonb_agg(jsonb_build_object('id',id,'name',full_name) ORDER BY full_name,id) FROM roster),'[]'::jsonb) AS roster,
      COALESCE((SELECT jsonb_agg(jsonb_build_object('bucket',bucket,'submissions',submissions,'closures',closures)) FROM weekly),'[]'::jsonb) AS weekly,
      (SELECT COUNT(DISTINCT a.job_id)::int FROM assignments a JOIN scoped_jobs j ON j.id=a.job_id WHERE UPPER(j.status)='ACTIVE') AS "activeJobs",
      (SELECT COUNT(*)::int FROM ats.recruiter_submissions s JOIN scoped_jobs j ON j.id=s.job_id JOIN ats.candidates c ON c.id=s.candidate_id AND c.tenant_id=s.tenant_id AND c.deleted_at IS NULL
        WHERE ${ctx.subs} AND s.tenant_id=${ctx.where.tenantId}::uuid AND ${period(Prisma.sql`s.created_at`)} AND NOT EXISTS (SELECT 1 FROM roster r WHERE r.id::text=s.recruiter_id::text)) AS unattributed,
      ${ctx.pods ? Prisma.sql`COALESCE((SELECT jsonb_agg(jsonb_build_object('id',p.id,'name',p.name) ORDER BY p.name,p.id) FROM ats.pods p WHERE p.tenant_id=${ctx.where.tenantId}::uuid AND p.branch_id=${ctx.where.branchId}::uuid AND p.business_unit_id=${ctx.where.businessUnitId}::uuid),'[]'::jsonb)` : Prisma.sql`'[]'::jsonb`} AS pods`);
    const rows: RecruiterRow[] = raw.rows.map((r) => {
      const p = aggregateDeliveryPipeline(r.groups);
      return {
        id: r.id,
        name: r.name,
        email: r.email,
        avatar: r.avatar,
        pod: r.pod,
        directActive: ctx.jobs ? r.directActive : null,
        sharedJobs: ctx.jobs && ctx.pods ? r.sharedJobs : null,
        submissions: ctx.subs ? r.submissions : null,
        offers: ctx.subs ? r.offers : null,
        joined: ctx.subs ? r.joined : null,
        review: ctx.review ? p.review : null,
        l1: ctx.subs ? p.l1 : null,
        l2: ctx.subs ? p.l2 : null,
        l3: ctx.subs ? p.l3 : null,
      };
    });
    const tie = (
      a: { name: string; id: string },
      b: { name: string; id: string },
    ) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id);
    rows.sort(
      (a, b) =>
        (direction === 'asc' ? 1 : -1) *
          (ctx.sort === 'name'
            ? a.name.localeCompare(b.name)
            : (a[ctx.sort] ?? 0) - (b[ctx.sort] ?? 0)) ||
        (ctx.subs ? (b.submissions ?? 0) - (a.submissions ?? 0) : 0) ||
        tie(a, b),
    );
    const pipelines = raw.rows.map((r) => {
      const p = aggregateDeliveryPipeline(r.groups);
      return {
        id: r.id,
        name: r.name,
        review: ctx.review ? p.review : null,
        l1: p.l1,
        l2: p.l2,
        l3: p.l3,
        offers: p.offers,
      };
    });
    const volume = (p: (typeof pipelines)[number]) =>
      (p.review ?? 0) + p.l1 + p.l2 + p.l3 + p.offers;
    const charts: RecruiterDashboard['charts'] = ctx.subs
      ? {
          closures: [...rows]
            .sort((a, b) => (b.joined ?? 0) - (a.joined ?? 0) || tie(a, b))
            .slice(0, 5)
            .map((r) => ({ id: r.id, name: r.name, count: r.joined! })),
          pipeline: pipelines
            .sort((a, b) => volume(b) - volume(a) || tie(a, b))
            .slice(0, 5),
          submissions: performanceWeeks(
            start,
            end,
            raw.weekly.map((w) => ({ bucket: w.bucket, count: w.submissions })),
          ),
          closuresWeekly: performanceWeeks(
            start,
            end,
            raw.weekly.map((w) => ({ bucket: w.bucket, count: w.closures })),
          ),
          scope: from ? 'selected-period' : 'last-12-weeks',
        }
      : null;
    const digest = createHash('sha256')
      .update(
        JSON.stringify({
          where: ctx.where,
          permissions: [...(user.permissions ?? [])].sort(),
          input: {
            ...input,
            offset: undefined,
            limit: undefined,
            snapshot: undefined,
          },
          rows,
          charts,
          activeJobs: raw.activeJobs,
        }),
      )
      .digest('hex');
    if (input.snapshot && digest !== input.snapshot)
      throw new ConflictException(
        'Dashboard changed. Refresh to load the latest comparison.',
      );
    const sum = (key: 'submissions' | 'offers' | 'joined') =>
      rows.reduce((n, r) => n + (r[key] ?? 0), 0);
    return {
      unit: {
        id: ctx.unit.id,
        name: ctx.unit.name,
        branchName: ctx.unit.branch?.name ?? '',
      },
      rows: rows.slice(offset, offset + limit),
      total: rows.length,
      nextOffset: offset + limit < rows.length ? offset + limit : null,
      snapshot: digest,
      summary: {
        activeJobs: ctx.jobs ? raw.activeJobs : null,
        submissions: ctx.subs ? sum('submissions') : null,
        offers: ctx.subs ? sum('offers') : null,
        joined: ctx.subs ? sum('joined') : null,
      },
      options: { recruiters: raw.roster, pods: raw.pods },
      charts: offset === 0 ? charts : null,
      undatedOutcomes: ctx.subs
        ? raw.rows.reduce((n, r) => n + r.undated, 0)
        : null,
      unattributedSubmissions: ctx.subs ? raw.unattributed : null,
    };
  }

  async detail(
    user: AuthUser,
    id: string,
    filters: RecruiterDetailFilters = {},
  ): Promise<RecruiterPerformance> {
    const {
      tab = 'jobs',
      page = 1,
      search = '',
      assignment = '',
      status = '',
      clientId = '',
      attention = '',
    } = filters;
    if (
      !uuid(id) ||
      !['jobs', 'submissions', 'clients'].includes(tab) ||
      !Number.isSafeInteger(page) ||
      page < 1 ||
      page > 100000 ||
      typeof search !== 'string' ||
      search.length > 100 ||
      !['', 'direct', 'shared'].includes(assignment) ||
      typeof status !== 'string' ||
      status.length > 50 ||
      typeof clientId !== 'string' ||
      (clientId && !uuid(clientId)) ||
      !['', 'review', 'feedback', 'upcoming'].includes(attention)
    )
      throw new BadRequestException('Invalid recruiter detail filters.');
    const input: RecruiterFilters = {
      recruiterId: id,
      from: filters.from,
      to: filters.to,
    };
    const ctx = await this.context(user, input);
    if (
      (tab === 'jobs' && !ctx.jobs) ||
      (tab === 'submissions' && !ctx.subs) ||
      (tab === 'clients' &&
        (!ctx.subs || !user.permissions?.includes('client:view'))) ||
      (assignment === 'shared' && !ctx.pods) ||
      (attention && !ctx.subs) ||
      (attention === 'review' && !ctx.review)
    )
      throw new ForbiddenException(
        'Additional read permissions are required for this view.',
      );
    const base = await this.comparison(ctx, user, input),
      recruiter = base.rows[0];
    if (!recruiter)
      throw new NotFoundException(
        'Recruiter is unavailable in your current unit.',
      );
    const clientWhere = user.permissions?.includes('client:view')
      ? await clientReadWhere(this.prisma, ctx.where.tenantId, {
          ...user,
          branchId: ctx.where.branchId,
          businessUnitId: ctx.where.businessUnitId,
        })
      : null;
    const clients = clientWhere
      ? await this.prisma.client.findMany({
          where: {
            AND: [
              clientWhere,
              { deletedAt: null },
              {
                jobsAsClient: {
                  some: {
                    ...ctx.where,
                    deletedAt: null,
                    OR: [
                      { jobRecruiters: { some: { recruiterId: id } } },
                      { submissions: { some: { recruiterId: id } } },
                      {
                        jobPods: { some: { pod: { users: { some: { id } } } } },
                      },
                    ],
                  },
                },
              },
            ],
          },
          select: { id: true, clientName: true },
          orderBy: [{ clientName: 'asc' }, { id: 'asc' }],
        })
      : [];
    if (clientId && !clients.some((c) => c.id === clientId))
      throw new NotFoundException('Client is unavailable.');
    const allowedClients = clients.map((c) => c.id),
      limit = 20;
    const period = (col: Prisma.Sql) =>
      metricPeriod(col, filters.from, filters.to);
    const activeStage = Prisma.sql`m.final_status NOT IN ('PENDING_APPROVAL','REJECTED','WITHDRAWN','NOT_SELECTED','SELECTED','OFFER','JOIN') AND EXISTS(SELECT 1 FROM scoped_jobs q WHERE q.id=m.job_id AND (UPPER(q.status) NOT IN ('CLOSED','CLOSE') OR q.keep_existing_submissions_open))`;
    const roundStatus = Prisma.sql`CASE WHEN m.l1_status IS DISTINCT FROM 'CLEARED' THEN m.l1_status WHEN m.l2_status IS DISTINCT FROM 'CLEARED' THEN m.l2_status WHEN m.l3_status IS DISTINCT FROM 'CLEARED' THEN m.l3_status END`;
    const roundDate = Prisma.sql`CASE WHEN m.l1_status IS DISTINCT FROM 'CLEARED' THEN m.l1_date WHEN m.l2_status IS DISTINCT FROM 'CLEARED' THEN m.l2_date WHEN m.l3_status IS DISTINCT FROM 'CLEARED' THEN m.l3_date END`;
    const stage = Prisma.sql`CASE WHEN m.final_status IN ('PENDING_APPROVAL','REJECTED','WITHDRAWN','NOT_SELECTED','SELECTED','OFFER','JOIN') THEN m.final_status WHEN m.l1_status IS DISTINCT FROM 'CLEARED' THEN 'L1' WHEN m.l2_status IS DISTINCT FROM 'CLEARED' THEN 'L2' WHEN m.l3_status IS DISTINCT FROM 'CLEARED' THEN 'L3' ELSE 'DECISION' END`;
    const feedback = Prisma.sql`${activeStage} AND (${roundStatus})='AWAITING_FEEDBACK'`;
    const upcoming = Prisma.sql`${activeStage} AND (${roundStatus})='SCHEDULED' AND (${roundDate})>=CURRENT_TIMESTAMP`;
    const queue =
      attention === 'review'
        ? Prisma.sql`m.final_status='PENDING_APPROVAL'`
        : attention === 'feedback'
          ? feedback
          : attention === 'upcoming'
            ? upcoming
            : Prisma.sql`TRUE`;
    const visibleClient = allowedClients.length
      ? Prisma.sql`j.client_id IN (${Prisma.join(allowedClients.map((c) => Prisma.sql`${c}::uuid`))})`
      : Prisma.sql`FALSE`;
    const [result] = await this.prisma.$queryRaw<
      {
        rows: RecruiterDetailRow[];
        total: number;
        feedback: number;
        upcoming: number;
      }[]
    >(Prisma.sql`${this.ctes(ctx, input)}, visible AS (
      SELECT j.*, CASE WHEN ${visibleClient} THEN c.client_name END AS client_name,
        am.full_name AS manager_name FROM scoped_jobs j LEFT JOIN ats.clients c ON c.id=j.client_id AND c.tenant_id=${ctx.where.tenantId}::uuid
        LEFT JOIN unit_users am ON am.id=j.account_manager_id
      WHERE (${clientId}='' OR j.client_id::text=${clientId})
    ), outcomes AS (
      SELECT m.job_id,COUNT(*) FILTER(WHERE ${period(Prisma.sql`m.created_at`)})::int AS submissions,
        COUNT(*) FILTER(WHERE m.final_status='PENDING_APPROVAL')::int AS review,
        COUNT(*) FILTER(WHERE ${milestoneCondition('OFFER', filters.from, filters.to)})::int AS offers,
        COUNT(*) FILTER(WHERE ${milestoneCondition('JOIN', filters.from, filters.to)})::int AS joined FROM milestones m GROUP BY m.job_id
    ), table_rows AS (
      ${
        tab === 'jobs'
          ? Prisma.sql`SELECT j.id,j.job_title AS title,j.job_code AS code,j.client_name AS "clientName",CASE WHEN a.direct THEN 'direct' ELSE 'shared' END AS assignment,j.manager_name AS "accountManager",j.status,NULL::timestamptz AS "createdAt",NULL::timestamptz AS "interviewAt",
        CASE WHEN ${ctx.subs} THEN COALESCE(o.submissions,0) END AS submissions,CASE WHEN ${ctx.review} THEN COALESCE(o.review,0) END AS review,CASE WHEN ${ctx.subs} THEN COALESCE(o.offers,0) END AS offers,CASE WHEN ${ctx.subs} THEN COALESCE(o.joined,0) END AS joined
        FROM assignments a JOIN visible j ON j.id=a.job_id LEFT JOIN outcomes o ON o.job_id=j.id WHERE (${assignment}='' OR a.direct=(${assignment}='direct')) AND (${status}='' OR UPPER(j.status)=UPPER(${status}))
          AND (POSITION(LOWER(${search.trim()}) IN LOWER(j.job_title||' '||COALESCE(j.job_code,'')||' '||COALESCE(j.client_name,'')))>0)
          AND (${!attention} OR EXISTS(SELECT 1 FROM milestones m WHERE m.job_id=j.id AND ${queue}))`
          : tab === 'submissions'
            ? Prisma.sql`SELECT m.id,${user.permissions?.includes('candidate:view') ? Prisma.sql`c.full_name` : Prisma.sql`'Candidate'::text`} AS title,j.job_title AS code,j.client_name AS "clientName",NULL::text AS assignment,j.manager_name AS "accountManager",${stage} AS status,m.created_at AS "createdAt",CASE WHEN ${activeStage} THEN ${roundDate} END AS "interviewAt",
        NULL::int AS submissions,NULL::int AS review,NULL::int AS offers,NULL::int AS joined FROM milestones m JOIN visible j ON j.id=m.job_id JOIN ats.candidates c ON c.id=m.candidate_id AND c.tenant_id=${ctx.where.tenantId}::uuid
        WHERE ${attention ? queue : period(Prisma.sql`m.created_at`)} AND (${ctx.review} OR m.final_status<>'PENDING_APPROVAL') AND (${status}='' OR (${stage})=${status})
          AND POSITION(LOWER(${search.trim()}) IN LOWER(j.job_title||' '||${user.permissions?.includes('candidate:view') ? Prisma.sql`COALESCE(c.full_name,'')` : Prisma.sql`''::text`}))>0`
            : Prisma.sql`SELECT j.client_id AS id,j.client_name AS title,NULL::text AS code,j.client_name AS "clientName",NULL::text AS assignment,NULL::text AS "accountManager",NULL::text AS status,NULL::timestamptz AS "createdAt",NULL::timestamptz AS "interviewAt",
        CASE WHEN ${ctx.subs} THEN SUM(o.submissions)::int END AS submissions,CASE WHEN ${ctx.review} THEN SUM(o.review)::int END AS review,CASE WHEN ${ctx.subs} THEN SUM(o.offers)::int END AS offers,CASE WHEN ${ctx.subs} THEN SUM(o.joined)::int END AS joined
        FROM visible j JOIN outcomes o ON o.job_id=j.id WHERE j.client_name IS NOT NULL AND POSITION(LOWER(${search.trim()}) IN LOWER(j.client_name))>0 GROUP BY j.client_id,j.client_name`
      }
    ) SELECT COALESCE((SELECT jsonb_agg(t ORDER BY t.title,t.id) FROM (SELECT * FROM table_rows ORDER BY title,id LIMIT ${limit} OFFSET ${(page - 1) * limit}) t),'[]'::jsonb) AS rows,
      (SELECT COUNT(*)::int FROM table_rows) AS total,(SELECT COUNT(*)::int FROM milestones m WHERE ${feedback}) AS feedback,(SELECT COUNT(*)::int FROM milestones m WHERE ${upcoming}) AS upcoming`);
    return {
      recruiter,
      unit: base.unit,
      charts: base.charts,
      pipeline: base.charts?.pipeline[0] ?? null,
      attention: {
        review: recruiter.review,
        feedback: ctx.subs ? result.feedback : null,
        upcoming: ctx.subs ? result.upcoming : null,
      },
      table: { rows: result.rows, total: result.total, page, limit, tab },
      clients: clients.map((c) => ({ id: c.id, name: c.clientName })),
      undatedOutcomes: base.undatedOutcomes,
    };
  }
}
