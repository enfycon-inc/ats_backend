import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { JOB_URGENCIES } from '../jobs/job-urgency-contract';
import { InterviewRoundStatus, TRACKER_SELECTION_LIMIT } from './tracker-contract';
import type {
  TrackerListFilters,
  TrackerFilterAccess,
  TrackerOptionKind,
} from './tracker-contract';

export const TRACKER_OPTION_FIELDS: Record<
  TrackerOptionKind,
  { id: string; label: string; email?: string; avatar?: string }
> = {
  accountManagerId: {
    id: 'am.id',
    label: 'COALESCE(am.full_name, am.email)',
    email: 'am.email',
    avatar: 'am.profile_picture',
  },
  recruiterId: {
    id: 'r.id',
    label: 'r.full_name',
    email: 'r.email',
    avatar: 'r.profile_picture',
  },
  createdById: {
    id: 'creator.id',
    label: 'creator.full_name',
    email: 'creator.email',
    avatar: 'creator.profile_picture',
  },
  clientId: { id: 'cl.id', label: 'cl.client_name' },
  jobId: { id: 'j.id', label: "concat_ws(' · ', j.job_code, j.job_title)" },
  businessUnitId: { id: 'bu.id', label: 'bu.name' },
  podId: { id: 'p.id', label: 'p.name' },
  branchId: { id: 'br.id', label: 'br.name' },
};
export function trackerPublicFilters(
  query: Record<string, string>,
): TrackerListFilters {
  const result: Record<string, unknown> = {};
  for (const key of ['accountManagers','recruiters','clients']) {
    if(query[key]!==undefined&&query[key]!=='') {
      try { result[key]=JSON.parse(query[key]); } catch { throw new BadRequestException('Invalid multi-selection filter.'); }
    }
  }
  for (const key of [
    'view',
    'bucket',
    'jobId',
    'candidateId',
    'search',
    'startDate',
    'endDate',
    'l1Status',
    'l2Status',
    'l3Status',
    'finalStatus',
    'sortBy',
    'sortDirection',
    'accountManagerId',
    'recruiterId',
    'createdById',
    'clientId',
    'businessUnitId',
    'podId',
    'stage',
    'stageStatus',
    'jobStatus',
    'workflow',
    'urgency',
    'dateBasis',
    'interviewFrom',
    'interviewTo',
    'queue',
    'round', 'roundStatus',
  ])
    if (query[key] !== undefined && query[key] !== '') result[key] = query[key];
  for (const key of ['page', 'limit'])
    if (query[key] !== undefined) result[key] = Number(query[key]);
  return result as TrackerListFilters;
}
export const trackerStageSql = `CASE WHEN s.final_status='PENDING_APPROVAL' THEN 'review'
 WHEN s.final_status IN ('SELECTED','OFFER','JOIN','REJECTED','NOT_SELECTED','WITHDRAWN') THEN 'final'
 WHEN s.l1_status IS DISTINCT FROM 'CLEARED' THEN 'l1' WHEN s.l2_status IS DISTINCT FROM 'CLEARED' THEN 'l2'
 WHEN s.l3_status IS DISTINCT FROM 'CLEARED' THEN 'l3' ELSE 'final' END`;
export const trackerRoundStatusSql = `CASE (${trackerStageSql}) WHEN 'l1' THEN COALESCE(s.l1_status,'PENDING') WHEN 'l2' THEN COALESCE(s.l2_status,'PENDING') WHEN 'l3' THEN COALESCE(s.l3_status,'PENDING') ELSE CASE WHEN s.final_status='SUBMITTED' THEN 'DECISION' ELSE s.final_status END END`;
export const trackerRoundDateSql = `CASE (${trackerStageSql}) WHEN 'l1' THEN s.l1_date WHEN 'l2' THEN s.l2_date WHEN 'l3' THEN s.l3_date END`;
export const joinedDateSql = `(SELECT MIN(je.created_at) FROM ats.submission_events je WHERE je.tenant_id=s.tenant_id AND je.submission_id=s.id AND je.kind='UPDATE'
 AND je.details #>> '{changes,finalStatus,after}'='JOIN' AND je.details #>> '{changes,finalStatus,before}' IS DISTINCT FROM 'JOIN')`;

