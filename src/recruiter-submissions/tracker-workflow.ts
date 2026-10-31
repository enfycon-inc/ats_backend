import type { RoundKey, TrackerBucket } from './tracker-contract';

export function currentTrackerRound(row: Record<string, any>): RoundKey | null {
  for (const round of ['l1', 'l2', 'l3'] as const) {
    if ((row[`${round}_status`] ?? row[`${round}Status`]) !== 'CLEARED') return round;
  }
  return null;
}

// Counts and filtered rows share these predicates. Internal approval, not
// interview scheduling, determines whether a submission still needs review.
export function trackerBucketConditions(prefix = '', jobStatusExpression?: string, keepOpenExpression?: string): Record<TrackerBucket, string> {
  const paused = jobStatusExpression ? `(UPPER(COALESCE(${jobStatusExpression}, '')) IN ('CLOSED', 'CLOSE') AND NOT COALESCE(${keepOpenExpression || 'FALSE'}, FALSE) AND ${prefix}final_status IN ('PENDING_APPROVAL', 'SUBMITTED'))` : 'FALSE';
  return {
    all: 'TRUE',
    review: `(NOT (${paused}) AND ${prefix}final_status = 'PENDING_APPROVAL')`,
    interviews: `(NOT (${paused}) AND ${prefix}final_status = 'SUBMITTED' AND (${prefix}l1_status IN ('SCHEDULED', 'AWAITING_FEEDBACK') OR ${prefix}l2_status IN ('SCHEDULED', 'AWAITING_FEEDBACK') OR ${prefix}l3_status IN ('SCHEDULED', 'AWAITING_FEEDBACK')))`,
    offers: `${prefix}final_status IN ('SELECTED', 'OFFER')`,
    closures: `${prefix}final_status = 'JOIN'`,
    closed: `(${prefix}final_status IN ('REJECTED', 'NOT_SELECTED', 'WITHDRAWN') OR ${paused})`,
  };
}
