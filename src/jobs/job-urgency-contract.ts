export const JOB_URGENCIES = ['Hot', 'Warm', 'Cold'] as const;
export type JobUrgency = typeof JOB_URGENCIES[number];
// Preserve existing labels when reading older jobs, without rewriting records.
export function normalizeJobUrgency(value: unknown): JobUrgency | null {
  if (typeof value !== 'string') return null;
  const key = value.trim().toUpperCase();
  if (['HOT', 'HIGH', 'URGENT'].includes(key)) return 'Hot';
  if (['WARM', 'MEDIUM'].includes(key)) return 'Warm';
  if (['COLD', 'LOW'].includes(key)) return 'Cold';
  return null;
}