export function trackerFilterAccess(
  permissions: string[],
): TrackerFilterAccess {
  const has = (p: string) => permissions.includes(p);
  const tenant = permissions.some((p) =>
    ['*', 'tenant:manage', 'tenant:settings', 'platform:manage'].includes(p),
  );
  const branch = has('branch_admin:manage');
  const wide =
    tenant || branch || has('unit_admin:manage') || has('submission:view_all');
  return {
    branch: tenant,
    unit: tenant || branch,
    people: wide || has('job:submit_owned_jobs') || has('user:manage'),
    portfolio: has('job:submit_owned_jobs') && !tenant && !branch && !has('unit_admin:manage'),
    clients: has('client:view'),
    pods: has('pod:view'),
    review:
      has('submission:internal_screening') ||
      has('submission:internal_screening_created_jobs'),
  };
}

export function validateTrackerFilters(
  f: TrackerListFilters,
  access: TrackerFilterAccess,
) {
  const uuid=(id:unknown)=>typeof id==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id);
  for(const [key,singular] of [['accountManagers','accountManagerId'],['recruiters','recruiterId'],['clients','clientId']] as const) {
    const selection=f[key]; if(selection===undefined)continue;if(!selection||typeof selection!=='object'||Array.isArray(selection))throw new BadRequestException('Invalid selection mode.');
    if(f[singular])throw new BadRequestException('Choose one selection mode per filter.');
    if(key==='clients'?!access.clients:!access.people)throw new ForbiddenException('This multi-selection is unavailable in your scope.');
    if(selection.mode==='ids') {
      if(!Array.isArray(selection.ids)||!selection.ids.length||selection.ids.length>TRACKER_SELECTION_LIMIT||!selection.ids.every(uuid)||new Set(selection.ids).size!==selection.ids.length)throw new BadRequestException('Choose valid unique filter IDs or use Select all matching.');
    } else if(selection.mode==='matching') {
      if(typeof selection.search!=='string'||selection.search.length>100||selection.excludedIds!==undefined&&(!Array.isArray(selection.excludedIds)||selection.excludedIds.length>TRACKER_SELECTION_LIMIT||!selection.excludedIds.every(uuid)))throw new BadRequestException('Invalid matching selection.');
    } else throw new BadRequestException('Invalid selection mode.');
  }
  if(f.round && (!['l1','l2','l3'].includes(f.round)||f.stage||f.stageStatus||f.queue||f.l1Status||f.l2Status||f.l3Status))throw new BadRequestException('Use one round inspection mode at a time.');
  if(f.roundStatus && (!f.round||!Object.values(InterviewRoundStatus).includes(f.roundStatus)))throw new BadRequestException('Choose a round and supported round status.');
  if(f.urgency&&(typeof f.urgency!=='string'||!JOB_URGENCIES.some(value=>value.toUpperCase()===f.urgency!.toUpperCase())))throw new BadRequestException('Choose Hot, Warm or Cold.');
  for (const key of [
    'accountManagerId',
    'recruiterId',
    'createdById',
    'clientId',
    'businessUnitId',
    'podId',
  ] as const) {
    const value = f[key];
    if (
      value !== undefined &&
      value !== '' &&
      (typeof value !== 'string' ||
        !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(
          value,
        ))
    )
      throw new BadRequestException('Invalid submission filter identifier.');
  }
  if (f.businessUnitId && !access.unit)
    throw new ForbiddenException(
      'Unit filtering is unavailable in your scope.',
    );
  if ((f.recruiterId || f.accountManagerId || f.createdById) && !access.people)
    throw new ForbiddenException(
      'People filtering is unavailable in your scope.',
    );
  if (f.clientId && !access.clients)
    throw new ForbiddenException('Client viewing permission is required.');
  if (f.podId && !access.pods)
    throw new ForbiddenException('Pod viewing permission is required.');
  if (f.stage && !['review', 'l1', 'l2', 'l3', 'final'].includes(f.stage))
    throw new BadRequestException('Invalid current stage.');
  if (
    f.stageStatus &&
    (!f.stage ||
      ![
        'PENDING_APPROVAL',
        'PENDING',
        'SCHEDULED',
        'AWAITING_FEEDBACK',
        'CANCELLED',
        'CLEARED',
        'REJECTED',
        'DECISION',
        'SELECTED',
        'OFFER',
        'JOIN',
        'NOT_SELECTED',
        'WITHDRAWN',
      ].includes(f.stageStatus))
  )
    throw new BadRequestException('Choose a current stage before its status.');
  const allowed =
    f.stage === 'review'
      ? ['PENDING_APPROVAL']
      : f.stage === 'final'
        ? [
            'DECISION',
            'SELECTED',
            'OFFER',
            'JOIN',
            'REJECTED',
            'NOT_SELECTED',
            'WITHDRAWN',
          ]
        : ['PENDING', 'SCHEDULED', 'AWAITING_FEEDBACK', 'CANCELLED'];
  if (f.stageStatus && !allowed.includes(f.stageStatus))
    throw new BadRequestException(
      'This status is not a current status for the selected stage.',
    );
  if (f.workflow && !['running', 'paused'].includes(f.workflow))
    throw new BadRequestException('Invalid workflow filter.');
  if (f.queue && !['scheduling', 'feedback', 'upcoming'].includes(f.queue))
    throw new BadRequestException('Invalid queue filter.');
  if (f.dateBasis && !['submitted', 'joined'].includes(f.dateBasis))
    throw new BadRequestException('Invalid date basis.');
  if (f.dateBasis === 'joined' && f.bucket !== 'closures')
    throw new BadRequestException(
      'Joined-date reporting requires the Closures tab.',
    );
  if (
    f.stage &&
    f.bucket &&
    f.bucket !== 'all' &&
    ((f.stage === 'review' && f.bucket !== 'review') ||
      (['l1', 'l2', 'l3'].includes(f.stage) &&
        !['interviews', 'closed'].includes(f.bucket)) ||
      (f.stage === 'final' && f.bucket === 'review'))
  )
    throw new BadRequestException(
      'The selected stage conflicts with this tab.',
    );
  for (const key of ['jobStatus', 'urgency'] as const)
    if (
      f[key] !== undefined &&
      (typeof f[key] !== 'string' || f[key]!.length > 60)
    )
      throw new BadRequestException('Invalid job filter.');
  for (const [start, end] of [
    [f.startDate, f.endDate],
    [f.interviewFrom, f.interviewTo],
  ]) {
    for (const date of [start, end])
      if (
        date &&
        (!/^\d{4}-\d{2}-\d{2}$/.test(date) ||
          !Number.isFinite(Date.parse(date)) ||
          new Date(date).toISOString().slice(0, 10) !== date)
      )
        throw new BadRequestException('Choose valid dates.');
    if (
      start &&
      end &&
      (start > end || Date.parse(end) - Date.parse(start) > 366 * 86400000)
    )
      throw new BadRequestException('Choose a date range of up to one year.');
  }
}

