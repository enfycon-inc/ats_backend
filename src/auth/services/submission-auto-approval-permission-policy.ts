import type { PrismaClient } from '@prisma/client';
import { SUBMISSION_AUTO_APPROVAL_DEFAULT_ROLES, SUBMISSION_AUTO_APPROVAL_PERMISSION } from '../../recruiter-submissions/submission-auto-approval';

// Apply this new default once; later explicit role changes survive restarts.
export async function applySubmissionAutoApprovalPermissions(prisma: PrismaClient) {
  await prisma.$transaction(async tx => {
    await tx.$executeRawUnsafe("SELECT pg_advisory_xact_lock(hashtextextended('submission-auto-approval-v1', 0))");
    const marker = { action: 'SUBMISSION_AUTO_APPROVAL_V1_COMPLETE', targetType: 'permission_policy', targetId: 'submission-auto-approval-v1' };
    if (await tx.auditLog.findFirst({ where: marker, select: { id: true } })) return;
    for (const table of ['system_roles', 'custom_roles'] as const) {
      const roles = await tx.$queryRawUnsafe<{ id: string; tenant_id: string | null; system_key: string; permissions: string[] }[]>(
        table === 'system_roles'
          ? 'SELECT id, NULL::uuid AS tenant_id, system_key, permissions FROM ats.system_roles WHERE system_key = ANY($1::text[]) FOR UPDATE'
          : `WITH RECURSIVE role_tree(id, tenant_id, system_key) AS (
              SELECT cr.id, cr.tenant_id, sr.system_key FROM ats.custom_roles cr
              JOIN ats.system_roles sr ON sr.id = cr.system_role_id
              UNION
              SELECT cr.id, cr.tenant_id, parent.system_key FROM ats.custom_roles cr
              JOIN role_tree parent ON cr.base_role_id = parent.id AND cr.tenant_id = parent.tenant_id
              WHERE cr.system_role_id IS NULL
            )
            SELECT cr.id, cr.tenant_id, rt.system_key, cr.permissions FROM ats.custom_roles cr
            JOIN role_tree rt ON rt.id = cr.id AND rt.tenant_id = cr.tenant_id
            WHERE rt.system_key = ANY($1::text[]) FOR UPDATE OF cr`,
        [...SUBMISSION_AUTO_APPROVAL_DEFAULT_ROLES]);
      for (const role of roles) {
        if (!(SUBMISSION_AUTO_APPROVAL_DEFAULT_ROLES as readonly string[]).includes(role.system_key)) continue;
        const before = Array.isArray(role.permissions) ? role.permissions : [];
        if (before.includes(SUBMISSION_AUTO_APPROVAL_PERMISSION)) continue;
        const after = [...before, SUBMISSION_AUTO_APPROVAL_PERMISSION];
        await tx.$executeRawUnsafe(`UPDATE ats.${table} SET permissions = $1::jsonb WHERE id = $2::uuid`, JSON.stringify(after), role.id);
        await tx.auditLog.create({ data: {
          tenantId: role.tenant_id, actorId: 'submission-permission-policy', action: 'SUBMISSION_AUTO_APPROVAL_V1',
          targetType: table === 'custom_roles' ? 'custom_role' : 'system_role', targetId: role.id,
          details: { before, added: [SUBMISSION_AUTO_APPROVAL_PERMISSION], after },
        } });
      }
    }
    await tx.auditLog.create({ data: { ...marker, actorId: 'submission-permission-policy', details: { version: 1 } } });
  }, { maxWait: 15000, timeout: 120000 });
}
