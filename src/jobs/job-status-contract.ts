export const JOB_STATUSES = ['Draft', 'Active', 'Closed', 'Filled', 'Hold by Client', 'On Hold', 'Archived', 'Pending Approval'] as const;
export type JobStatus = typeof JOB_STATUSES[number];
export const EDITABLE_JOB_STATUSES = JOB_STATUSES.filter(status => status !== 'Pending Approval');
export const QUICK_CHANGE_JOB_STATUSES = EDITABLE_JOB_STATUSES.filter(status => status !== 'Draft' && status !== 'Archived');
export function normalizeJobStatus(value: string): JobStatus | null {
  const normalized = value.trim().toLowerCase().replace(/_/g, ' ');
  if (normalized === 'close') return 'Closed';
  if (normalized === 'hold') return 'On Hold';
  return JOB_STATUSES.find(status => status.toLowerCase() === normalized) ?? null;
}
