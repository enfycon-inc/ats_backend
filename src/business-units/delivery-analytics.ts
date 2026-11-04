import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service';
import type { DeliveryAnalytics, DeliveryStage } from './delivery-dashboard.contract';

export function validateDeliveryPeriod(input: Record<string, string>) {
  if (Object.values(input).some(value => typeof value !== 'string')) throw new BadRequestException('Invalid dashboard filters.');
  const period = input.period || 'all';
  if (!['all', 'today', 'week', 'month', 'previousMonth', 'year', 'previousYear', 'custom'].includes(period)) throw new BadRequestException('Select a valid period.');
  const valid = (date: string) => /^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(Date.parse(date)) && new Date(date).toISOString().slice(0, 10) === date;
  if (period === 'custom' && (!valid(input.from || '') || !valid(input.to || '') || input.from > input.to)) throw new BadRequestException('Select a valid start and end date.');
  const cities = input.cities ? input.cities.split(',') : [];
  if (cities.length > 100 || cities.some(city => !/^[A-Z_]{1,50}$/.test(city))) throw new BadRequestException('Select valid employee cities.');
  const view = input.employeeView || 'all';
  if (!['all', 'recruiters', 'managers'].includes(view)) throw new BadRequestException('Select a valid employee view.');
  const employeePage = Number(input.employeePage || 1);
  if (!Number.isSafeInteger(employeePage) || employeePage < 1 || employeePage > 100000) throw new BadRequestException('Invalid employee page.');
  return { period, cities, view, employeePage };
}

