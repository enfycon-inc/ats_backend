/** Pure capability policy shared with the separately built web client. */
export interface ManagementActor {
  id?: string;
  dbId?: string;
  tenantId?: string;
  branchId?: string | null;
  businessUnitId?: string | null;
  permissions?: string[];
  systemRole?: string | null;
  roles?: string[];
}
export interface ManagedMember {
  id?: string;
  tenantId?: string;
  branchId?: string | null;
  businessUnitId?: string | null;
  permissions?: string[];
}

/** An active archetype is not inferred from unrelated capabilities or inactive roles. */
export function activeManagementRole(actor: ManagementActor): string {
  return String(actor.systemRole || actor.roles?.[0] || '')
    .trim()
    .toUpperCase()
    .replace(/[\s-]/g, '_');
}

export function userManagementActions(
  actor: ManagementActor,
  target: ManagedMember,
) {
  const p = actor.permissions || [];
  const platform = p.includes('*') || p.includes('platform:manage');
  const tenantWide =
    platform || p.includes('tenant:settings') || p.includes('tenant:manage');
  const branchWide = p.includes('branch_admin:manage');
  const sameTenant = !!actor.tenantId && actor.tenantId === target.tenantId;
  const sameBranch = !!actor.branchId && actor.branchId === target.branchId;
  const sameUnit =
    !!actor.businessUnitId && actor.businessUnitId === target.businessUnitId;
  const targetPermissions = target.permissions || [];
  const protectedTarget =
    !tenantWide &&
    targetPermissions.some((key) =>
      [
        '*',
        'platform:manage',
        'tenant:settings',
        'tenant:manage',
        ...(!branchWide ? ['branch_admin:manage'] : []),
      ].includes(key),
    );
  const scope =
    (platform || sameTenant) &&
    (tenantWide || (sameBranch && (branchWide || sameUnit))) &&
    !protectedTarget;
  const manage = scope && (platform || p.includes('user:manage'));
  const self = !!target.id && target.id === (actor.dbId || actor.id);
  return {
    editProfile: manage,
    assignRoles: manage,
    assignManager: manage,
    resetPassword: manage,
    reviewRequest: manage,
    changeStatus: manage && !self,
    endSessions: manage && !self,
    deleteUser: scope && (platform || p.includes('tenant:settings')) && !self,
  };
}
