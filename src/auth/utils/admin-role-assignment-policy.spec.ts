import { ForbiddenException } from '@nestjs/common';
import { assertRoleAssignmentAllowed, assertRoleManagementAccess } from './admin-role-assignment-policy';

const branchId = 'branch-1';
const businessUnitId = 'unit-1';

describe('administrative role assignment policy', () => {
  const deliveryHead = {
    systemRole: 'DELIVERY_HEAD',
    roles: ['DELIVERY_HEAD'],
    permissions: ['user:manage', 'unit_admin:manage', 'job:approve'],
    branchId,
    businessUnitId,
  };

  const unitAdmin = {
    systemRole: 'UNIT_ADMIN',
    roles: ['UNIT_ADMIN'],
    permissions: ['user:manage', 'unit_admin:manage', 'candidate:view'],
    branchId,
    businessUnitId,
  };

  it('denies Delivery Head access to role administration even when user:manage is granted', () => {
    expect(() => assertRoleManagementAccess(deliveryHead)).toThrow(ForbiddenException);
  });

  it('denies Delivery Head administrative roles identified by permissions, including custom roles', () => {
    expect(() => assertRoleAssignmentAllowed(deliveryHead, {
      name: 'Regional Coordinator',
      system_role: 'DELIVERY_HEAD',
      permissions: ['unit_admin:manage'],
    }, { branchId, businessUnitId })).toThrow(ForbiddenException);
  });

  it('allows Unit Admin assignment within the same branch and unit', () => {
    expect(() => assertRoleAssignmentAllowed(unitAdmin, {
      name: 'Unit Administrator',
      system_role: 'UNIT_ADMIN',
      branch_id: branchId,
      business_unit_id: businessUnitId,
      permissions: ['user:manage', 'unit_admin:manage', 'candidate:view'],
    }, { branchId, businessUnitId })).not.toThrow();
  });

  it('denies Unit Admin assignment outside the current unit or at a higher administrative level', () => {
    const unitRole = {
      name: 'Unit Administrator',
      system_role: 'UNIT_ADMIN',
      branch_id: branchId,
      business_unit_id: businessUnitId,
      permissions: ['user:manage', 'unit_admin:manage', 'candidate:view'],
    };
    expect(() => assertRoleAssignmentAllowed(unitAdmin, unitRole, { branchId, businessUnitId: 'unit-2' }))
      .toThrow(ForbiddenException);
    expect(() => assertRoleAssignmentAllowed(unitAdmin, {
      ...unitRole,
      system_role: 'BRANCH_ADMIN',
      permissions: ['branch_admin:manage'],
    }, { branchId, businessUnitId })).toThrow(ForbiddenException);
  });

  it('keeps ordinary business-role assignment available to Delivery Heads', () => {
    expect(() => assertRoleAssignmentAllowed(deliveryHead, {
      name: 'Recruiter',
      system_role: 'RECRUITER',
      permissions: ['candidate:view'],
    }, { branchId, businessUnitId })).not.toThrow();
  });
});
