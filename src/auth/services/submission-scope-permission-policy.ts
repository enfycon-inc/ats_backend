import type { PrismaClient } from '@prisma/client';

// Apply defaults once to built-in role bundles. Explicit later removals stay removed.
export async function applySubmissionScopePermissions(prisma: PrismaClient) {
  await prisma.$transaction(async tx => {
    await tx.$executeRawUnsafe("SELECT pg_advisory_xact_lock(hashtextextended('submission-scope-v1', 0))");
    const marker = { action: 'SUBMISSION_SCOPE_V1_COMPLETE', targetType: 'permission_policy', targetId: 'submission-scope-v1' };
    if (await tx.auditLog.findFirst({ where: marker, select: { id: true } })) return;
    for (const table of ['system_roles', 'custom_roles'] as const) {
      const rows = await tx.$queryRawUnsafe<{ id: string; tenant_id: string | null; system_key: string; permissions: string[] }[]>(
        table === 'system_roles'
          ? "SELECT id, NULL::uuid AS tenant_id, system_key, permissions FROM ats.system_roles WHERE system_key IN ('ACCOUNT_MANAGER', 'DELIVERY_HEAD') FOR UPDATE"
          : "SELECT cr.id, cr.tenant_id, sr.system_key, cr.permissions FROM ats.custom_roles cr JOIN ats.system_roles sr ON sr.id = cr.system_role_id WHERE cr.is_system = true AND sr.system_key IN ('ACCOUNT_MANAGER', 'DELIVERY_HEAD') FOR UPDATE OF cr");
      for (const row of rows) {
        const before = Array.isArray(row.permissions) ? row.permissions : [];
        const permission = row.system_key === 'ACCOUNT_MANAGER' ? 'job:submit_owned_jobs' : 'job:submit_unit_jobs';
        if (!before.includes('submission:create') || before.includes(permission)) continue;
        const after = [...before, permission];
        await tx.$executeRawUnsafe(`UPDATE ats.${table} SET permissions = $1::jsonb WHERE id = $2::uuid`, JSON.stringify(after), row.id);
        await tx.auditLog.create({ data: { tenantId: row.tenant_id, actorId: 'job-permission-policy', action: 'SUBMISSION_SCOPE_V1', targetType: table === 'system_roles' ? 'system_role' : 'custom_role', targetId: row.id, details: { before, added: [permission], after } } });
      }
    }
    await tx.auditLog.create({ data: { ...marker, actorId: 'job-permission-policy', details: { version: 1 } } });
  }, { maxWait: 15000, timeout: 120000 });
}
