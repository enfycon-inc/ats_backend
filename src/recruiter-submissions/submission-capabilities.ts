import type { SubmissionCapabilities } from './tracker-contract';

export function submissionCapabilities(permissions: string[] = []): SubmissionCapabilities {
  const has = (permission: string) => permissions.includes('*') || permissions.includes(permission);
  return {
    review: has('submission:internal_screening'),
    schedule: has('submission:schedule_interview'),
    results: {
      l1: has('submission:audit_rounds') || has('submission:audit_l1'),
      l2: has('submission:audit_rounds') || has('submission:audit_l2'),
      l3: has('submission:audit_rounds') || has('submission:audit_l3'),
    },
    outcome: has('submission:final_status'),
    notes: has('submission:edit'),
    rate: has('submission:edit_rate'),
  };
}
