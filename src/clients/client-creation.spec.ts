import { ClientsService } from './clients.service';
import { resolveClientCreationContext } from './client-market-policy';
import { clientCreationErrors, normalizeClientMarket, type ClientCreationRequest } from './client-creation.contract';

describe('shared client creation policy', () => {
  const tenantId = '154fbda6-0a8f-4fa5-9c12-93727235798e';
  const branchId = 'd83927bc-fad8-4ad4-b7aa-e55b88a6ab44';
  const unitId = 'f90f9b77-2ba6-4b9e-823d-7e073bbbdc44';
  const actor: any = { dbId: 'f8bdcd3f-c327-46ea-a277-678e812d5c74', tenantId, permissions: ['client:create'] };
  const request: ClientCreationRequest = { request_id: '737f666b-916a-4e9c-91bd-b2bd37e475d1', client_name: 'Example', category: 'Direct employer', branch_id: branchId, business_unit_id: unitId, market: 'INDIA', currency: 'INR' };
  function setup() {
    const db: any = {
      user: { findFirst: jest.fn().mockResolvedValue({ id: actor.dbId, fullName: 'Account manager', branchId, businessUnitId: unitId, jobReviewerId: actor.dbId }) },
      branch: { findFirst: jest.fn().mockResolvedValue({ id: branchId, name: 'Kolkata', market: 'US' }) },
      businessUnit: { findFirst: jest.fn().mockResolvedValue({ id: unitId, name: 'India Staffing', currency: 'INR', marketSegmentId: unitId, marketSegment: { code: 'IND', defaultCurrency: 'INR', isActive: true, tenantId: null } }) },
      tenant: { findUnique: jest.fn().mockResolvedValue({ prefixCode: 'EX', name: 'Example' }) },
      tenantCounters: { upsert: jest.fn().mockResolvedValue({ currentValue: 1 }) },
      client: { findFirst: jest.fn().mockResolvedValue(null), findMany: jest.fn().mockResolvedValue([]), create: jest.fn(async ({ data }) => ({ ...data })), update: jest.fn() },
      $executeRaw: jest.fn(),
    };
    db.$transaction = jest.fn(async fn => fn(db));
    return { db, service: new ClientsService(db) };
  }
  it('validates optional company phone independently from contact person phone and persists it', async () => {
    for (const phone of ['', '+91 98765 43210', '+14155552671']) expect(clientCreationErrors({ ...request, contact_number: phone })).toEqual({});
    for (const phone of ['9876543210', '+9198', 'invalid']) expect(clientCreationErrors({ ...request, contact_number: phone })).toHaveProperty('contact_number');
    const { db, service } = setup();
    await service.createClient({ ...request, contact_number: '+91 98765 43210' }, tenantId, actor.dbId, actor);
    expect(db.client.create.mock.calls[0][0].data.contactNumber).toBe('+91 98765 43210');
  });
  it('uses the India unit market in Kolkata even when the branch is configured for US', async () => {
    const { db } = setup();
    const context = await resolveClientCreationContext(db, tenantId, actor);
    expect(context).toMatchObject({ market: 'INDIA', currency: 'INR', branchName: 'Kolkata', businessUnitName: 'India Staffing', canDirectAdd: false });
    expect(db.businessUnit.findFirst.mock.calls[0][0].where).toEqual({ id: unitId, tenantId, branchId });
  });
  it('retains US unit behavior and recognizes deployed market codes', async () => {
    const { db } = setup();
    db.businessUnit.findFirst.mockResolvedValue({ id: unitId, name: 'US Staffing', currency: 'USD', marketSegmentId: unitId, marketSegment: { code: 'USIT', defaultCurrency: 'USD', isActive: true, tenantId } });
    expect(await resolveClientCreationContext(db, tenantId, actor)).toMatchObject({ market: 'US', currency: 'USD' });
    expect(['IN', 'IND', 'INDIA'].map(normalizeClientMarket)).toEqual(['INDIA', 'INDIA', 'INDIA']);
  });
  it('rejects forged US market, currency, and foreign branch or unit before writing', async () => {
    for (const changes of [{ market: 'US' }, { currency: 'USD' }, { branch_id: request.request_id }, { business_unit_id: request.request_id }]) {
      const { db, service } = setup();
      await expect(service.createClient({ ...request, ...changes } as ClientCreationRequest, tenantId, actor.dbId, actor)).rejects.toThrow();
      expect(db.client.create).not.toHaveBeenCalled();
      expect(db.tenantCounters.upsert).not.toHaveBeenCalled();
    }
  });
  it('rejects unsupported, inactive, and currency-conflicting unit configuration', async () => {
    for (const segment of [{ code: 'UNKNOWN', isActive: true }, { code: 'IND', isActive: false }, { code: 'IND', isActive: true, defaultCurrency: 'USD' }, { code: 'IND', isActive: true, tenantId: 'foreign' }]) {
      const { db } = setup();
      db.businessUnit.findFirst.mockResolvedValue({ id: unitId, marketSegmentId: unitId, marketSegment: segment });
      await expect(resolveClientCreationContext(db, tenantId, actor)).rejects.toThrow();
    }
  });
  it('requires explicit creation permission', async () => {
    const { db } = setup();
    await expect(resolveClientCreationContext(db, tenantId, { ...actor, roles: ['TENANT_ADMIN'], permissions: [] })).rejects.toThrow('permission');
    expect(db.user.findFirst).not.toHaveBeenCalled();
  });
  it('derives ownership and approval and creates the primary contact in the same write', async () => {
    const { db, service } = setup();
    const saved = await service.createClient({ ...request, status: 'Active', ownership: 'forged', contact: { firstName: 'Primary', lastName: 'Contact', email: 'primary@example.test', phone: '+91 98765 43210' } } as any, tenantId, actor.dbId, actor);
    expect(saved).toMatchObject({ market: 'INDIA', currency: 'INR', status: 'Pending Approval', approval_status: 'PENDING_APPROVAL' });
    expect(db.client.create.mock.calls[0][0].data).toMatchObject({ id: request.request_id, primaryOwner: actor.dbId, ownership: actor.dbId, businessUnit: 'India Staffing', branchId,
      clientContacts: { create: { tenantId, createdBy: actor.dbId, name: 'Primary Contact', email: 'primary@example.test', phone: '+919876543210', isPrimary: true } } });
    expect(db.$transaction).toHaveBeenCalledTimes(1);
  });
  it('does not grant direct approval from an inactive role bundle', async () => {
    const { service } = setup();
    expect(await service.createClient(request, tenantId, actor.dbId, actor)).toMatchObject({ approval_status: 'PENDING_APPROVAL' });
    const direct = setup();
    expect(await direct.service.createClient(request, tenantId, actor.dbId, { ...actor, permissions: ['client:direct_add'] })).toMatchObject({ approval_status: 'APPROVED' });
  });
  it('returns the original client on a retry without allocating another code or contact', async () => {
    const { db, service } = setup();
    db.client.findFirst.mockResolvedValue({ id: request.request_id, clientName: request.client_name });
    expect(await service.createClient(request, tenantId, actor.dbId, actor)).toMatchObject({ id: request.request_id });
    expect(db.client.create).not.toHaveBeenCalled();
    expect(db.tenantCounters.upsert).not.toHaveBeenCalled();
    expect(db.client.findFirst.mock.calls[0][0].where).toMatchObject({ tenantId, createdBy: actor.dbId });
  });
  it('keeps company email optional, but validates legal name, category, and an added contact', () => {
    expect(clientCreationErrors(request)).toEqual({});
    expect(clientCreationErrors({ ...request, category: undefined, client_name: ' ' })).toHaveProperty('client_name');
    expect(clientCreationErrors({ ...request, contact: { name: 'Person', email: '' } })).toHaveProperty('contact');
    expect(clientCreationErrors({ ...request, commission_percentage: 101 })).toHaveProperty('commission_percentage');
    expect(clientCreationErrors({ ...request, email_id: 42 } as any)).toHaveProperty('email_id');
  });
  it('propagates a failed nested contact write instead of returning a partial success', async () => {
    const { db, service } = setup();
    db.client.create.mockRejectedValue(new Error('Contact write failed'));
    await expect(service.createClient({ ...request, contact: { name: 'Person', email: 'person@example.test' } }, tenantId, actor.dbId, actor)).rejects.toThrow('Contact write failed');
  });
  it('rejects market switching through any client editor before updating the record', async () => {
    const { db, service } = setup();
    db.client.findFirst.mockResolvedValue({ id: request.request_id, primaryOwner: actor.dbId, createdBy: actor.dbId, market: 'INDIA', currency: 'INR', branchId });
    await expect(service.updateClient(request.request_id, { market: 'US', currency: 'USD' }, tenantId, actor.dbId, { ...actor, permissions: ['client:edit'] })).rejects.toThrow('cannot be changed');
    expect(db.client.update).not.toHaveBeenCalled();
  });
  it('keeps duplicate company detection without disclosing an inaccessible client name', async () => {
    const { db, service } = setup();
    db.client.findMany.mockResolvedValue([{ clientName: 'Example Private Limited' }]);
    await expect(service.createClient(request, tenantId, actor.dbId, actor)).rejects.toThrow('A similar client already exists');
    expect(db.client.create).not.toHaveBeenCalled();
    expect(db.tenantCounters.upsert).not.toHaveBeenCalled();
  });
});
