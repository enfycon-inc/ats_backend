import { ClientContactsController } from './client-contacts.controller';

describe('contact actor identity', () => {
  it('uses the ATS database user ID for contact ownership and access', () => {
    const service = { create: jest.fn(), findAllForClient: jest.fn(), update: jest.fn(), remove: jest.fn() };
    const controller = new ClientContactsController(service as any);
    const req = { user: { dbId: 'database-user', keycloakId: 'external-user', tenantId: 'tenant', permissions: [] } };
    const dto = { name: 'Contact' };
    controller.create('client', dto, req);
    controller.list('client', req);
    controller.update('client', 'contact', dto, req);
    controller.remove('client', 'contact', req);
    expect(service.create).toHaveBeenCalledWith('client', 'tenant', 'database-user', dto);
    expect(service.findAllForClient).toHaveBeenCalledWith('client', 'tenant', 'database-user');
    expect(service.update).toHaveBeenCalledWith('contact', 'tenant', 'database-user', dto, []);
    expect(service.remove).toHaveBeenCalledWith('contact', 'tenant', 'database-user', []);
  });
});
