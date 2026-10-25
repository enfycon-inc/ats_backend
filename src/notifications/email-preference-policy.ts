import type { PrismaService } from '../prisma/prisma.service';
import { eligibleEmails, eligibleActivities, type ActivityCategory, type EmailCategory } from './notification-preferences';

export async function emailPreferencePolicy(db: PrismaService, tenantId: string, userId?: string, email?: string) {
  const rows = await db.$queryRawUnsafe<{ id: string; permissions: unknown; email_preferences: any; pods_enabled: boolean; branch_id: string | null }[]>(
    `SELECT u.id, cr.permissions, s.email_preferences, u.branch_id,
       (t.pod_system_enabled = true AND bu.allow_pods = true) AS pods_enabled
     FROM ats.users u JOIN ats.tenants t ON t.id = u.tenant_id
     LEFT JOIN ats.business_units bu ON bu.id = u.business_unit_id AND bu.tenant_id = u.tenant_id
     LEFT JOIN ats.user_notification_settings s ON s.user_id = u.id
     LEFT JOIN ats.custom_roles cr ON cr.tenant_id = u.tenant_id
       AND (cr.id = u.role_id OR cr.id = ANY(u.assigned_role_ids))
       AND (cr.branch_id IS NULL OR cr.branch_id = u.branch_id)
       AND (cr.business_unit_id IS NULL OR cr.business_unit_id = u.business_unit_id)
     WHERE u.tenant_id = $1::uuid AND u.is_active = true AND u.is_approved = true
       AND ($3::text IS NULL OR LOWER(u.email) = LOWER($3))
       AND (($2::uuid IS NOT NULL AND u.id = $2::uuid) OR ($2::uuid IS NULL AND LOWER(u.email) = LOWER($3)))`,
    tenantId, userId || null, email || null,
  );
  const available = new Set<EmailCategory>();
  const activities = new Set<ActivityCategory>();
  for (const row of rows) {
    let permissions = row.permissions;
    if (typeof permissions === 'string') { try { permissions = JSON.parse(permissions); } catch { permissions = []; } }
    for (const key of eligibleActivities(Array.isArray(permissions) ? permissions : [])) activities.add(key);
    for (const key of eligibleEmails(Array.isArray(permissions) ? permissions : [], row.pods_enabled === true, !!row.branch_id)) available.add(key);
  }
  return { eligible: [...available], activities: [...activities], preferences: rows[0]?.email_preferences || {}, userId: rows[0]?.id };
}
