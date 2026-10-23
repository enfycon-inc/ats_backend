import { contactInputErrors, normalizeContactInput } from './client-creation.contract';
import { ClientContactsService } from '../client-contacts/client-contacts.service';

describe('structured client POC input', () => {
  const contact = { firstName: ' Ananya ', lastName: ' Sen ', designation: 'HR Manager', email: ' ananya@example.test ', phone: '+91 98765 43210' };
  it('combines structured names and normalizes India numbers without losing the designation', () => {
    expect(contactInputErrors(contact)).toEqual({});
    expect(normalizeContactInput(contact)).toEqual({ name: 'Ananya Sen', designation: 'HR Manager', email: 'ananya@example.test', phone: '+919876543210' });
  });
  it('supports a single name, Unicode names, and an omitted mobile number', () => {
    const input = { firstName: 'अनन्या', email: 'person@example.test' };
    expect(contactInputErrors(input)).toEqual({});
    expect(normalizeContactInput(input)).toMatchObject({ name: 'अनन्या', phone: undefined });
    expect(contactInputErrors({ ...input, firstName: '', lastName: 'Sen' })).toHaveProperty('firstName');
  });
  it('requires an actual custom title for Other', () => {
    expect(contactInputErrors({ ...contact, designation: 'Other' })).toHaveProperty('otherDesignation');
    expect(normalizeContactInput({ ...contact, designation: 'Other', otherDesignation: ' People Operations Lead ' }).designation).toBe('People Operations Lead');
  });
  it('validates international numbers independently of the client market', () => {
    for (const phone of ['+14155552671', '+442079460018']) expect(contactInputErrors({ ...contact, phone })).toEqual({});
    for (const phone of ['9876543210', '+9198', '+999123456789', 'invalid']) expect(contactInputErrors({ ...contact, phone })).toHaveProperty('phone');
  });
  it('preserves legacy full names and rejects malformed structured values', () => {
    expect(normalizeContactInput({ name: 'Mary Jane van der Berg' }).name).toBe('Mary Jane van der Berg');
    expect(contactInputErrors({ name: 'Legacy contact' }, false)).toEqual({});
    expect(contactInputErrors({ ...contact, firstName: 3 } as any)).toHaveProperty('firstName');
    expect(contactInputErrors({ ...contact, firstName: 'a'.repeat(255), lastName: 'b' })).toHaveProperty('firstName');
    expect(contactInputErrors({ ...contact, email: '' })).toHaveProperty('email');
  });
  it('normalizes contacts added to an existing client through the authorized service', async () => {
    const actor: any = { dbId: 'owner', tenantId: 'tenant', permissions: ['client:view', 'client:create', 'tenant:settings'] };
    const db: any = { tenant: { findUnique: jest.fn().mockResolvedValue({}) }, client: { findFirst: jest.fn().mockResolvedValue({ id: 'client' }) },
      clientContact: { create: jest.fn(async ({ data }) => ({ id: 'contact', ...data, creator: { id: 'owner', fullName: 'Owner' } })) } };
    const service = new ClientContactsService(db);
    await service.create('client', 'tenant', 'owner', contact, actor);
    expect(db.clientContact.create.mock.calls[0][0].data).toMatchObject({ name: 'Ananya Sen', phone: '+919876543210', email: 'ananya@example.test', createdBy: 'owner', clientId: 'client', tenantId: 'tenant' });
    await expect(service.create('client', 'tenant', 'owner', { ...contact, phone: '+9198' }, actor)).rejects.toThrow('country code');
    expect(db.clientContact.create).toHaveBeenCalledTimes(1);
  });
});
