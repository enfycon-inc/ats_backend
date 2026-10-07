import { ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

// Read current assignments on every request so removing a role takes effect immediately.
export async function resolveActiveRole(prisma: PrismaService, actor: any, selection: unknown) {
  if (selection !== undefined && (typeof selection !== 'string' || !/^[0-9a-f-]{36}$/i.test(selection))) {
    throw new ForbiddenException('Invalid active role.');
  }
  const member = await prisma.user.findFirst({
    where: { id: actor.dbId, tenantId: actor.tenantId, isActive: true },
    select: { roleId: true, assignedRoleIds: true, branchId: true, businessUnitId: true, podId: true },
  });
  if (!member) throw new ForbiddenException('Workspace membership is unavailable.');
  const ids = [...new Set([member.roleId, ...member.assignedRoleIds].filter((id): id is string => !!id))];
  const id = selection || member.roleId || ids[0];
  if (!id) return { ...actor, permissions: [], roles: [], systemRole: null, activeRoleId: null };
  if (!ids.includes(id as string)) throw new ForbiddenException('The selected role is not assigned to you.');
  const role = await prisma.customRole.findFirst({
    where: { id: id as string, tenantId: actor.tenantId },
    select: { id: true, name: true, permissions: true, branchId: true, businessUnitId: true,
      systemRole: { select: { systemKey: true } } },
  });
  if (!role) throw new ForbiddenException('The selected role is unavailable.');
  if ((role.branchId && role.branchId !== member.branchId) ||
      (role.businessUnitId && role.businessUnitId !== member.businessUnitId)) {
    throw new ForbiddenException('The selected role does not match your office assignment.');
  }
  return { ...actor, activeRoleId: role.id, roleName: role.name,
    roles: [role.systemRole?.systemKey || role.name], systemRole: role.systemRole?.systemKey || null,
    permissions: Array.isArray(role.permissions) ? role.permissions.filter((p): p is string => typeof p === 'string') : [],
    branchId: member.branchId, businessUnitId: member.businessUnitId, podId: member.podId };
}
