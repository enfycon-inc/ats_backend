import { BadRequestException, ForbiddenException } from '@nestjs/common';
import type { JobCapabilities } from './job-capabilities';

export type JobAction = 'edit' | 'change_status' | 'find_matches' | 'manage_publication';
type Actor = { dbId?: string; tenantId?: string; branchId?: string; businessUnitId?: string; permissions?: string[] };
export type JobScope = { approvalStatus?: string | null; status?: string | null; tenantId?: string; accountManagerId?: string | null; branchId?: string | null; businessUnitId?: string | null; directlyAssigned?: boolean; podAssigned?: boolean; podsEnabled?: boolean };
export function isClosedJob(status?: string | null) { return ['CLOSED', 'CLOSE'].includes(status?.trim().toUpperCase() || ''); }
export function isActiveApprovedJob(job: JobScope) {
  return job.status?.trim().toUpperCase() === 'ACTIVE' && (!job.approvalStatus || job.approvalStatus === 'APPROVED');
}
export function canActOnJob(actor: Actor | undefined, job: JobScope, action: JobAction): boolean {
  if (!actor?.dbId || !actor.tenantId || job.tenantId !== actor.tenantId) return false;
  if (action !== 'change_status' && isClosedJob(job.status)) return false;
  if ((action === 'find_matches' || action === 'manage_publication') && !isActiveApprovedJob(job)) return false;
  const permissions = actor.permissions || [];
  const has = (key: string) => permissions.includes(key);
  const sameBranch = Boolean(actor.branchId && job.branchId === actor.branchId);
  const sameUnit = Boolean(sameBranch && actor.businessUnitId && job.businessUnitId === actor.businessUnitId);
  if (has('*') || has('platform:manage')) return true;
  if (action === 'find_matches' && !has('candidate:view')) return false;
  if (action === 'manage_publication') {
    return (has('job:manage_publication_tenant') && (has('tenant:manage') || has('tenant:settings')))
      || (sameBranch && has('job:manage_publication_branch') && has('branch_admin:manage'))
      || (sameUnit && has('job:manage_publication_unit') && has('unit_admin:manage'));
  }
  if (action === 'find_matches' && has('job:find_matches_assigned') && has('job:view') && has('candidate:view') && sameUnit) {
    if (job.directlyAssigned || (job.podsEnabled && job.podAssigned && (has('job:view_pod_jobs') || has('job:submit_pod_jobs')))) return true;
  }
  if (has('tenant:manage') || has('tenant:settings')) return true;
  if (has(`job:${action}_tenant`)) return true;
  if (sameBranch && (has(`job:${action}_branch`) || has('branch_admin:manage'))) return true;
  if (sameUnit && (has(`job:${action}_unit`) || has('unit_admin:manage'))) return true;
  return sameBranch && (!actor.businessUnitId || sameUnit) && job.accountManagerId === actor.dbId && has(`job:${action}`);
}
export function canSubmitToJob(actor: Actor | undefined, job: JobScope): boolean {
  return Boolean(actor?.dbId && actor.tenantId === job.tenantId && actor.branchId && actor.branchId === job.branchId && actor.businessUnitId && actor.businessUnitId === job.businessUnitId && actor.permissions?.includes('submission:create') && isActiveApprovedJob(job) && (job.directlyAssigned || (job.podsEnabled && job.podAssigned && actor.permissions.includes('job:submit_pod_jobs'))));
}
export function assertJobAction(actor: Actor | undefined, job: JobScope, action: JobAction) {
  if (action !== 'change_status' && isClosedJob(job.status)) throw new BadRequestException('This job is closed. Reopen it before editing, matching or publishing.');
  if (!canActOnJob(actor, job, action)) throw new ForbiddenException('You do not have permission to perform this action on this job.');
}
export function jobCapabilities(actor: Actor | undefined, job: JobScope): JobCapabilities {
  return { edit: canActOnJob(actor, job, 'edit'), changeStatus: canActOnJob(actor, job, 'change_status'), findMatches: canActOnJob(actor, job, 'find_matches'), managePublication: canActOnJob(actor, job, 'manage_publication'), submitCandidate: canSubmitToJob(actor, job) };
}
