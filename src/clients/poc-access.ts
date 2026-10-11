import type { AuthUser } from '../auth/interfaces/auth-user.interface';
import type { PrismaService } from '../prisma/prisma.service';

export const clientAccessSelect = {
  clientsVisibleAcrossUnits: true, bdmClientsTenantWide: true,
  otherOwnerPocsVisible: true, maskOtherOwnerPocDetails: true,
} as const;
export type ClientAccessPolicy = { clientsVisibleAcrossUnits: boolean; bdmClientsTenantWide: boolean; otherOwnerPocsVisible: boolean; maskOtherOwnerPocDetails: boolean };
export async function loadPocPolicy(prisma: PrismaService, tenantId: string) {
  const policy = await prisma.tenant.findUnique({ where: { id: tenantId }, select: clientAccessSelect });
  return policy;
}
export function protectPoc<T extends Record<string, any>>(contact: T, ownerId: string | null, actor: AuthUser, policy: ClientAccessPolicy | null): T | null {
  if (ownerId && ownerId === actor.dbId) return contact;
  if (!policy?.otherOwnerPocsVisible) return null;
  if (!policy.maskOtherOwnerPocDetails) return contact;
  return { ...contact, email: null, phone: null, linkedinUrl: null, notes: null, contactDetailsMasked: true };
}
export function protectClientContactFields(client: Record<string, any>, actor: AuthUser, policy: ClientAccessPolicy | null) {
  const owner = client.primaryOwnerId || client.primaryOwner || client.createdBy;
  if (owner === actor.dbId || owner === actor.email) return client;
  const result = { ...client };
  if (!policy?.otherOwnerPocsVisible) {
    for (const key of ['contactPerson', 'contactDesignation', 'clientLead', 'contact_person', 'contact_designation', 'client_lead']) result[key] = null;
  }
  if (!policy?.otherOwnerPocsVisible || policy.maskOtherOwnerPocDetails) {
    for (const key of ['contactNumber', 'emailId', 'fax', 'contact_number', 'email_id']) result[key] = null;
    result.contactDetailsMasked = true;
  }
  return result;
}
