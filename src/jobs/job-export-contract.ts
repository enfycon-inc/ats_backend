export const JOB_EXPORT_PERMISSION = 'job:export';
export const JOB_EXPORT_MAX_JOBS = 500;
export const JOB_EXPORT_MAX_SUBMISSIONS = 50000;

export interface JobExportRequest {
  /** Inclusive UTC instant, derived from the chosen local calendar date. */
  from: string;
  /** Exclusive UTC instant: midnight after the final local calendar date. */
  to: string;
  accountManagerId?: string;
  includeSubmissions: boolean;
}
export interface JobExportResponse { filename: string; content: string; }
export interface JobExportManager { id: string; name: string; }

export function parseJobExportRequest(input: unknown): JobExportRequest {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Choose a valid export period.');
  const value = input as Record<string, unknown>;
  const instant = (date: unknown): date is string => typeof date === 'string'
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(date)
    && Number.isFinite(Date.parse(date)) && new Date(date).toISOString() === date;
  if (!instant(value.from) || !instant(value.to) || Date.parse(value.from) >= Date.parse(value.to)) {
    throw new Error('Choose a valid start and end date.');
  }
  if (typeof value.includeSubmissions !== 'boolean') throw new Error('Choose whether to include candidate submissions.');
  if (value.accountManagerId !== undefined && (typeof value.accountManagerId !== 'string'
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value.accountManagerId))) {
    throw new Error('Choose a valid account manager.');
  }
  return { from: value.from, to: value.to, includeSubmissions: value.includeSubmissions,
    ...(value.accountManagerId ? { accountManagerId: value.accountManagerId as string } : {}) };
}
