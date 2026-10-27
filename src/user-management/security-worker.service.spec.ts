import { SecurityWorkerService } from './security-worker.service';
describe('Provider event attribution', () => {
  function setup() {
    const db: any = { $queryRawUnsafe: jest.fn().mockResolvedValue([]), $executeRawUnsafe: jest.fn().mockResolvedValue(1) };
    db.$transaction = jest.fn(fn => fn(db));
    return { db, service: new SecurityWorkerService(db, {} as any, {} as any) };
  }
  it('keeps failures for ambiguous identities out of tenant histories', async () => {
    const { db, service } = setup();
    db.$queryRawUnsafe.mockResolvedValue([{ user_id: 'one', tenant_id: 'a' }, { user_id: 'two', tenant_id: 'b' }]);
    await service.ingest({ type: 'LOGIN_ERROR', time: Date.now(), userId: 'identity', clientId: 'app', ipAddress: '192.0.2.1' });
    const call = db.$executeRawUnsafe.mock.calls[0];
    expect(call.slice(1, 4)).toEqual([null, null, null]);
  });
  it('defers login events until a verified application binding is available', async () => {
    const { db, service } = setup();
    await service.ingest({ type: 'LOGIN', time: Date.now(), userId: 'identity', sessionId: 'session', clientId: 'app' });
    expect(db.$executeRawUnsafe).not.toHaveBeenCalled();
  });
  it('records bound logout events and ends only the matching memberships', async () => {
    const { db, service } = setup();
    db.$queryRawUnsafe.mockResolvedValue([{ id: 'binding', user_id: 'user', tenant_id: 'tenant' }]);
    await service.ingest({ type: 'LOGOUT', time: Date.now(), userId: 'identity', sessionId: 'session', clientId: 'app' });
    const update = db.$executeRawUnsafe.mock.calls.find(call => call[0].startsWith('UPDATE ats.session_memberships'));
    expect(update[1]).toBe('binding');
    expect(db.$executeRawUnsafe.mock.calls[0][5]).toBe('session.logged_out');
  });
});
