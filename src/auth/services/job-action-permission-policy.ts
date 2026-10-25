import { applySubmissionScopePermissions } from './submission-scope-permission-policy';
import { jobAccessGrants } from '../job-access-grants';
import { applyCandidateProfilePermissions } from './candidate-profile-permission-policy';
import { PrismaClient } from '@prisma/client';

// A versioned configuration update, not a schema migration. Audit markers ensure
// subsequent deliberate permission removals are never undone on restart.
async function applyOwnJobActionsV1(prisma: PrismaClient) {
  return prisma.$transaction(async tx => {
    await tx.$executeRawUnsafe("SELECT pg_advisory_xact_lock(hashtextextended('job-own-actions-v1', 0))");
    const applied = await tx.auditLog.findFirst({ where: { action: 'JOB_OWN_ACTIONS_V1_COMPLETE', targetType: 'permission_policy', targetId: 'job-own-actions-v1' }, select: { id: true } });
    if (applied) return;
    for (const table of ['system_roles', 'custom_roles'] as const) {
      const roles = await tx.$queryRawUnsafe<{ id: string; tenant_id?: string; permissions: string[] }[]>(
        `SELECT id, ${table === 'custom_roles' ? 'tenant_id' : 'NULL::uuid AS tenant_id'}, permissions FROM ats.${table}
         WHERE permissions ? 'job:edit' FOR UPDATE`);
      for (const role of roles) {
        const targetType = table === 'custom_roles' ? 'custom_role' : 'system_role';
        const marker = await tx.auditLog.findFirst({ where: { action: 'JOB_OWN_ACTIONS_V1', targetType, targetId: role.id }, select: { id: true } });
        if (marker) continue;
        const before = role.permissions;
        const grants = ['job:change_status', ...(before.includes('job:view') && before.includes('candidate:view') ? ['job:find_matches'] : [])];
        const after = [...new Set([...before, ...grants])];
        await tx.$executeRawUnsafe(`UPDATE ats.${table} SET permissions = $1::jsonb WHERE id = $2::uuid`, JSON.stringify(after), role.id);
        await tx.auditLog.create({ data: { tenantId: role.tenant_id || null, actorId: 'job-permission-policy', action: 'JOB_OWN_ACTIONS_V1', targetType, targetId: role.id, details: { before, added: grants.filter(key => !before.includes(key)), after } } });
      }
    }
    await tx.auditLog.create({ data: { actorId: 'job-permission-policy', action: 'JOB_OWN_ACTIONS_V1_COMPLETE', targetType: 'permission_policy', targetId: 'job-own-actions-v1', details: { version: 1 } } });
  }, { maxWait: 15000, timeout: 120000 });
}

// Each completed version runs once. Later deliberate permission removals are retained.
export async function applyJobActionPermissions(prisma: PrismaClient) {
  await applyCandidateProfilePermissions(prisma);
  await applySubmissionScopePermissions(prisma);
  await applyOwnJobActionsV1(prisma);
  await prisma.$transaction(async tx => {
    await tx.$executeRawUnsafe("SELECT pg_advisory_xact_lock(hashtextextended('job-access-v2', 0))");
    const applied = await tx.auditLog.findFirst({ where: { action: 'JOB_ACCESS_V2_COMPLETE', targetType: 'permission_policy', targetId: 'job-access-v2' }, select: { id: true } });
    if (applied) return;
    for (const table of ['system_roles', 'custom_roles'] as const) {
      const roles = await tx.$queryRawUnsafe<{ id: string; tenant_id?: string; permissions: string[] }[]>(
        `SELECT id, ${table === 'custom_roles' ? 'tenant_id' : 'NULL::uuid AS tenant_id'}, permissions FROM ats.${table} FOR UPDATE`);
      for (const role of roles) {
        const before = Array.isArray(role.permissions) ? role.permissions : [];
        const added = jobAccessGrants(before).filter(key => !before.includes(key));
        if (!added.length) continue;
        const after = [...before, ...added];
        await tx.$executeRawUnsafe(`UPDATE ats.${table} SET permissions = $1::jsonb WHERE id = $2::uuid`, JSON.stringify(after), role.id);
        await tx.auditLog.create({ data: { tenantId: role.tenant_id || null, actorId: 'job-permission-policy', action: 'JOB_ACCESS_V2', targetType: table === 'custom_roles' ? 'custom_role' : 'system_role', targetId: role.id, details: { before, added, after } } });
      }
    }
    await tx.auditLog.create({ data: { actorId: 'job-permission-policy', action: 'JOB_ACCESS_V2_COMPLETE', targetType: 'permission_policy', targetId: 'job-access-v2', details: { version: 2 } } });
  }, { maxWait: 15000, timeout: 120000 });
}

if (require.main === module) {
  const prisma = new PrismaClient();
  applyJobActionPermissions(prisma).then(() => console.log('JOB_OWN_ACTIONS_CONFIGURED'))
    .catch(error => { console.error('Job action permission configuration failed:', error.message); process.exitCode = 1; })
    .finally(() => prisma.$disconnect());
}
