-- ATS: rollback-compatible
-- ATS: permission-grant ACCOUNT_MANAGER job:assign_pod
-- Repair roles matching the former full Account Manager template only.
-- Restricted custom roles keep their administrator-selected permissions.
BEGIN;
SET LOCAL lock_timeout = '5s';

UPDATE ats.custom_roles cr
SET permissions = cr.permissions || '["job:assign_pod"]'::jsonb
FROM ats.system_roles sr
WHERE cr.system_role_id = sr.id
  AND sr.system_key = 'ACCOUNT_MANAGER'
  AND sr.permissions @> '["job:assign_pod"]'::jsonb
  AND NOT cr.permissions @> '["job:assign_pod"]'::jsonb
  AND cr.permissions @> (sr.permissions - 'job:assign_pod')
  AND (sr.permissions - 'job:assign_pod') @> cr.permissions;

COMMIT;
