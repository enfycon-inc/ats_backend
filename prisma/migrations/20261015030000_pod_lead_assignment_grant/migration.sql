-- ATS: rollback-compatible
-- One-time capability correction; never regrant on application startup.
BEGIN;
SET LOCAL lock_timeout = '5s';

WITH changed AS (
  UPDATE ats.system_roles sr
  SET permissions = COALESCE(sr.permissions, '[]'::jsonb) || '["job:assign_recruiter"]'::jsonb
  WHERE sr.system_key = 'POD_LEAD'
    AND NOT (COALESCE(sr.permissions, '[]'::jsonb) ? 'job:assign_recruiter')
    AND NOT EXISTS (SELECT 1 FROM ats.audit_logs a WHERE a.action = 'POD_LEAD_ASSIGNMENT_GRANT_V1'
      AND a.target_type = 'system_role' AND a.target_id = sr.id::text)
  RETURNING sr.id
)
INSERT INTO ats.audit_logs (actor_id, action, target_type, target_id, details)
SELECT 'migration:20261015030000', 'POD_LEAD_ASSIGNMENT_GRANT_V1', 'system_role', id::text,
  '{"addedPermission":"job:assign_recruiter"}'::jsonb FROM changed;

WITH changed AS (
  UPDATE ats.custom_roles cr
  SET permissions = COALESCE(cr.permissions, '[]'::jsonb) || '["job:assign_recruiter"]'::jsonb
  FROM ats.system_roles sr
  WHERE cr.system_role_id = sr.id AND sr.system_key = 'POD_LEAD' AND cr.is_system = true
    AND NOT (COALESCE(cr.permissions, '[]'::jsonb) ? 'job:assign_recruiter')
    AND NOT EXISTS (SELECT 1 FROM ats.audit_logs a WHERE a.action = 'POD_LEAD_ASSIGNMENT_GRANT_V1'
      AND a.target_type = 'role' AND a.target_id = cr.id::text)
  RETURNING cr.id, cr.tenant_id
)
INSERT INTO ats.audit_logs (tenant_id, actor_id, action, target_type, target_id, details)
SELECT tenant_id, 'migration:20261015030000', 'POD_LEAD_ASSIGNMENT_GRANT_V1', 'role', id::text,
  '{"addedPermission":"job:assign_recruiter"}'::jsonb FROM changed;

COMMIT;
