/** Canonical notification contract. Copy through sync-notification-preferences.cjs. */
export const SOUND_PRESETS = ['CLASSIC_CHIME', 'GENTLE_BELL', 'DIGITAL_PING', 'SUBTLE_POP', 'ZEN_GONG', 'MUTE'] as const;
export const EMAIL_OPTIONS = [
  { key: 'roleRequests', label: 'Role requests to review' },
  { key: 'roleApprovals', label: 'Role approved — reviewer updates' },
  { key: 'roleChanges', label: 'Changes to my role assignments' },
  { key: 'podAssignments', label: 'My pod lead assignments' },
] as const;
export type EmailCategory = typeof EMAIL_OPTIONS[number]['key'];
export type ActivityCategory = 'jobAlerts' | 'reviewAlerts' | 'submissionAlerts';
export interface NotificationPreferences {
  soundEnabled: boolean; soundPreset: typeof SOUND_PRESETS[number]; toastEnabled: boolean;
  jobAlerts: boolean; reviewAlerts: boolean; submissionAlerts: boolean;
  emailPreferences: Partial<Record<EmailCategory, boolean>>;
  eligibleEmails: EmailCategory[];
  eligibleActivities: ActivityCategory[];
}
export const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferences = {
  soundEnabled: true, soundPreset: 'CLASSIC_CHIME', toastEnabled: true,
  jobAlerts: true, reviewAlerts: true, submissionAlerts: true, emailPreferences: {}, eligibleEmails: [], eligibleActivities: [],
};
export function eligibleEmails(permissions: readonly string[], podsEnabled: boolean, hasBranch = false): EmailCategory[] {
  const has = (...keys: string[]) => permissions.includes('*') || keys.some(key => permissions.includes(key));
  const eligible: EmailCategory[] = ['roleChanges'];
  if (has('user:manage', 'platform:manage') && (has('tenant:manage', 'tenant:settings', 'platform:manage') || hasBranch)) eligible.push('roleRequests', 'roleApprovals');
  if (podsEnabled && has('pod:view') && has('job:assign_recruiter', 'pod:edit')) eligible.push('podAssignments');
  return eligible;
}
export function eligibleActivities(permissions: readonly string[]): ActivityCategory[] {
  const has = (...keys: string[]) => permissions.includes('*') || keys.some(key => permissions.includes(key));
  const all = has('platform:manage', 'tenant:manage', 'tenant:settings', 'branch_admin:manage', 'unit_admin:manage');
  const result: ActivityCategory[] = [];
  if (all || has('job:view', 'job:create')) result.push('jobAlerts');
  if (all || has('user:manage', 'job:approve', 'job:reject', 'submission:internal_screening', 'submission:audit_rounds', 'submission:audit_l1', 'submission:audit_l2', 'submission:audit_l3')) result.push('reviewAlerts');
  if (all || has('submission:view', 'submission:view_all', 'submission:create', 'submission:schedule_interview')) result.push('submissionAlerts');
  return result;
}
export function activityEnabled(type: string, settings: Pick<NotificationPreferences, 'jobAlerts' | 'reviewAlerts' | 'submissionAlerts'>) {
  if (/ROLE_REQUEST|ROLE_APPROV|PENDING_APPROVAL|REVIEW/.test(type)) return settings.reviewAlerts;
  if (/SUBMISSION|INTERVIEW/.test(type)) return settings.submissionAlerts;
  if (/^JOB_|DELEGATION/.test(type)) return settings.jobAlerts;
  return true;
}
