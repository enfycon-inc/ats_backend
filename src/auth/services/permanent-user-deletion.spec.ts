import { AuthUserService } from './auth-user.service';

describe('permanent workspace user deletion', () => {
  const actor: any = { dbId: 'admin', tenantId: 'tenant', permissions: ['tenant:settings'] };
  let tx: any;
  let service: any;
  beforeEach(() => {
    tx = new Proxy({}, { get(target: any, key) {
      if (!(key in target)) target[key] = new Proxy({}, { get(model: any, method) {
        if (!(method in model)) model[method] = jest.fn().mockResolvedValue({ count: 0 });
        return model[method];
      } });
      return target[key];
    } });
    tx.$queryRawUnsafe = jest.fn().mockResolvedValueOnce([]).mockResolvedValue([{ id: 'admin' }, { id: 'target' }]);
    tx.$executeRawUnsafe = jest.fn();
    tx.user.findFirst.mockResolvedValueOnce({ id: 'target', email: 'user@example.com', fullName: 'User', keycloakId: 'identity' }).mockResolvedValue(null);
    tx.user.count.mockResolvedValue(1);
    tx.sessionMembership.findMany.mockResolvedValue([{ id: 'membership', sessionId: 'session' }]);
    service = {
      authQuery: { prisma: { $transaction: jest.fn(async callback => callback(tx)) } },
      keycloakService: { deleteKeycloakUser: jest.fn().mockResolvedValue(undefined) }, logger: { warn: jest.fn() },
    };
  });
  it('cleans account history and sessions before deleting the user', async () => {
    await AuthUserService.prototype.deleteUser.call(service, 'target', actor);
    expect(tx.userSecurityEvent.deleteMany).toHaveBeenCalled();
    expect(tx.sessionNetworkObservation.deleteMany).toHaveBeenCalledWith({ where: { membershipId: { in: ['membership'] } } });
    expect(tx.sessionMembership.deleteMany).toHaveBeenCalledWith({ where: { tenantId: 'tenant', userId: 'target' } });
    expect(tx.user.delete).toHaveBeenCalledWith({ where: { id: 'target' } });
    expect(service.keycloakService.deleteKeycloakUser).toHaveBeenCalledWith('user@example.com');
  });
  it('retains the external identity when another workspace membership uses it', async () => {
    tx.user.findFirst.mockReset().mockResolvedValueOnce({ id: 'target', email: 'user@example.com', fullName: 'User', keycloakId: 'identity' }).mockResolvedValue({ id: 'other-member' });
    await AuthUserService.prototype.deleteUser.call(service, 'target', actor);
    expect(service.keycloakService.deleteKeycloakUser).not.toHaveBeenCalled();
  });
  it('blocks self deletion before opening a transaction', async () => {
    await expect(AuthUserService.prototype.deleteUser.call(service, 'admin', actor)).rejects.toThrow('own account');
    expect(service.authQuery.prisma.$transaction).not.toHaveBeenCalled();
  });
  it('blocks deletion of the last active tenant administrator', async () => {
    tx.$queryRawUnsafe.mockReset().mockResolvedValueOnce([]).mockResolvedValue([{ id: 'target' }]);
    await expect(AuthUserService.prototype.deleteUser.call(service, 'target', actor)).rejects.toThrow('last active Tenant Admin');
    expect(tx.user.delete).not.toHaveBeenCalled();
  });
  it('rejects targets outside the authenticated tenant', async () => {
    tx.user.findFirst.mockReset().mockResolvedValue(null);
    await expect(AuthUserService.prototype.deleteUser.call(service, 'target', actor)).rejects.toThrow('your tenant');
    expect(tx.user.delete).not.toHaveBeenCalled();
  });
});
