-- ATS: rollback-compatible
-- ATS: permission-grant ACCOUNT_MANAGER submission:download_resume
-- Allow account-manager bundles to download approved resumes through submission scope.
BEGIN;
SET LOCAL lock_timeout = '5s';

UPDATE ats.system_roles
SET permissions = COALESCE(permissions, '[]'::jsonb) || '["submission:download_resume"]'::jsonb
WHERE system_key = 'ACCOUNT_MANAGER'
  AND NOT (COALESCE(permissions, '[]'::jsonb) ? 'submission:download_resume');

WITH RECURSIVE account_manager_roles(id, tenant_id) AS (
  SELECT cr.id, cr.tenant_id FROM ats.custom_roles cr
  JOIN ats.system_roles sr ON sr.id = cr.system_role_id
  WHERE sr.system_key = 'ACCOUNT_MANAGER'
  UNION
  SELECT derived.id, derived.tenant_id FROM ats.custom_roles derived
  JOIN account_manager_roles base ON derived.base_role_id = base.id AND derived.tenant_id = base.tenant_id
)
UPDATE ats.custom_roles cr
SET permissions = COALESCE(cr.permissions, '[]'::jsonb) || '["submission:download_resume"]'::jsonb
FROM account_manager_roles am
WHERE cr.id = am.id AND cr.tenant_id = am.tenant_id
  AND NOT (COALESCE(cr.permissions, '[]'::jsonb) ? 'submission:download_resume')
  AND NOT EXISTS (SELECT 1 FROM ats.system_roles sr WHERE sr.id = cr.system_role_id AND sr.system_key = 'RECRUITER');

COMMIT;
