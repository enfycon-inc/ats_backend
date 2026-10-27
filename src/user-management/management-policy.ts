import { ForbiddenException } from '@nestjs/common';
import type { AuthUser } from '../auth/interfaces/auth-user.interface';

export function hasCapability(actor: AuthUser, key: string): boolean {
  return !!actor.permissions?.some(p => p === key || p === '*' || p === 'platform:manage');
}
export function requireCapability(actor: AuthUser, key: string) {
  if (!hasCapability(actor, key)) throw new ForbiddenException('You do not have permission to view or change this information.');
}
/** Returns parameterised SQL for the current tenant and authorised staff scope. */
export function managementScope(actor: AuthUser, alias = 'u', start = 1) {
  if (!actor.tenantId) throw new ForbiddenException('A workspace is required.');
  const values: unknown[] = [actor.tenantId];
  const clauses = [`${alias}.tenant_id = $${start}::uuid`];
  if (!actor.permissions?.some(p => ['*', 'platform:manage', 'tenant:settings', 'tenant:manage'].includes(p))) {
    const branches = [...new Set([...(actor.assignedBranchIds || []), ...(actor.branchId ? [actor.branchId] : [])])];
    if (!branches.length) clauses.push('FALSE');
    else { values.push(branches); clauses.push(`${alias}.branch_id = ANY($${start + values.length - 1}::uuid[])`); }
    if (!hasCapability(actor, 'branch_admin:manage')) {
      if (!actor.businessUnitId) clauses.push(`${alias}.id = $${start + values.length}::uuid`), values.push(actor.dbId);
      else { values.push(actor.businessUnitId); clauses.push(`${alias}.business_unit_id = $${start + values.length - 1}::uuid`); }
    }
  }
  return { sql: clauses.join(' AND '), values };
}
export function deviceLabel(userAgent: string): string {
  const browser = /Edg\//.test(userAgent) ? 'Edge' : /Firefox\//.test(userAgent) ? 'Firefox' : /Chrome\//.test(userAgent) ? 'Chrome' : /Safari\//.test(userAgent) ? 'Safari' : 'Unknown browser';
  const os = /Android/.test(userAgent) ? 'Android' : /iPhone|iPad/.test(userAgent) ? 'iOS' : /Windows/.test(userAgent) ? 'Windows' : /Macintosh/.test(userAgent) ? 'macOS' : /Linux/.test(userAgent) ? 'Linux' : 'Unknown OS';
  return `${browser} · ${os}`;
}
