import { isClosedJob } from '../jobs/job-action-policy';
import type { SubmissionCapabilities } from './tracker-contract';

export function submissionCapabilities(permissions: string[] = [], isAssignedManager = false, jobStatus?: string | null, finalStatus?: string | null): SubmissionCapabilities {
  const paused = isClosedJob(jobStatus) && ['PENDING_APPROVAL', 'SUBMITTED'].includes(finalStatus || '');
  const has = (permission: string) => permissions.includes('*') || permissions.includes(permission);
  return {
    review: !paused && (has('submission:internal_screening') || isAssignedManager),
    schedule: !paused && has('submission:schedule_interview'),
    cancelInterview: has('submission:schedule_interview'),
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
