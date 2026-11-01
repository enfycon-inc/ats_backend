-- ATS: rollback-compatible
-- ATS: additive default capability grant; preserves existing role permissions.
BEGIN;
SET LOCAL lock_timeout = '5s';

-- All built-in role templates should include scoped team-presence visibility.
UPDATE ats.system_roles
SET permissions = COALESCE(permissions, '[]'::jsonb) || '["user:presence:view"]'::jsonb
WHERE NOT (COALESCE(permissions, '[]'::jsonb) ? 'user:presence:view');

-- Apply the default to existing tenant copies of built-in roles only.
UPDATE ats.custom_roles cr
SET permissions = COALESCE(cr.permissions, '[]'::jsonb) || '["user:presence:view"]'::jsonb
FROM ats.system_roles sr
WHERE cr.system_role_id = sr.id
  AND cr.is_system = true
  AND NOT (COALESCE(cr.permissions, '[]'::jsonb) ? 'user:presence:view');

COMMIT;
