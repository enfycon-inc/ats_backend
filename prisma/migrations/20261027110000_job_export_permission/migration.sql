-- ATS: rollback-compatible
-- ATS: permission-grant DELIVERY_HEAD_AND_ABOVE job:export
-- Adds only a permission key; older application images can retain it safely.
-- Grant the export capability to Delivery Head and higher permission bundles.
BEGIN;
SET LOCAL lock_timeout = '5s';

UPDATE ats.system_roles SET permissions = COALESCE(permissions, '[]'::jsonb) || '["job:export"]'::jsonb
WHERE system_key IN ('DELIVERY_HEAD', 'UNIT_ADMIN', 'BRANCH_ADMIN', 'TENANT_ADMIN', 'SUPER_ADMIN')
  AND NOT (COALESCE(permissions, '[]'::jsonb) ? 'job:export');

UPDATE ats.custom_roles cr SET permissions = COALESCE(cr.permissions, '[]'::jsonb) || '["job:export"]'::jsonb
FROM ats.system_roles sr WHERE cr.system_role_id = sr.id
  AND sr.system_key IN ('DELIVERY_HEAD', 'UNIT_ADMIN', 'BRANCH_ADMIN', 'TENANT_ADMIN', 'SUPER_ADMIN')
  AND NOT (COALESCE(cr.permissions, '[]'::jsonb) ? 'job:export');

COMMIT;
