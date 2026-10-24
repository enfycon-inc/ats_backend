import { BadRequestException, ForbiddenException } from '@nestjs/common';

export type JobAction = 'edit' | 'change_status' | 'find_matches';
type Actor = { dbId?: string; tenantId?: string; branchId?: string; businessUnitId?: string; permissions?: string[] };
type JobScope = { status?: string | null; tenantId?: string; accountManagerId?: string | null; branchId?: string | null; businessUnitId?: string | null };

export function isClosedJob(status?: string | null) {
  return ['CLOSED', 'CLOSE'].includes(status?.trim().toUpperCase() || '');
}

export function canActOnJob(actor: Actor | undefined, job: JobScope, action: JobAction): boolean {
  if (action !== 'change_status' && isClosedJob(job.status)) return false;
  if (!actor?.dbId || !actor.tenantId || job.tenantId !== actor.tenantId) return false;
  const permissions = actor.permissions || [];
  const has = (key: string) => permissions.includes(key);
  if (has('*') || has('platform:manage') || has('tenant:manage') || has('tenant:settings')) return true;
  if (has(`job:${action}_tenant`)) return true;
  const sameBranch = Boolean(actor.branchId && job.branchId === actor.branchId);
  const sameUnit = Boolean(sameBranch && actor.businessUnitId && job.businessUnitId === actor.businessUnitId);
  if (sameBranch && (has(`job:${action}_branch`) || has('branch_admin:manage'))) return true;
  if (sameUnit && (has(`job:${action}_unit`) || has('unit_admin:manage'))) return true;
  // Creating a job on behalf of somebody else does not transfer ownership.
  return sameBranch && (!actor.businessUnitId || sameUnit) && job.accountManagerId === actor.dbId && has(`job:${action}`);
}

export function assertJobAction(actor: Actor | undefined, job: JobScope, action: JobAction) {
  if (action !== 'change_status' && isClosedJob(job.status)) throw new BadRequestException('This job is closed. Reopen it before editing or finding AI matches.');
  if (!canActOnJob(actor, job, action)) throw new ForbiddenException('You do not have permission to perform this action on this job.');
}

export function jobCapabilities(actor: Actor | undefined, job: JobScope) {
  return { edit: canActOnJob(actor, job, 'edit'), changeStatus: canActOnJob(actor, job, 'change_status'), findMatches: canActOnJob(actor, job, 'find_matches') };
}
