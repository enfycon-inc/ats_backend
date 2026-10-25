import { NotificationsService } from './notifications.service';
import { DEFAULT_NOTIFICATION_PREFERENCES, activityEnabled, eligibleEmails, eligibleActivities } from './notification-preferences';
import { emailPreferencePolicy } from './email-preference-policy';
import { SystemMailService } from '../email/system-mail.service';

describe('personal notification preferences', () => {
  const actor: any = { dbId: 'user', tenantId: 'tenant', branchId: 'branch', permissions: ['user:manage'] };
  function fixture(permissions = ['user:manage']) {
    let saved: any = { soundEnabled: false, toastEnabled: false, emailPreferences: { roleChanges: false } };
    const db: any = { userNotificationSettings: { findUnique: jest.fn(async () => saved), upsert: jest.fn(async ({ update }) => { saved = { ...saved, ...update }; }) },
      $queryRawUnsafe: jest.fn(async () => [{ id: 'user', branch_id: 'branch', permissions, pods_enabled: false, email_preferences: saved.emailPreferences }]),
      $executeRawUnsafe: jest.fn(async (_sql, json) => { saved.emailPreferences = { ...saved.emailPreferences, ...JSON.parse(json) }; }) };
    db.$transaction = async fn => fn(db);
    return { db, service: new NotificationsService(db, {} as any) };
  }
  it('preserves omitted settings during a partial update', async () => {
    const f = fixture();
    const result = await f.service.updateUserSettings('user', { soundPreset: 'GENTLE_BELL' }, actor);
    expect(result).toMatchObject({ soundEnabled: false, toastEnabled: false, soundPreset: 'GENTLE_BELL' });
    expect(f.db.userNotificationSettings.upsert.mock.calls[0][0].update).toEqual({ soundPreset: 'GENTLE_BELL' });
  });
  it('merges individual email choices without resetting hidden preferences', async () => {
    const f = fixture();
    const result = await f.service.updateUserSettings('user', { emailPreferences: { roleRequests: false } }, actor);
    expect(result.emailPreferences).toEqual({ roleChanges: false, roleRequests: false });
    expect(f.db.$executeRawUnsafe.mock.calls[0][0]).toContain('email_preferences ||');
  });
  it.each([{ soundPreset: 'INVALID' }, { soundEnabled: 'false' }, { registration: false }, { emailPreferences: { passwordReset: false } }, { emailPreferences: { roleRequests: 'false' } }])('rejects malformed or required-email settings %j', async input => {
    const f = fixture();
    await expect(f.service.updateUserSettings('user', input, actor)).rejects.toThrow();
    expect(f.db.userNotificationSettings.upsert).not.toHaveBeenCalled();
  });
  it('rejects options the user is not eligible to receive', async () => {
    const f = fixture(['candidate:view']);
    await expect(f.service.updateUserSettings('user', { emailPreferences: { roleRequests: true } }, actor)).rejects.toThrow('unavailable');
  });
  it('exposes only activity controls supported by permissions', () => {
    expect(eligibleActivities(['candidate:view'])).toEqual([]);
    expect(eligibleActivities(['job:view', 'submission:create'])).toEqual(['jobAlerts', 'submissionAlerts']);
    expect(eligibleActivities(['user:manage'])).toEqual(['reviewAlerts']);
  });
  it('rejects changing activity controls without eligibility', async () => {
    const f = fixture(['candidate:view']);
    await expect(f.service.updateUserSettings('user', { reviewAlerts: true }, actor)).rejects.toThrow();
    expect(f.db.userNotificationSettings.upsert).not.toHaveBeenCalled();
  });
  it('uses each assigned role independently and keeps reviewer switches for multi-role users', async () => {
    const db: any = { $queryRawUnsafe: jest.fn().mockResolvedValue([
      { id: 'user', branch_id: null, permissions: ['user:manage'], pods_enabled: false },
      { id: 'user', branch_id: null, permissions: ['tenant:settings'], pods_enabled: false },
    ]) };
    expect((await emailPreferencePolicy(db, 'tenant', 'user')).eligible).toEqual(['roleChanges']);
    db.$queryRawUnsafe.mockResolvedValue([{ id: 'user', branch_id: null, permissions: ['user:manage', 'tenant:settings'], pods_enabled: false }]);
    expect((await emailPreferencePolicy(db, 'tenant', 'user')).eligible).toContain('roleApprovals');
    expect(db.$queryRawUnsafe.mock.calls[0].slice(1)).toEqual(['tenant', 'user', null]);
  });
  it('enforces opt-out before contacting any provider', async () => {
    const f = fixture();
    const mail = new SystemMailService(f.db);
    const tenant = jest.spyOn(mail, 'tenant');
    expect(await mail.send({ tenantId: 'tenant', to: 'user@example.com', subject: 'Changed', html: '', emailCategory: 'roleChanges' })).toMatchObject({ status: 'disabled' });
    expect(tenant).not.toHaveBeenCalled();
  });
  it('does not apply optional-email preferences to required account messages', async () => {
    const f = fixture(); const mail = new SystemMailService(f.db);
    jest.spyOn(mail, 'tenant').mockRejectedValue(new Error('required message reached dispatcher'));
    await expect(mail.send({ tenantId: 'tenant', to: 'user@example.com', subject: 'Recovery', html: '' })).rejects.toThrow('required message');
    expect(f.db.$queryRawUnsafe).not.toHaveBeenCalled();
  });
  it('applies alert categories independently of the notification history', () => {
    const settings = { ...DEFAULT_NOTIFICATION_PREFERENCES, reviewAlerts: false, submissionAlerts: false, jobAlerts: true };
    expect(activityEnabled('ROLE_REQUEST', settings)).toBe(false);
    expect(activityEnabled('INTERVIEW_SCHEDULED', settings)).toBe(false);
    expect(activityEnabled('JOB_CREATED', settings)).toBe(true);
    expect(eligibleEmails(['pod:view', 'job:assign_recruiter'], false, true)).not.toContain('podAssignments');
  });
});
