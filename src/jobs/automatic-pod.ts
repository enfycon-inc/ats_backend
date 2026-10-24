import { assertPodsEnabled } from '../auth/workspace-features';
import type { PrismaService } from '../prisma/prisma.service';
import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { usesAutomaticPods } from '../business-units/pod-strategy';

// The unit row serializes the cycle across simultaneous job publications.
// Call inside the transaction that also persists the job and its pod mapping.
export async function allocateAutomaticPod(tx: Prisma.TransactionClient, tenantId: string, branchId: string | null, unitId: string) {
  await assertPodsEnabled(tx as PrismaService, tenantId, unitId, branchId);
  await tx.$queryRaw`SELECT id FROM ats.business_units WHERE id = ${unitId}::uuid AND tenant_id = ${tenantId}::uuid FOR UPDATE`;
  const policy = await tx.businessUnit.findFirst({ where: { id: unitId, tenantId, branchId } });
  if (!policy || !usesAutomaticPods(policy)) throw new BadRequestException('The assignment policy changed. Refresh the job form.');
  const where: Prisma.PodWhereInput = {
    tenantId, branchId, businessUnitId: unitId,
    podHead: { tenantId, businessUnitId: unitId, isActive: true, isApproved: true },
    users: { some: { tenantId, businessUnitId: unitId, isActive: true, isApproved: true } },
  };
  const pods = await tx.pod.findMany({ where, select: { id: true, isAvailableForAssignment: true }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
  if (!pods.length) {
    if (policy.allowUnassigned) return null;
    throw new BadRequestException('This unit has no eligible pod. Add an active pod lead and members before publishing.');
  }
  let next = pods.find(pod => pod.isAvailableForAssignment);
  if (!next) {
    await tx.pod.updateMany({ where: { ...where, id: { in: pods.map(pod => pod.id) } }, data: { isAvailableForAssignment: true } });
    next = pods[0];
  }
  await tx.pod.update({ where: { id: next.id }, data: { isAvailableForAssignment: false } });
  return next.id;
}
