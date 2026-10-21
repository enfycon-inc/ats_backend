import { NotificationsService } from './notifications.service';

describe('private idempotent role-request notifications', () => {
  const recipient = '33333333-3333-4333-8333-333333333333';
  const id = '88888888-8888-4888-8888-888888888888';
  function setup() {
    const records = new Map();
    const upsert = jest.fn(async ({ where, create }) => {
      if (!records.has(where.id)) records.set(where.id, { ...create, createdAt: new Date() });
      return records.get(where.id);
    });
    const findUnique = jest.fn();
    const events = { sendToUser: jest.fn().mockResolvedValue(undefined), sendToAdmins: jest.fn() };
    const service = new NotificationsService({ notification: { upsert }, user: { findUnique } } as any, events as any);
    return { records, service, events, findUnique };
  }
  const payload = { type: 'ROLE_REQUEST', title: 'New Role Request', message: 'A member requested a role.', data: { requestVersion: 'private-version', url: '/auth/role-request?private' } };
  it('persists one record across retries while sending only an empty refresh signal', async () => {
    const { service, records, events, findUnique } = setup();
    for (let i = 0; i < 2; i++) await service.create('tenant', recipient, payload, id, true);
    expect(records.size).toBe(1);
    expect(records.get(id).data).toEqual(payload.data);
    expect(events.sendToUser).toHaveBeenCalledWith(recipient, 'notifications_changed', {});
    expect(events.sendToAdmins).not.toHaveBeenCalled();
    expect(findUnique).not.toHaveBeenCalled();
    expect(JSON.stringify(events.sendToUser.mock.calls)).not.toContain('private-version');
  });
  it('keeps the persisted record recoverable when the live signal fails', async () => {
    const { service, records, events } = setup();
    events.sendToUser.mockRejectedValueOnce(new Error('socket unavailable'));
    expect(await service.create('tenant', recipient, payload, id, true)).toBeNull();
    expect(await service.create('tenant', recipient, payload, id, true)).toMatchObject({ id });
    expect(records.size).toBe(1);
  });
});
