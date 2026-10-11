import { protectPoc, protectClientContactFields } from './poc-access';
import { clientReadWhere } from './client-visibility';
import { ClientsService } from './clients.service';
import { ClientContactsService } from '../client-contacts/client-contacts.service';
const actor: any = { tenantId: 'tenant', dbId: 'owner', email: 'owner@example.test', branchId: 'branch', businessUnitId: 'unit', permissions: ['client:view', 'client:bdm_access'] };
const policy = { clientsVisibleAcrossUnits: false, bdmClientsTenantWide: true, otherOwnerPocsVisible: true, maskOtherOwnerPocDetails: true };
const contact = { id: 'contact', name: 'Name', email: 'private@example.test', phone: '123', linkedinUrl: 'private', notes: 'private' };
describe('client and POC access controls', () => {
  it('BDM tenant visibility is independent of legacy sharing', async () => {
    const prisma: any = { tenant: { findUnique: jest.fn().mockResolvedValue(policy) } };
    expect(await clientReadWhere(prisma, 'tenant', actor)).toEqual({ tenantId: 'tenant' });
    await expect(clientReadWhere(prisma, 'foreign', actor)).rejects.toThrow('workspace');
  });
  it('disabled BDM sharing retains ownership scope even if legacy sharing is enabled', async () => {
    const prisma: any = { tenant: { findUnique: jest.fn().mockResolvedValue({ ...policy, bdmClientsTenantWide: false, clientsVisibleAcrossUnits: true }) }, user: { findMany: jest.fn().mockResolvedValue([]) } };
    expect(await clientReadWhere(prisma, 'tenant', actor)).toHaveProperty('AND');
  });
  it('owners keep full details under every privacy setting', () => {
    expect(protectPoc(contact, actor.dbId, actor, { ...policy, otherOwnerPocsVisible: false })).toEqual(contact);
  });
  it('hides non-owner POCs when sharing is disabled', () => {
    expect(protectPoc(contact, 'other', actor, { ...policy, otherOwnerPocsVisible: false })).toBeNull();
    expect(protectPoc(contact, 'other', actor, null)).toBeNull();
  });
  it('removes private fields from shared POCs without mutating the original', () => {
    expect(protectPoc(contact, 'other', actor, policy)).toMatchObject({ name: 'Name', email: null, phone: null, linkedinUrl: null, notes: null, contactDetailsMasked: true });
    expect(contact.email).toBe('private@example.test');
  });
  it('allows shared details only when masking is disabled', () => {
    expect(protectPoc(contact, 'other', actor, { ...policy, maskOtherOwnerPocDetails: false })).toEqual(contact);
  });
  it('protects legacy camel and snake contact fields', () => {
    const value = { primaryOwner: 'other', contactPerson: 'Name', contact_person: 'Name', emailId: 'private', email_id: 'private', contactNumber: '123', contact_number: '123', fax: '123' };
    const masked = protectClientContactFields(value, actor, policy);
    expect(masked).toMatchObject({ contactPerson: 'Name', emailId: null, email_id: null, contactNumber: null, contact_number: null, fax: null });
    expect(protectClientContactFields(value, actor, { ...policy, otherOwnerPocsVisible: false })).toMatchObject({ contactPerson: null, contact_person: null });
  });
  it('keeps legacy contact details for UUID or email owners', () => {
    for (const owner of [actor.dbId, actor.email]) {
      const value = { primaryOwner: owner, emailId: 'private' };
      expect(protectClientContactFields(value, actor, policy)).toEqual(value);
    }
  });
  it('filters private contacts in the database and never returns other contacts', async () => {
    const prisma: any = { tenant: { findUnique: jest.fn().mockResolvedValue({ ...policy, otherOwnerPocsVisible: false }) }, client: { findFirst: jest.fn().mockResolvedValue({ id: 'client' }) }, clientContact: { findMany: jest.fn().mockResolvedValue([]) } };
    expect(await new ClientContactsService(prisma).findAllForClient('client', 'tenant', actor.dbId, actor)).toEqual({ myContacts: [], otherContacts: [] });
    expect(prisma.clientContact.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { clientId: 'client', tenantId: 'tenant', createdBy: actor.dbId } }));
  });
  it('masked contacts cannot be revealed through an administrative update response', async () => {
    const prisma: any = { tenant: { findUnique: jest.fn().mockResolvedValue(policy) }, clientContact: { findFirst: jest.fn().mockResolvedValue({ ...contact, createdBy: 'other' }), updateMany: jest.fn(), update: jest.fn() } };
    await expect(new ClientContactsService(prisma).update('contact', 'tenant', actor.dbId, { isPrimary: true }, ['tenant:manage'])).rejects.toThrow('owner');
    expect(prisma.clientContact.updateMany).not.toHaveBeenCalled();
    expect(prisma.clientContact.update).not.toHaveBeenCalled();
  });
  it('shares full POCs only when the configured policy explicitly allows it', async () => {
    const prisma: any = { tenant: { findUnique: jest.fn().mockResolvedValue(policy) }, client: { findFirst: jest.fn().mockResolvedValue({ id: 'client' }) }, clientContact: { findMany: jest.fn().mockResolvedValue([{ ...contact, createdBy: 'other' }]) } };
    const result = await new ClientContactsService(prisma).findAllForClient('client', 'tenant', actor.dbId, actor);
    expect(result.otherContacts).toEqual([expect.objectContaining({ name: 'Name', email: null, phone: null, notes: null })]);
    expect(result.myContacts).toEqual([]);
  });
  it('rejects malformed, unknown and unauthorized setting changes', async () => {
    const service = new ClientsService({} as any);
    await expect(service.setVisibilityPolicy(actor, policy)).rejects.toThrow('permission');
    const admin = { ...actor, permissions: ['tenant:settings'] };
    await expect(service.setVisibilityPolicy(admin, { bdmClientsTenantWide: 'yes' })).rejects.toThrow('enabled or disabled');
    await expect(service.setVisibilityPolicy(admin, { tenantId: true })).rejects.toThrow('enabled or disabled');
    await expect(service.setVisibilityPolicy(admin, {})).rejects.toThrow('at least one');
  });
});
