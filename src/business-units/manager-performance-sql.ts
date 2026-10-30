import { Prisma } from '@prisma/client';

export const metricPeriod = (column: Prisma.Sql, from = '', to = '') => from
  ? Prisma.sql`${column} >= ${new Date(from)} AND ${column} < ${new Date(to)}` : Prisma.sql`TRUE`;

export function milestoneCondition(kind: 'OFFER' | 'JOIN', from = '', to = '') {
  const column = kind === 'OFFER' ? Prisma.sql`offered_at` : Prisma.sql`joined_at`;
  return from ? Prisma.sql`${column} IS NOT NULL AND ${metricPeriod(column, from, to)}` : Prisma.sql`${column} IS NOT NULL OR final_status = ${kind}`;
}

// Both callers define filtered_jobs with id and account_manager_id. Only genuine
// transitions establish milestone dates; BASELINE snapshots cannot invent them.
export function managerMilestones(tenantId: string, allowed: boolean) {
  return allowed ? Prisma.sql`
    SELECT s.id, s.job_id, j.account_manager_id, s.created_at, s.final_status,
      MIN(ev.created_at) FILTER (WHERE ev.details #>> '{changes,finalStatus,after}' = 'OFFER'
        AND ev.details #>> '{changes,finalStatus,before}' IS DISTINCT FROM 'OFFER') AS offered_at,
      MIN(ev.created_at) FILTER (WHERE ev.details #>> '{changes,finalStatus,after}' = 'JOIN'
        AND ev.details #>> '{changes,finalStatus,before}' IS DISTINCT FROM 'JOIN') AS joined_at
    FROM filtered_jobs j JOIN ats.recruiter_submissions s ON s.job_id = j.id AND s.tenant_id = ${tenantId}::uuid
    LEFT JOIN ats.submission_events ev ON ev.submission_id = s.id AND ev.tenant_id = s.tenant_id AND ev.kind = 'UPDATE'
    GROUP BY s.id, s.job_id, j.account_manager_id, s.created_at, s.final_status
  ` : Prisma.sql`SELECT NULL::uuid AS id, NULL::uuid AS job_id, NULL::uuid AS account_manager_id, NULL::timestamptz AS created_at,
      ''::text AS final_status, NULL::timestamptz AS offered_at, NULL::timestamptz AS joined_at WHERE FALSE`;
}

export function performanceTrendRange(from = '', to = '', now = new Date()) {
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
  const monday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - (now.getUTCDay() + 6) % 7 - 77));
  return { start: from ? new Date(from) : monday, end: to ? new Date(Math.min(Date.parse(to), end.getTime())) : end };
}

export function performanceWeeks(start: Date, end: Date, values: { bucket: number; count: number }[]) {
  const week = 7 * 86400000;
  const counts = new Map(values.map(value => [value.bucket, value.count]));
  return Array.from({ length: Math.max(0, Math.ceil((end.getTime() - start.getTime()) / week)) }, (_, i) => ({
    from: new Date(start.getTime() + i * week).toISOString(), to: new Date(Math.min(start.getTime() + (i + 1) * week, end.getTime())).toISOString(), count: counts.get(i) ?? 0,
  }));
}
