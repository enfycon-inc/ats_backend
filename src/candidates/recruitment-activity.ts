/** Summary of submission activity in the caller's visible job scope. */
export function recruitmentActivity(rows: { pendingCount?: number; activeCount?: number; joinedCount?: number; submissionCount?: number }[]): string {
  const total = rows.reduce((sum, row) => sum + Number(row.submissionCount || 0), 0);
  const pending = rows.reduce((sum, row) => sum + Number(row.pendingCount || 0), 0);
  const active = rows.reduce((sum, row) => sum + Number(row.activeCount || 0), 0);
  const joined = rows.reduce((sum, row) => sum + Number(row.joinedCount || 0), 0);
  const labels: string[] = [];
  if (active) labels.push(`In progress · ${active}`);
  if (pending) labels.push(`Awaiting screening · ${pending}`);
  if (labels.length) return labels.join(' / ');
  if (joined) return 'Joined';
  return total ? 'No active submissions' : 'No visible submissions';
}
