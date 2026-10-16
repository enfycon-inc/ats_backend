import { BadRequestException } from '@nestjs/common';
import type { AuthQueryService } from './auth-query.service';

/** Lifecycle rule, not an authorization shortcut: leadership is granted by pod membership only. */
export async function rejectManualPodLeadRoles(query: AuthQueryService, tenantId: string, identifiers: string[]) {
  if (!identifiers.length) return;
  const result = await query.query(
    `SELECT cr.id FROM ats.custom_roles cr JOIN ats.system_roles sr ON sr.id = cr.system_role_id
     WHERE cr.tenant_id = $1::uuid AND sr.system_key = 'POD_LEAD'
       AND (LOWER(cr.id::text) = ANY($2::text[]) OR LOWER(cr.name) = ANY($2::text[]) OR LOWER(sr.system_key) = ANY($2::text[])) LIMIT 1`,
    [tenantId, identifiers.map(value => value.trim().toLowerCase())],
  );
  if (result.rows.length) throw new BadRequestException('Pod leadership roles are assigned automatically through a pod. Select the lead in Recruitment Pods.');
}

export async function existingPodLeadRoleIds(query: AuthQueryService, tenantId: string, userId: string): Promise<string[]> {
  const result = await query.query(
    `SELECT cr.id FROM ats.users u JOIN ats.custom_roles cr
       ON cr.id = u.role_id OR cr.id = ANY(u.assigned_role_ids)
     JOIN ats.system_roles sr ON sr.id = cr.system_role_id
     WHERE u.id = $1::uuid AND u.tenant_id = $2::uuid AND cr.tenant_id = u.tenant_id
       AND sr.system_key = 'POD_LEAD'
       AND EXISTS (SELECT 1 FROM ats.pods p WHERE p.tenant_id = u.tenant_id AND p.pod_head_id = u.id)`,
    [userId, tenantId],
  );
  return result.rows.map((role: any) => role.id);
}
