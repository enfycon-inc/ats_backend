import { createHash } from 'node:crypto';
export const HISTORY_FIELDS = ['finalStatus', 'l1Status', 'l1Date', 'l1Remarks', 'l1Interviewer', 'l2Status', 'l2Date', 'l2Remarks', 'l2Interviewer', 'l3Status', 'l3Date', 'l3Remarks', 'l3Interviewer', 'meetingLink', 'remarks', 'reviewFeedback', 'podLeadRemarks', 'recruiterComment', 'submittedRateAmount'];
export function historyValue(value: any): string | null {
  return value == null ? null : value instanceof Date ? value.toISOString() : String(value);
}
export function historySnapshot(row: Record<string, any>) {
  return Object.fromEntries(HISTORY_FIELDS.map(field => [field, historyValue(row[field])]));
}
export function historyChanges(existing: Record<string, any>, data: Record<string, any>) {
  return Object.fromEntries(HISTORY_FIELDS.filter(field => field in data && historyValue(existing[field]) !== historyValue(data[field]))
    .map(field => [field, { before: historyValue(existing[field]), after: historyValue(data[field]) }]));
}
export function saveRequestHash(dto: Record<string, any>) {
  return createHash('sha256').update(JSON.stringify(Object.fromEntries(Object.keys(dto).sort()
    .filter(key => !['expectedUpdatedAt', 'requestId'].includes(key)).map(key => [key, dto[key]])))).digest('hex');
}
