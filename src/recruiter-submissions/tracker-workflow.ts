import type { RoundKey, TrackerBucket } from './tracker-contract';

export function currentTrackerRound(row: Record<string, any>): RoundKey | null {
  for (const round of ['l1', 'l2', 'l3'] as const) {
    if ((row[`${round}_status`] ?? row[`${round}Status`]) !== 'CLEARED') return round;
  }
  return null;
}

// Use the same predicates for filtered rows and counts. Date-only legacy rounds
// count as started; pending later rounds must not move a record back to review.
export function trackerBucketConditions(prefix = '', jobStatusExpression?: string, keepOpenExpression?: string): Record<TrackerBucket, string> {
  const started = ['l1', 'l2', 'l3'].map(round =>
    `(COALESCE(${prefix}${round}_status IN ('SCHEDULED', 'AWAITING_FEEDBACK', 'CLEARED', 'REJECTED', 'CANCELLED'), FALSE) OR ${prefix}${round}_date IS NOT NULL)`
  ).join(' OR ');
  const paused = jobStatusExpression ? `(UPPER(COALESCE(${jobStatusExpression}, '')) IN ('CLOSED', 'CLOSE') AND NOT COALESCE(${keepOpenExpression || 'FALSE'}, FALSE) AND ${prefix}final_status IN ('PENDING_APPROVAL', 'SUBMITTED'))` : 'FALSE';
  return {
    all: 'TRUE',
    review: `(NOT (${paused}) AND (${prefix}final_status = 'PENDING_APPROVAL' OR (${prefix}final_status = 'SUBMITTED' AND NOT (${started}))))`,
    interviews: `(NOT (${paused}) AND ${prefix}final_status = 'SUBMITTED' AND (${started}))`,
    offers: `${prefix}final_status IN ('SELECTED', 'OFFER')`,
    closed: `(${prefix}final_status IN ('REJECTED', 'NOT_SELECTED', 'WITHDRAWN', 'JOIN') OR ${paused})`,
  };
}
