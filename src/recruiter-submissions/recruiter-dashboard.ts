import { BadRequestException, ForbiddenException } from '@nestjs/common';
import type { PrismaService } from '../prisma/prisma.service';
import type { AuthUser } from '../auth/interfaces/auth-user.interface';
import { loadWorkspaceFeatures } from '../auth/workspace-features';
import { jobCapabilities } from '../jobs/job-action-policy';
import type {
  RecruiterDashboardData,
  RecruiterInterview,
} from './tracker-contract';

export async function recruiterDashboard(
  db: PrismaService,
  actor: AuthUser,
  tenantId: string,
  month: string,
  range: number,
): Promise<RecruiterDashboardData> {
  if (!actor.dbId || actor.tenantId !== tenantId)
    throw new ForbiddenException('Your workspace membership is unavailable.');
  if (
    !/^\d{4}-(0[1-9]|1[0-2])$/.test(month) ||
    Number(month.slice(0, 4)) < 2000 ||
    Number(month.slice(0, 4)) > 2200 ||
    ![0, 7, 30, 90].includes(range)
  )
    throw new BadRequestException(
      'Choose a valid calendar month and reporting period.',
    );
  const permissions = actor.permissions || [];
  const member = await db.user.findFirst({
    where: { id: actor.dbId, tenantId, isActive: true, isApproved: true },
    select: { branchId: true, businessUnitId: true, podId: true },
  });
  if (!member?.branchId || !member.businessUnitId)
    throw new ForbiddenException(
      'A current branch and unit assignment is required.',
    );
  const has = (key: string) =>
    permissions.includes(key) || permissions.includes('*');
  const viewJobs = has('job:view');
  const viewSubs = has('submission:view') || has('submission:create');
  if (!viewJobs && !viewSubs)
    throw new ForbiddenException('Dashboard access is unavailable.');
  const pods =
    (
      await loadWorkspaceFeatures(
        db,
        tenantId,
        member.businessUnitId,
        member.branchId,
      )
    ).podsEnabled && has('job:submit_pod_jobs');
  const common = [tenantId, actor.dbId, member.branchId, member.businessUnitId];
  const since = range ? new Date(Date.now() - range * 86400000) : null;
  const assigned = `WITH assignments AS (
    SELECT jr.job_id, jr.created_at, true AS direct FROM ats.job_recruiters jr WHERE jr.recruiter_id = $2::uuid
    UNION ALL SELECT jp.job_id, jp.created_at, false AS direct FROM ats.job_pods jp WHERE $5::boolean AND jp.pod_id = $6::uuid
  ), scoped AS (SELECT j.id, j.job_title, j.job_code, j.job_type, j.market, j.urgency, j.status, j.approval_status, j.submission_done, j.submission_required, j.account_manager_id, MAX(a.created_at) AS assigned_at, BOOL_OR(a.direct) AS directly_assigned,
    cl.client_name FROM assignments a JOIN ats.jobs j ON j.id = a.job_id LEFT JOIN ats.clients cl ON cl.id = j.client_id AND cl.tenant_id = j.tenant_id
    WHERE j.tenant_id = $1::uuid AND j.branch_id = $3::uuid AND j.business_unit_id = $4::uuid AND j.deleted_at IS NULL
    GROUP BY j.id, cl.client_name)`;
  const active = `UPPER(status) = 'ACTIVE' AND (approval_status IS NULL OR approval_status = 'APPROVED')`;
  const subScope = `FROM ats.recruiter_submissions s JOIN ats.jobs j ON j.id = s.job_id AND j.tenant_id = s.tenant_id JOIN ats.candidates c ON c.id = s.candidate_id AND c.tenant_id = s.tenant_id
    WHERE s.tenant_id = $1::uuid AND s.recruiter_id = $2::uuid::text AND s.submission_origin = 'RECRUITER' AND j.branch_id = $3::uuid AND j.business_unit_id = $4::uuid AND j.deleted_at IS NULL AND c.deleted_at IS NULL`;
  const roundScope = `FROM ats.recruiter_submissions s JOIN ats.jobs j ON j.id = s.job_id AND j.tenant_id = s.tenant_id JOIN ats.candidates c ON c.id = s.candidate_id AND c.tenant_id = s.tenant_id
    CROSS JOIN LATERAL (VALUES ('L1',s.l1_status::text,s.l1_date,s.l1_interviewer), ('L2',s.l2_status::text,s.l2_date,s.l2_interviewer), ('L3',s.l3_status::text,s.l3_date,s.l3_interviewer)) AS r(round,status,date,interviewer)
    WHERE s.tenant_id = $1::uuid AND s.recruiter_id = $2::uuid::text AND s.submission_origin = 'RECRUITER' AND j.branch_id = $3::uuid AND j.business_unit_id = $4::uuid AND j.deleted_at IS NULL AND c.deleted_at IS NULL AND s.final_status <> 'PENDING_APPROVAL' AND r.date IS NOT NULL AND r.status IN ('SCHEDULED','AWAITING_FEEDBACK','CLEARED','REJECTED','CANCELLED')`;
  const eventSelect = `SELECT s.id AS submission_id, c.full_name, j.job_title, j.job_timezone, s.meeting_link, r.round, r.status, r.date, r.interviewer `;
  const start = new Date(month + '-01T00:00:00Z');
  start.setUTCDate(start.getUTCDate() - 1);
  const end = new Date(month + '-01T00:00:00Z');
  end.setUTCMonth(end.getUTCMonth() + 1);
  end.setUTCDate(end.getUTCDate() + 1);
  const [jobs, jobCounts, stages, outcomes, calendar, upcoming] =
    await Promise.all([
      viewJobs
        ? db.$queryRawUnsafe<any[]>(
            `${assigned} SELECT id, job_title, job_code, job_type, market, urgency, status, approval_status, submission_done, submission_required, account_manager_id, assigned_at, client_name, directly_assigned FROM scoped WHERE ${active} ORDER BY assigned_at DESC, id LIMIT 4`,
            ...common,
            pods,
            member.podId,
          )
        : [],
      viewJobs
        ? db.$queryRawUnsafe<any[]>(
            `${assigned} SELECT COUNT(*) FILTER (WHERE ${active})::int AS active, COUNT(*) FILTER (WHERE ${active} AND (CASE WHEN submission_required > 0 THEN submission_done < submission_required ELSE submission_done = 0 END))::int AS pending, COUNT(*) FILTER (WHERE $7::timestamptz IS NULL OR assigned_at >= $7::timestamptz)::int AS total FROM scoped`,
            ...common,
            pods,
            member.podId,
            since,
          )
        : [],
      viewSubs
        ? db.$queryRawUnsafe<any[]>(
            `SELECT s.final_status, COUNT(*)::int AS count, COUNT(*) FILTER (WHERE s.l1_status IN ('SCHEDULED','AWAITING_FEEDBACK') OR s.l2_status IN ('SCHEDULED','AWAITING_FEEDBACK') OR s.l3_status IN ('SCHEDULED','AWAITING_FEEDBACK'))::int AS interviewing ${subScope} AND ($5::timestamptz IS NULL OR s.created_at >= $5::timestamptz) GROUP BY s.final_status`,
            ...common,
            since,
          )
        : [],
      viewSubs
        ? db.$queryRawUnsafe<any[]>(
            `SELECT r.status, COUNT(*)::int AS count ${roundScope} AND ($5::timestamptz IS NULL OR (r.date >= $5::timestamptz AND r.date <= CURRENT_TIMESTAMP)) GROUP BY r.status`,
            ...common,
            since,
          )
        : [],
      viewSubs
        ? db.$queryRawUnsafe<any[]>(
            `${eventSelect} ${roundScope} AND r.date >= $5::timestamptz AND r.date < $6::timestamptz ORDER BY r.date, s.id, r.round LIMIT 2001`,
            ...common,
            start,
            end,
          )
        : [],
      viewSubs
        ? db.$queryRawUnsafe<any[]>(
            `${eventSelect} ${roundScope} AND r.date >= CURRENT_TIMESTAMP AND r.status IN ('SCHEDULED','AWAITING_FEEDBACK') AND s.final_status NOT IN ('PENDING_APPROVAL','REJECTED','WITHDRAWN','NOT_SELECTED','SELECTED','OFFER','JOIN') AND (UPPER(j.status) NOT IN ('CLOSED','CLOSE') OR j.keep_existing_submissions_open) ORDER BY r.date, s.id, r.round LIMIT 4`,
            ...common,
          )
        : [],
    ]);
  const event = (row: any): RecruiterInterview => ({
    id: row.submission_id + ':' + row.round,
    submissionId: row.submission_id,
    candidateName: row.full_name,
    jobTitle: row.job_title,
    round: row.round,
    status: row.status,
    date: new Date(row.date).toISOString(),
    timezone: row.job_timezone,
    interviewer: row.interviewer,
    meetingLink: row.meeting_link,
  });
  const buckets: Record<string, number> = {
    'Awaiting review': 0,
    'In progress': 0,
    'In interview': 0,
    Selected: 0,
    Rejected: 0,
    Withdrawn: 0,
  };
  for (const row of stages) {
    const n = Number(row.count),
      interviewing = Number(row.interviewing);
    if (row.final_status === 'PENDING_APPROVAL')
      buckets['Awaiting review'] += n;
    else if (['SELECTED', 'OFFER', 'JOIN'].includes(row.final_status))
      buckets.Selected += n;
    else if (['REJECTED', 'NOT_SELECTED'].includes(row.final_status))
      buckets.Rejected += n;
    else if (row.final_status === 'WITHDRAWN') buckets.Withdrawn += n;
    else {
      buckets['In interview'] += interviewing;
      buckets['In progress'] += n - interviewing;
    }
  }
  return {
    rangeDays: range as RecruiterDashboardData['rangeDays'],
    pendingJobs: Number(jobCounts[0]?.pending || 0),
    totalActiveJobs: Number(jobCounts[0]?.active || 0),
    jobs: jobs.map((row) => {
      const caps = jobCapabilities(
        {
          ...actor,
          branchId: member.branchId!,
          businessUnitId: member.businessUnitId!,
        },
        {
          tenantId,
          branchId: member.branchId!,
          businessUnitId: member.businessUnitId!,
          accountManagerId: row.account_manager_id,
          status: row.status,
          approvalStatus: row.approval_status,
          directlyAssigned: row.directly_assigned,
          podAssigned: !row.directly_assigned,
          podsEnabled: pods,
        },
      );
      return {
        id: row.id,
        jobTitle: row.job_title,
        jobCode: row.job_code,
        jobType: row.job_type,
        market: row.market,
        client: row.client_name || '',
        priority: row.urgency,
        assignedAt: new Date(row.assigned_at).toISOString(),
        submissionDone: Number(row.submission_done),
        submissionRequired: Number(row.submission_required),
        canSubmit: caps.submitCandidate,
        canMatch: caps.findMatches,
      };
    }),
    metrics: {
      jobs: Number(jobCounts[0]?.total || 0),
      submissions: (stages as any[]).reduce(
        (n: number, r: any) => n + Number(r.count),
        0,
      ),
      rejected: buckets.Rejected,
      selected: buckets.Selected,
      interviews: buckets['In interview'],
    },
    submissionStages: Object.entries(buckets).map(([label, count]) => ({
      label,
      count,
    })),
    interviewOutcomes: [
      'SCHEDULED',
      'AWAITING_FEEDBACK',
      'CLEARED',
      'REJECTED',
      'CANCELLED',
    ].map((status) => ({
      label: status,
      count: Number(outcomes.find((row) => row.status === status)?.count || 0),
    })),
    calendar: calendar.slice(0, 2000).map(event),
    calendarTruncated: calendar.length > 2000,
    upcoming: upcoming.map(event),
  };
}
