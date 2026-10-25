import { isClosedJob } from '../jobs/job-action-policy';
import type { SubmissionCapabilities } from './tracker-contract';

export function submissionCapabilities(permissions: string[] = [], isAssignedManager = false, jobStatus?: string | null, finalStatus?: string | null, keepExistingSubmissionsOpen = false, creatorReview = false, creatorSelfReview = false): SubmissionCapabilities {
  const paused = isClosedJob(jobStatus) && !keepExistingSubmissionsOpen;
  const has = (permission: string) => permissions.includes('*') || permissions.includes(permission);
  return {
    review: !paused && !creatorSelfReview && (has('submission:internal_screening') || isAssignedManager || (creatorReview && has('submission:internal_screening_created_jobs'))),
    schedule: !paused && has('submission:schedule_interview'),
    cancelInterview: !paused && has('submission:schedule_interview'),
    results: {
      l1: !paused && (has('submission:audit_rounds') || has('submission:audit_l1')),
      l2: !paused && (has('submission:audit_rounds') || has('submission:audit_l2')),
      l3: !paused && (has('submission:audit_rounds') || has('submission:audit_l3')),
    },
    outcome: !paused && has('submission:final_status'),
    notes: has('submission:edit'),
    rate: has('submission:edit_rate'),
  };
}
