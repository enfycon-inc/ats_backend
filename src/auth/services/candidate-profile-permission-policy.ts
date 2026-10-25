import type { PrismaClient } from '@prisma/client';
import { candidateProfileGrants } from '../../candidates/candidate-workspace';

export async function applyCandidateProfilePermissions(db: PrismaClient) {
  await db.$transaction(async tx => {
    await tx.$executeRawUnsafe("SELECT pg_advisory_xact_lock(hashtextextended('candidate-profile-v1', 0))");
    if (await tx.auditLog.findFirst({ where: { action: 'CANDIDATE_PROFILE_V1_COMPLETE', targetType: 'permission_policy', targetId: 'candidate-profile-v1' }, select: { id: true } })) return;
    for (const table of ['system_roles', 'custom_roles'] as const) {
      const roles = await tx.$queryRawUnsafe<{ id: string; tenant_id?: string; permissions: string[] }[]>(`SELECT id, ${table === 'custom_roles' ? 'tenant_id' : 'NULL::uuid AS tenant_id'}, permissions FROM ats.${table} FOR UPDATE`);
      for (const role of roles) {
        const before = Array.isArray(role.permissions) ? role.permissions : [];
        const added = candidateProfileGrants(before).filter(key => !before.includes(key));
        if (!added.length) continue;
        const after = [...before, ...added];
        await tx.$executeRawUnsafe(`UPDATE ats.${table} SET permissions = $1::jsonb WHERE id = $2::uuid`, JSON.stringify(after), role.id);
        await tx.auditLog.create({ data: { tenantId: role.tenant_id || null, actorId: 'candidate-permission-policy', action: 'CANDIDATE_PROFILE_V1', targetType: table === 'custom_roles' ? 'custom_role' : 'system_role', targetId: role.id, details: { before, added, after } } });
      }
    }
    await tx.auditLog.create({ data: { actorId: 'candidate-permission-policy', action: 'CANDIDATE_PROFILE_V1_COMPLETE', targetType: 'permission_policy', targetId: 'candidate-profile-v1', details: { version: 1 } } });
  }, { maxWait: 15000, timeout: 120000 });
}
