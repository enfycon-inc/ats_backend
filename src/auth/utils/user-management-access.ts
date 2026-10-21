import { ForbiddenException } from '@nestjs/common';
import {
  userManagementActions,
  type ManagementActor,
} from '../user-management-policy';

/** Correlated projection, used only with internal SQL aliases. */
export function memberPermissionProjection(alias: string) {
  return `ARRAY(SELECT DISTINCT permission FROM ats.custom_roles access_role
    CROSS JOIN LATERAL jsonb_array_elements_text(CASE WHEN jsonb_typeof(access_role.permissions::jsonb) = 'array' THEN access_role.permissions::jsonb ELSE '[]'::jsonb END) AS role_permissions(permission)
    WHERE access_role.tenant_id = ${alias}.tenant_id AND
      (access_role.id = ${alias}.role_id OR access_role.id = ANY(${alias}.assigned_role_ids))) AS management_permissions`;
}

export function assertMemberAction(
  actor: ManagementActor,
  member: any,
  action: keyof ReturnType<typeof userManagementActions>,
) {
  const actions = userManagementActions(actor, {
    id: member.id,
    tenantId: member.tenant_id,
    branchId: member.branch_id,
    businessUnitId: member.business_unit_id,
    permissions: member.management_permissions || [],
  });
  if (!actions[action])
    throw new ForbiddenException(
      'You cannot perform this user-management action outside your permitted workspace, branch or unit, or on a protected account.',
    );
}
