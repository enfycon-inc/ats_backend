import { isActiveApprovedJob } from './job-action-policy';
import { assertPodsEnabled } from '../auth/workspace-features';
import { ForbiddenException } from '@nestjs/common';
import type { AuthUser } from '../auth/interfaces/auth-user.interface';
import type { PrismaService } from '../prisma/prisma.service';

export async function assertJobSubmissionAccess(db: PrismaService, actor: AuthUser | undefined, tenantId: string, jobId: string, recruiterId: string) {
  if (!actor?.dbId || !actor.permissions?.includes('submission:create')) throw new ForbiddenException('Missing submission:create permission.');
  if (actor.tenantId !== tenantId) throw new ForbiddenException('Submission belongs to another workspace.');
  if (recruiterId !== actor.dbId) throw new ForbiddenException('Submit candidates under your own recruiter account.');
  const member = await db.user.findFirst({ where: { id: actor.dbId, tenantId, isActive: true, isApproved: true }, select: { branchId: true, businessUnitId: true, podId: true } });
  if (!member?.branchId || !member.businessUnitId) throw new ForbiddenException('A current branch and unit assignment is required.');
  const job = await db.job.findFirst({ where: { id: jobId, tenantId, branchId: member.branchId, businessUnitId: member.businessUnitId, deletedAt: null }, select: { id: true, status: true, approvalStatus: true } });
  if (!job) throw new ForbiddenException('Job is outside your current unit.');
  if (!isActiveApprovedJob(job)) throw new ForbiddenException('Only active, approved jobs accept candidate submissions.');
  if (await db.jobRecruiter.findUnique({ where: { jobId_recruiterId: { jobId, recruiterId: actor.dbId } }, select: { jobId: true } })) return;
  if (actor.permissions.includes('job:submit_pod_jobs')) await assertPodsEnabled(db, tenantId, member.businessUnitId, member.branchId);
  if (actor.permissions.includes('job:submit_pod_jobs') && member.podId && await db.jobPod.findUnique({ where: { jobId_podId: { jobId, podId: member.podId } }, select: { jobId: true } })) return;
  throw new ForbiddenException('Ask your pod lead to assign this job to you before submitting.');
}