export async function deliveryAnalytics(db: PrismaService, scope: { tenantId: string; branchId: string; businessUnitId: string }, access: { jobs: boolean; submissions: boolean; members: boolean }, input: Record<string, string>, stage: DeliveryStage, page: number): Promise<DeliveryAnalytics> {
  const { period, cities, view, employeePage } = validateDeliveryPeriod(input);
  const jobPage = Number(input.jobPage || 1);
  if (!Number.isSafeInteger(jobPage) || jobPage < 1 || jobPage > 100000) throw new BadRequestException('Invalid job page.');
  const text = (key: string) => String(input[key] || '').trim().slice(0, 150);
  const selection = (key: string) => {
    const raw = input[key] || '';
    if (typeof raw !== 'string' || raw.length > 3700) throw new BadRequestException('Invalid entity filter.');
    const values = raw ? [...new Set(raw.split(','))] : [];
    if (values.length > 100 || values.some(value => !(key === 'submittedBy' && value === 'website') && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value))) throw new BadRequestException('Invalid entity filter.');
    return values;
  };
  const client = selection('client'), posters = selection('postedBy'), submitters = selection('submittedBy');
  const cityMatch = (column: Prisma.Sql) => cities.length ? Prisma.sql`${column} IN (${Prisma.join(cities)})` : Prisma.sql`TRUE`;
  const inPeriod = (column: Prisma.Sql) => Prisma.sql`(bounds.start_at IS NULL OR (${column}>=bounds.start_at AND ${column}<bounds.end_at))`;
  const round = stage === 'l1' ? Prisma.sql`s.l1_status` : stage === 'l2' ? Prisma.sql`s.l2_status` : Prisma.sql`s.l3_status`;
  const reached = stage === 'l1' ? Prisma.sql`s.final_status<>'PENDING_APPROVAL'` : stage === 'l2' ? Prisma.sql`s.l1_status='CLEARED'` : Prisma.sql`s.l1_status='CLEARED' AND s.l2_status='CLEARED'`;
  const stageMatch = stage === 'offers' ? Prisma.sql`s.offered_at IS NOT NULL AND ${inPeriod(Prisma.sql`s.offered_at`)}`
    : stage === 'review' ? Prisma.sql`${inPeriod(Prisma.sql`s.created_at`)} AND s.final_status='PENDING_APPROVAL'`
    : ['l1', 'l2', 'l3'].includes(stage) ? Prisma.sql`${inPeriod(Prisma.sql`s.created_at`)} AND (${reached}) AND (${!text('status')} OR COALESCE(${round},'PENDING')=${text('status')})`
    : stage === 'final' ? Prisma.sql`${inPeriod(Prisma.sql`s.created_at`)} AND s.final_status IN ('SELECTED','OFFER','JOIN')`
    : Prisma.sql`${inPeriod(Prisma.sql`s.created_at`)}`;
  const rows = await db.$queryRaw<{ result: DeliveryAnalytics }[]>(Prisma.sql`
    WITH settings AS (
      SELECT COALESCE(bu.timezone,b.timezone,'Asia/Kolkata') AS tz
      FROM ats.business_units bu JOIN ats.branches b ON b.id=bu.branch_id AND b.tenant_id=bu.tenant_id
      WHERE bu.id=${scope.businessUnitId}::uuid AND bu.tenant_id=${scope.tenantId}::uuid AND b.id=${scope.branchId}::uuid
    ), local_clock AS (SELECT tz,NOW() AT TIME ZONE tz AS clock FROM settings), bounds AS (
      SELECT tz,
        (CASE ${period} WHEN 'today' THEN clock::date WHEN 'week' THEN date_trunc('week',clock)::date
          WHEN 'month' THEN date_trunc('month',clock)::date WHEN 'previousMonth' THEN (date_trunc('month',clock)-INTERVAL '1 month')::date
          WHEN 'year' THEN date_trunc('year',clock)::date WHEN 'previousYear' THEN (date_trunc('year',clock)-INTERVAL '1 year')::date
          WHEN 'custom' THEN NULLIF(${input.from || ''},'')::date ELSE NULL END)::timestamp AT TIME ZONE tz AS start_at,
        (CASE ${period} WHEN 'previousMonth' THEN date_trunc('month',clock)::date WHEN 'previousYear' THEN date_trunc('year',clock)::date
          WHEN 'custom' THEN NULLIF(${input.to || ''},'')::date+1 WHEN 'all' THEN NULL ELSE clock::date+1 END)::timestamp AT TIME ZONE tz AS end_at
      FROM local_clock
    ), staff AS (
      SELECT u.id,u.full_name,u.email,u.profile_picture AS avatar,COALESCE(u.city::text,'UNSPECIFIED') AS city,
        EXISTS(SELECT 1 FROM ats.custom_roles r WHERE r.tenant_id=u.tenant_id AND r.id=ANY(ARRAY_REMOVE(ARRAY[u.role_id] || u.assigned_role_ids,NULL)) AND r.permissions ? 'submission:create') AS can_recruit,
        EXISTS(SELECT 1 FROM ats.custom_roles r WHERE r.tenant_id=u.tenant_id AND r.id=ANY(ARRAY_REMOVE(ARRAY[u.role_id] || u.assigned_role_ids,NULL)) AND r.permissions ? 'job:create') AS can_post
      FROM ats.users u WHERE u.tenant_id=${scope.tenantId}::uuid AND u.branch_id=${scope.branchId}::uuid AND u.business_unit_id=${scope.businessUnitId}::uuid AND u.is_approved=true
    ), jobs AS (
      SELECT j.id,j.created_by_user_id,j.created_at,j.job_title,j.job_code,j.client_id,
        CASE WHEN UPPER(j.status) IN ('HOLD','ON HOLD') THEN 'HOLD' WHEN UPPER(j.status)='CLOSE' THEN 'CLOSED' ELSE UPPER(j.status) END AS status,
        CASE WHEN UPPER(j.urgency) IN ('URGENT','HIGH') THEN 'HOT' WHEN UPPER(j.urgency)='MEDIUM' THEN 'WARM' WHEN UPPER(j.urgency)='LOW' THEN 'COLD' ELSE UPPER(j.urgency) END AS urgency,
        CASE WHEN LOWER(j.job_type) IN ('full-time','full time') THEN 'Full-Time' WHEN LOWER(j.job_type) IN ('contract','contractual') THEN 'Contractual' WHEN LOWER(j.job_type) IN ('c2h','contract-to-hire','contract to hire') THEN 'Contract-to-hire' ELSE j.job_type END AS job_type,
        poster.city AS poster_city
      FROM ats.jobs j LEFT JOIN staff poster ON poster.id=j.created_by_user_id
      WHERE j.tenant_id=${scope.tenantId}::uuid AND j.branch_id=${scope.branchId}::uuid AND j.business_unit_id=${scope.businessUnitId}::uuid AND j.deleted_at IS NULL
    ), submissions AS (
      SELECT s.id,s.created_at,s.final_status,s.l1_status,s.l2_status,s.l3_status,s.submission_origin,j.id AS job_id,j.job_title,j.job_code,j.client_id,j.created_by_user_id,
        c.full_name,c.email,COALESCE(original.actor_id,s.recruiter_id) AS submitter,member.city AS member_city,events.offered_at,events.joined_at
      FROM ats.recruiter_submissions s JOIN jobs j ON j.id=s.job_id
      JOIN ats.candidates c ON c.id=s.candidate_id AND c.tenant_id=s.tenant_id AND c.deleted_at IS NULL
      LEFT JOIN LATERAL (SELECT e.actor_id FROM ats.submission_events e WHERE e.tenant_id=s.tenant_id AND e.submission_id=s.id AND e.kind='CREATED' ORDER BY e.sequence,e.id LIMIT 1) original ON true
      LEFT JOIN staff member ON member.id::text=COALESCE(original.actor_id,s.recruiter_id) AND s.submission_origin<>'WEBSITE'
      LEFT JOIN LATERAL (SELECT
        MIN(e.created_at) FILTER(WHERE e.details #>> '{changes,finalStatus,after}'='OFFER' AND e.details #>> '{changes,finalStatus,before}' IS DISTINCT FROM 'OFFER') AS offered_at,
        MIN(e.created_at) FILTER(WHERE e.details #>> '{changes,finalStatus,after}'='JOIN' AND e.details #>> '{changes,finalStatus,before}' IS DISTINCT FROM 'JOIN') AS joined_at
        FROM ats.submission_events e WHERE e.tenant_id=s.tenant_id AND e.submission_id=s.id AND e.kind='UPDATE') events ON true
      WHERE s.tenant_id=${scope.tenantId}::uuid AND ${access.submissions}
    ), selected_jobs AS (SELECT j.* FROM jobs j CROSS JOIN bounds WHERE ${access.jobs} AND ${inPeriod(Prisma.sql`j.created_at`)} AND ${cityMatch(Prisma.sql`j.poster_city`)}),
    selected_submissions AS (SELECT s.* FROM submissions s CROSS JOIN bounds WHERE ${inPeriod(Prisma.sql`s.created_at`)} AND ${cityMatch(Prisma.sql`s.member_city`)}),
    matched_jobs AS (SELECT j.* FROM selected_jobs j WHERE
      (${text('jobStatus')}='' OR j.status=${text('jobStatus')}) AND (${text('jobPriority')}='' OR (j.status='ACTIVE' AND j.urgency=${text('jobPriority')}))
      AND (${text('jobType')}='' OR j.job_type=${text('jobType')})
      AND (${text('jobSearch')}='' OR POSITION(LOWER(${text('jobSearch')}) IN LOWER(j.job_title || ' ' || j.job_code))>0)),
    job_rows AS (SELECT * FROM matched_jobs ORDER BY created_at DESC,id LIMIT 10 OFFSET ${(jobPage - 1) * 10}),
    job_metrics AS (SELECT created_by_user_id,COUNT(*)::int AS jobs FROM selected_jobs GROUP BY created_by_user_id),
    submission_metrics AS (SELECT submitter,COUNT(*)::int AS submissions FROM selected_submissions WHERE submission_origin<>'WEBSITE' GROUP BY submitter),
    outcome_metrics AS (SELECT s.submitter,
      COUNT(*) FILTER(WHERE s.offered_at IS NOT NULL AND ${inPeriod(Prisma.sql`s.offered_at`)})::int AS offers,
      COUNT(*) FILTER(WHERE s.joined_at IS NOT NULL AND ${inPeriod(Prisma.sql`s.joined_at`)})::int AS joined
      FROM submissions s CROSS JOIN bounds WHERE s.submission_origin<>'WEBSITE' GROUP BY s.submitter),
    staff_metrics AS (
      SELECT m.id,m.full_name AS name,m.email,m.avatar,m.city,m.can_recruit AS "canRecruit",m.can_post AS "canPost",
        CASE WHEN ${access.jobs} THEN COALESCE(jobs.jobs,0) ELSE NULL END AS jobs,
        CASE WHEN ${access.submissions} THEN COALESCE(subs.submissions,0) ELSE NULL END AS submissions,
        CASE WHEN ${access.submissions} THEN COALESCE(outcomes.offers,0) ELSE NULL END AS offers,
        CASE WHEN ${access.submissions} THEN COALESCE(outcomes.joined,0) ELSE NULL END AS joined
      FROM staff m LEFT JOIN job_metrics jobs ON jobs.created_by_user_id=m.id
      LEFT JOIN submission_metrics subs ON subs.submitter=m.id::text LEFT JOIN outcome_metrics outcomes ON outcomes.submitter=m.id::text
      WHERE ${cityMatch(Prisma.sql`m.city`)}
        AND (${view}='all' OR (${view}='recruiters' AND m.can_recruit) OR (${view}='managers' AND m.can_post))
        AND POSITION(LOWER(${text('employeeSearch')}) IN LOWER(COALESCE(m.full_name,'') || ' ' || m.email))>0
    ), ranked_staff AS (SELECT *,ROW_NUMBER() OVER(PARTITION BY city ORDER BY submissions DESC NULLS LAST,name,id) AS row_number,
      ROW_NUMBER() OVER(PARTITION BY city ORDER BY jobs DESC NULLS LAST,name,id) AS jobs_rank,
      ROW_NUMBER() OVER(PARTITION BY city ORDER BY offers DESC NULLS LAST,name,id) AS offers_rank,
      ROW_NUMBER() OVER(PARTITION BY city ORDER BY joined DESC NULLS LAST,name,id) AS joined_rank FROM staff_metrics),
    city_totals AS (SELECT city,COUNT(*)::int AS staff,SUM(jobs)::int AS jobs,SUM(submissions)::int AS submissions,SUM(offers)::int AS offers,SUM(joined)::int AS joined FROM staff_metrics GROUP BY city),
    round_values AS (
      SELECT 'l1' AS round,COALESCE(l1_status,'PENDING') AS status FROM selected_submissions WHERE final_status<>'PENDING_APPROVAL'
      UNION ALL SELECT 'l2',COALESCE(l2_status,'PENDING') FROM selected_submissions WHERE l1_status='CLEARED'
      UNION ALL SELECT 'l3',COALESCE(l3_status,'PENDING') FROM selected_submissions WHERE l1_status='CLEARED' AND l2_status='CLEARED'
    ), round_counts AS (SELECT round,status,COUNT(*)::int AS count FROM round_values GROUP BY round,status),
    matched AS (
      SELECT s.* FROM submissions s CROSS JOIN bounds WHERE ${stageMatch} AND ${cityMatch(Prisma.sql`s.member_city`)}
        AND (${text('search')}='' OR POSITION(LOWER(${text('search')}) IN LOWER(COALESCE(s.full_name,'') || ' ' || s.email || ' ' || s.job_title || ' ' || s.job_code))>0)
        AND ${client.length ? Prisma.sql`s.client_id::text IN (${Prisma.join(client)})` : Prisma.sql`TRUE`}
        AND ${posters.length ? Prisma.sql`s.created_by_user_id::text IN (${Prisma.join(posters)})` : Prisma.sql`TRUE`}
        AND ${submitters.length ? Prisma.sql`(CASE WHEN s.submission_origin='WEBSITE' THEN 'website' ELSE s.submitter END) IN (${Prisma.join(submitters)})` : Prisma.sql`TRUE`}
        AND (${['l1', 'l2', 'l3'].includes(stage) || !text('status')} OR s.final_status=${text('status')})
    ), page_rows AS (SELECT * FROM matched ORDER BY created_at DESC,id LIMIT 10 OFFSET ${(page - 1) * 10})
    SELECT jsonb_build_object(
      'jobResults',CASE WHEN ${access.jobs && !!input.jobPage} THEN jsonb_build_object('page',${jobPage}::int,'total',(SELECT COUNT(*) FROM matched_jobs),'items',COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'id',j.id,'jobTitle',j.job_title,'jobCode',j.job_code,'clientName',c.client_name,'postedBy',jsonb_build_object('name',COALESCE(u.full_name,'Name unavailable'),'email',u.email),
        'postedAt',j.created_at,'status',j.status,'priority',j.urgency,'jobType',j.job_type,'submissions',CASE WHEN ${access.submissions} THEN (SELECT COUNT(*) FROM ats.recruiter_submissions s WHERE s.job_id=j.id AND s.tenant_id=${scope.tenantId}::uuid) ELSE NULL END) ORDER BY j.created_at DESC,j.id)
        FROM job_rows j LEFT JOIN ats.clients c ON c.id=j.client_id AND c.tenant_id=${scope.tenantId}::uuid LEFT JOIN ats.users u ON u.id=j.created_by_user_id AND u.tenant_id=${scope.tenantId}::uuid),'[]'::jsonb)) ELSE NULL END,
      'timezone',bounds.tz,'from',bounds.start_at,'to',bounds.end_at,
      'jobCounts',CASE WHEN ${access.jobs} THEN jsonb_build_object('total',(SELECT COUNT(*) FROM selected_jobs),'statuses',COALESCE((SELECT jsonb_object_agg(status,count) FROM (SELECT status,COUNT(*)::int AS count FROM selected_jobs GROUP BY status) counts),'{}'::jsonb),
        'priorities',COALESCE((SELECT jsonb_object_agg(urgency,count) FROM (SELECT urgency,COUNT(*)::int AS count FROM selected_jobs WHERE status='ACTIVE' GROUP BY urgency) counts),'{}'::jsonb),
        'types',COALESCE((SELECT jsonb_object_agg(job_type,count) FROM (SELECT job_type,COUNT(*)::int AS count FROM selected_jobs GROUP BY job_type) counts),'{}'::jsonb)) ELSE NULL END,
      'rounds',CASE WHEN ${access.submissions} THEN jsonb_build_object('l1',COALESCE((SELECT jsonb_object_agg(status,count) FROM round_counts WHERE round='l1'),'{}'::jsonb),'l2',COALESCE((SELECT jsonb_object_agg(status,count) FROM round_counts WHERE round='l2'),'{}'::jsonb),'l3',COALESCE((SELECT jsonb_object_agg(status,count) FROM round_counts WHERE round='l3'),'{}'::jsonb)) ELSE NULL END,
      'final',CASE WHEN ${access.submissions} THEN COALESCE((SELECT jsonb_object_agg(final_status,count) FROM (SELECT final_status,COUNT(*)::int AS count FROM selected_submissions WHERE final_status IN ('SELECTED','OFFER','JOIN') GROUP BY final_status) counts),'{}'::jsonb) ELSE NULL END,
      'review',CASE WHEN ${access.submissions} THEN (SELECT COUNT(*) FROM selected_submissions WHERE final_status='PENDING_APPROVAL') ELSE NULL END,
      'totalSubmissions',CASE WHEN ${access.submissions} THEN (SELECT COUNT(*) FROM selected_submissions) ELSE NULL END,
      'offersReceived',CASE WHEN ${access.submissions} THEN (SELECT COUNT(*) FROM submissions s WHERE s.offered_at IS NOT NULL AND ${inPeriod(Prisma.sql`s.offered_at`)} AND ${cityMatch(Prisma.sql`s.member_city`)}) ELSE NULL END,
      'undatedOffers',CASE WHEN ${access.submissions} THEN (SELECT COUNT(*) FROM submissions s WHERE s.offered_at IS NULL AND s.final_status IN ('OFFER','JOIN') AND ${cityMatch(Prisma.sql`s.member_city`)}) ELSE NULL END,
      'undatedJoins',CASE WHEN ${access.submissions} THEN (SELECT COUNT(*) FROM submissions s WHERE s.joined_at IS NULL AND s.final_status='JOIN' AND ${cityMatch(Prisma.sql`s.member_city`)}) ELSE NULL END,
      'unattributedJobs',CASE WHEN ${access.jobs} THEN (SELECT COUNT(*) FROM jobs j WHERE j.poster_city IS NULL AND ${inPeriod(Prisma.sql`j.created_at`)}) ELSE NULL END,
      'websiteApplications',CASE WHEN ${access.submissions} THEN (SELECT COUNT(*) FROM submissions s WHERE s.submission_origin='WEBSITE' AND ${inPeriod(Prisma.sql`s.created_at`)}) ELSE NULL END,
      'unattributed',CASE WHEN ${access.submissions} THEN (SELECT COUNT(*) FROM submissions s WHERE s.submission_origin<>'WEBSITE' AND s.member_city IS NULL AND ${inPeriod(Prisma.sql`s.created_at`)}) ELSE NULL END,
      'availableCities',CASE WHEN ${access.members} THEN COALESCE((SELECT jsonb_agg(city ORDER BY city) FROM (SELECT DISTINCT city FROM staff) cities),'[]'::jsonb) ELSE '[]'::jsonb END,
      'cities',CASE WHEN ${access.members} THEN COALESCE((SELECT jsonb_agg(to_jsonb(ct) || jsonb_build_object(
        'page',CASE WHEN ct.city=${text('employeeCity')} THEN ${employeePage} ELSE 1 END,
        'employees',COALESCE((SELECT jsonb_agg(to_jsonb(m)-'row_number' ORDER BY m.row_number) FROM ranked_staff m WHERE m.city=ct.city AND m.row_number>CASE WHEN ct.city=${text('employeeCity')} THEN ${(employeePage - 1) * 10} ELSE 0 END AND m.row_number<=CASE WHEN ct.city=${text('employeeCity')} THEN ${employeePage * 10} ELSE 10 END),'[]'::jsonb),
        'leaders',COALESCE((SELECT jsonb_agg(to_jsonb(m)-'row_number' ORDER BY m.row_number) FROM ranked_staff m WHERE m.city=ct.city AND (m.row_number<=5 OR m.jobs_rank<=5 OR m.offers_rank<=5 OR m.joined_rank<=5)),'[]'::jsonb)) ORDER BY ct.city) FROM city_totals ct),'[]'::jsonb) ELSE NULL END,
      'submissionIds',COALESCE((SELECT jsonb_agg(id ORDER BY created_at DESC,id) FROM page_rows),'[]'::jsonb),'submissionTotal',(SELECT COUNT(*) FROM matched),
      'offeredDates',COALESCE((SELECT jsonb_object_agg(id,offered_at) FROM page_rows),'{}'::jsonb),
      'groups',COALESCE((SELECT jsonb_agg(jsonb_build_object('finalStatus',final_status,'l1Status',l1_status,'l2Status',l2_status,'l3Status',l3_status,'_count',jsonb_build_object('_all',count))) FROM (SELECT final_status,l1_status,l2_status,l3_status,COUNT(*)::int AS count FROM selected_submissions GROUP BY final_status,l1_status,l2_status,l3_status) counts),'[]'::jsonb)
    ) AS result FROM bounds`);
  if (!rows[0]) throw new BadRequestException('Your unit timezone is unavailable.');
  return rows[0].result;
}
