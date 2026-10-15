import { assertUnitPendingRequest } from './unit-pending-request';
import type { AuthUser } from '../interfaces/auth-user.interface';

describe('unit pending request boundary', () => {
  const actor = { tenantId: 'tenant', branchId: 'branch', businessUnitId: 'unit', permissions: ['unit_admin:manage', 'user:manage'] } as AuthUser;
  const target = { tenant_id: 'tenant', branch_id: 'branch', business_unit_id: 'unit', is_approved: false, requested_role: 'Recruiter' };
  it('accepts pending requests in the current unit', () => expect(() => assertUnitPendingRequest(actor, target)).not.toThrow());
  it.each(['tenant_id', 'branch_id', 'business_unit_id'])('rejects foreign %s', key => expect(() => assertUnitPendingRequest(actor, { ...target, [key]: 'foreign' })).toThrow('current unit'));
  it('fails closed without a unit assignment', () => expect(() => assertUnitPendingRequest({ ...actor, businessUnitId: undefined }, target)).toThrow());
  it('rejects approved and previously rejected requests', () => {
    expect(() => assertUnitPendingRequest(actor, { ...target, is_approved: true })).toThrow('no longer pending');
    expect(() => assertUnitPendingRequest(actor, { ...target, requested_role: null })).toThrow('no longer pending');
  });
});
