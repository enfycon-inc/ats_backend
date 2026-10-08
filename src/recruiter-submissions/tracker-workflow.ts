import type { RoundKey, TrackerBucket } from './tracker-contract';

export function currentTrackerRound(row: Record<string, any>): RoundKey | null {
  for (const round of ['l1', 'l2', 'l3'] as const) {
    if ((row[`${round}_status`] ?? row[`${round}Status`]) !== 'CLEARED') return round;
  }
  return null;
}

// Use the same predicates for filtered rows and counts. Date-only legacy rounds
// count as started; pending later rounds must not move a record back to review.
export function trackerBucketConditions(prefix = ''): Record<TrackerBucket, string> {
  const started = ['l1', 'l2', 'l3'].map(round =>
    `(COALESCE(${prefix}${round}_status IN ('SCHEDULED', 'CLEARED', 'REJECTED'), FALSE) OR ${prefix}${round}_date IS NOT NULL)`
  ).join(' OR ');
  return {
    all: 'TRUE',
    review: `(${prefix}final_status = 'PENDING_APPROVAL' OR (${prefix}final_status = 'SUBMITTED' AND NOT (${started})))`,
    interviews: `(${prefix}final_status = 'SUBMITTED' AND (${started}))`,
    offers: `${prefix}final_status = 'OFFER'`,
    closed: `${prefix}final_status IN ('REJECTED', 'JOIN')`,
  };
}