export function trackerExtraPredicates(
  f: TrackerListFilters,
  add: (value: unknown) => string,
  matchingClientIds?: string[],
) {
  const clauses: string[] = [];
  for(const [key,field] of [['accountManagers',TRACKER_OPTION_FIELDS.accountManagerId],['recruiters',TRACKER_OPTION_FIELDS.recruiterId],['clients',TRACKER_OPTION_FIELDS.clientId]] as const) {
    const selection=f[key];if(!selection)continue;
    if(selection.mode==='ids')clauses.push(`${field.id}=ANY(${add(selection.ids)}::uuid[])`);
    else {
      clauses.push(`${field.id} IS NOT NULL AND POSITION(LOWER(${add(selection.search.trim())}) IN LOWER(COALESCE(${field.label},'')||' '||COALESCE(${field.email||'NULL::text'},'')))>0`);
      if(selection.excludedIds?.length)clauses.push(`NOT (${field.id}=ANY(${add(selection.excludedIds)}::uuid[]))`);
      if(key==='clients')clauses.push(matchingClientIds?.length?`${field.id}=ANY(${add(matchingClientIds)}::uuid[])`:'FALSE');
    }
  }
  if(f.round) {
    const round=f.round, status=f.roundStatus;
    // Completed results may belong to a candidate now in a later round or final outcome.
    if(status==='CLEARED'||status==='REJECTED') {
      clauses.push(`s.final_status<>'PENDING_APPROVAL' AND s.${round}_status=${add(status)}`);
      clauses.push(`NOT (s.final_status='REJECTED' AND EXISTS(SELECT 1 FROM ats.submission_events ir WHERE ir.tenant_id=s.tenant_id AND ir.submission_id=s.id AND ir.kind='UPDATE' AND ir.details #>> '{changes,finalStatus,after}'='REJECTED' AND ir.details #>> '{changes,finalStatus,before}'='PENDING_APPROVAL'))`);
    } else {
      clauses.push(`s.final_status='SUBMITTED' AND (${trackerStageSql})=${add(round)}`);
      if(status)clauses.push(`COALESCE(s.${round}_status,'PENDING')=${add(status)}`);
      if(f.bucket!=='closed'&&f.workflow!=='paused')clauses.push(`NOT (UPPER(COALESCE(j.status,'')) IN ('CLOSED','CLOSE') AND NOT COALESCE(j.keep_existing_submissions_open,FALSE))`);
    }
  } else if (f.roundStatus) {
    clauses.push(`s.final_status='SUBMITTED' AND (${trackerRoundStatusSql})=${add(f.roundStatus)}`);
    if(f.bucket!=='closed'&&f.workflow!=='paused')clauses.push(`NOT (UPPER(COALESCE(j.status,'')) IN ('CLOSED','CLOSE') AND NOT COALESCE(j.keep_existing_submissions_open,FALSE))`);
  }
  if (f.queue)
    clauses.push(
      `s.final_status='SUBMITTED' AND (${trackerRoundStatusSql})=${add(f.queue === 'scheduling' ? 'PENDING' : f.queue === 'feedback' ? 'AWAITING_FEEDBACK' : 'SCHEDULED')} AND NOT (UPPER(COALESCE(j.status,'')) IN ('CLOSED','CLOSE') AND NOT COALESCE(j.keep_existing_submissions_open,FALSE))${f.queue === 'upcoming' ? ` AND (${trackerRoundDateSql})>=CURRENT_TIMESTAMP` : ''}`,
    );
  for (const key of [
    'accountManagerId',
    'recruiterId',
    'createdById',
    'clientId',
    'businessUnitId',
    'podId',
  ] as const)
    if (f[key])
      clauses.push(`${TRACKER_OPTION_FIELDS[key].id}::text=${add(f[key])}`);
  if (f.stage) clauses.push(`(${trackerStageSql})=${add(f.stage)}`);
  if (f.stageStatus)
    clauses.push(`(${trackerRoundStatusSql})=${add(f.stageStatus)}`);
  if (f.jobStatus) clauses.push(`UPPER(j.status)=UPPER(${add(f.jobStatus)})`);
  if (f.urgency) clauses.push(`(CASE WHEN UPPER(TRIM(j.urgency)) IN ('HOT','HIGH','URGENT') THEN 'HOT' WHEN UPPER(TRIM(j.urgency)) IN ('WARM','MEDIUM') THEN 'WARM' WHEN UPPER(TRIM(j.urgency)) IN ('COLD','LOW') THEN 'COLD' END)=${add(f.urgency.toUpperCase())}`);
  if (f.workflow)
    clauses.push(
      `${f.workflow === 'running' ? 'NOT ' : ''}(UPPER(COALESCE(j.status,'')) IN ('CLOSED','CLOSE') AND NOT COALESCE(j.keep_existing_submissions_open,FALSE) AND s.final_status IN ('PENDING_APPROVAL','SUBMITTED'))`,
    );
  for (const [value, op] of [
    [f.interviewFrom, '>='],
    [f.interviewTo, '<'],
  ] as const)
    if (value)
      clauses.push(
        `s.final_status='SUBMITTED' AND (${trackerRoundDateSql}) ${op} ${add(op === '<' ? new Date(Date.parse(value) + 86400000) : new Date(value))}::timestamptz`,
      );
  return clauses;
}
