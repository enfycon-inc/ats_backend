import { ClientContactsController } from './client-contacts.controller';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ClientContactsService } from './client-contacts.service';

describe('contact HTTP route compatibility', () => {
  it('accepts both URL prefixes and preserves authenticated actor identity', async () => {
    const service = { create: jest.fn().mockResolvedValue({ id: 'contact' }), findAllForClient: jest.fn().mockResolvedValue({ myContacts: [] }) };
    const module = await Test.createTestingModule({ controllers: [ClientContactsController], providers: [{ provide: ClientContactsService, useValue: service }] })
      .overrideGuard(JwtAuthGuard).useValue({ canActivate: (ctx: any) => {
        ctx.switchToHttp().getRequest().user = { tenantId: 'tenant', dbId: 'database-user' };
        return true;
      } }).compile();
    const app = module.createNestApplication();
    await app.init();
    try {
      for (const prefix of ['/clients', '/api/clients']) {
        await request(app.getHttpServer()).post(`${prefix}/client/contacts`).send({ name: 'Contact' }).expect(201);
        await request(app.getHttpServer()).get(`${prefix}/client/contacts`).expect(200);
      }
      expect(service.create).toHaveBeenCalledTimes(2);
      expect(service.create).toHaveBeenCalledWith('client', 'tenant', 'database-user', { name: 'Contact' });
      expect(service.findAllForClient).toHaveBeenCalledWith('client', 'tenant', 'database-user', expect.objectContaining({ tenantId: 'tenant', dbId: 'database-user' }));
    } finally { await app.close(); }
  });
});

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
    expect(service.findAllForClient).toHaveBeenCalledWith('client', 'tenant', 'database-user', req.user);
    expect(service.update).toHaveBeenCalledWith('contact', 'tenant', 'database-user', dto, []);
    expect(service.remove).toHaveBeenCalledWith('contact', 'tenant', 'database-user', []);
  });
});
