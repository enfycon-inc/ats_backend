import { BadRequestException, ForbiddenException } from '@nestjs/common';
import type { PrismaService } from '../prisma/prisma.service';
import type { AuthUser } from '../auth/interfaces/auth-user.interface';
import { assertJobSubmissionAccess } from '../jobs/job-submission-access';

export function candidateMarket(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) throw new BadRequestException('Select a staffing market.');
  const code = value.trim().toUpperCase();
  if (['IN', 'IND', 'INDIA'].includes(code)) return 'IN';
  if (['US', 'USIT', 'USA'].includes(code)) return 'US';
  if (!/^[A-Z][A-Z0-9_]{0,49}$/.test(code)) throw new BadRequestException('Invalid staffing market.');
  return code;
}
export function candidateAdminScope(actor: AuthUser, candidate: { branchId?: string | null }, permission: string) {
  const p = actor.permissions || [];
  if (p.includes('*') || p.includes('platform:manage')) return true;
  if (!p.includes(permission)) return false;
  if (p.includes('tenant:manage') || p.includes('tenant:settings')) return true;
  // Candidates are branch-owned; legacy unassigned records are shared within
  // the tenant, just as in the candidate catalog.
  return p.some(key => ['branch_admin:manage', 'unit_admin:manage'].includes(key)) && !!actor.branchId && (!candidate.branchId || candidate.branchId === actor.branchId);
}
export function candidateProfileGrants(permissions: string[]) {
  return permissions.some(key => ['tenant:manage', 'tenant:settings', 'branch_admin:manage', 'unit_admin:manage', 'platform:manage'].includes(key)) ? ['candidate:edit', 'candidate:change_market'] : [];
}
export async function resolveCandidateWorkspace(db: PrismaService, actor: AuthUser, tenantId: string, requestedBranch?: string | null, jobId?: string) {
  if (!actor?.dbId || actor.tenantId !== tenantId) throw new ForbiddenException('Invalid candidate workspace.');
  const p = actor.permissions || [];
  const tenantWide = p.some(key => ['tenant:settings', 'tenant:manage', 'platform:manage', '*'].includes(key));
  if (!p.includes('candidate:create') && !(jobId && p.includes('submission:create')) && !tenantWide) throw new ForbiddenException('Candidate upload permission is required.');
  const managed = actor as AuthUser & { homeTenantId?: string; managedTenant?: { id: string } };
  const managedTenant = p.some(key => ['platform:manage', '*'].includes(key)) && managed.managedTenant?.id === tenantId && managed.homeTenantId;
  const membership = await db.user.findFirst({ where: { id: actor.dbId, tenantId: managedTenant ? managed.homeTenantId : tenantId, isActive: true, isApproved: true }, select: { branchId: true, businessUnitId: true, fullName: true, email: true } });
  const member = membership && (managedTenant ? { ...membership, branchId: null, businessUnitId: null } : membership);
  if (!member) throw new ForbiddenException('Your current workspace membership is unavailable.');
  const branchId = requestedBranch || member.branchId;
  if (!tenantWide && branchId !== member.branchId) throw new ForbiddenException('Upload candidates within your assigned branch.');
  if (branchId && !await db.branch.findFirst({ where: { id: branchId, tenantId }, select: { id: true } })) throw new ForbiddenException('Branch is outside this workspace.');
  let market: string;
  if (jobId) {
    await assertJobSubmissionAccess(db, actor, tenantId, jobId, actor.dbId);
    const job = await db.job.findFirst({ where: { id: jobId, tenantId, deletedAt: null }, select: { market: true, branchId: true } });
    if (!job) throw new BadRequestException('Job is unavailable.');
    return { market: candidateMarket(job.market), branchId: job.branchId || undefined, uploadedByUserId: actor.dbId, uploadedByName: member.fullName || member.email };
  }
  if (member.businessUnitId) {
    const unit = await db.businessUnit.findFirst({ where: { id: member.businessUnitId, tenantId, ...(branchId ? { branchId } : {}) }, select: { marketSegment: { select: { code: true, isActive: true } } } });
    if (!unit?.marketSegment?.isActive) throw new BadRequestException('Your operating unit needs an active staffing market before uploading candidates.');
    market = candidateMarket(unit.marketSegment.code);
  } else {
    if (!tenantWide) throw new ForbiddenException('An operating unit assignment is required to upload candidates.');
    const tenant = await db.tenant.findUnique({ where: { id: tenantId }, select: { defaultMarket: true } });
    market = candidateMarket(tenant?.defaultMarket);
  }
  return { market, branchId: branchId || undefined, uploadedByUserId: actor.dbId, uploadedByName: member.fullName || member.email };
}
