-- ATS: rollback-compatible
-- ATS: permission-grant ACCOUNT_MANAGER job:grant_creation_delegate
-- Backfill the account-manager delegation capability in production role records.
BEGIN;
SET LOCAL lock_timeout = '5s';

UPDATE ats.system_roles
SET permissions = COALESCE(permissions, '[]'::jsonb) || '["job:grant_creation_delegate"]'::jsonb
WHERE system_key = 'ACCOUNT_MANAGER'
  AND NOT (COALESCE(permissions, '[]'::jsonb) ? 'job:grant_creation_delegate');

WITH RECURSIVE account_manager_roles(id) AS (
  SELECT cr.id
  FROM ats.custom_roles cr
  JOIN ats.system_roles sr ON sr.id = cr.system_role_id
  WHERE sr.system_key = 'ACCOUNT_MANAGER'

  UNION

  SELECT derived.id
  FROM ats.custom_roles derived
  JOIN account_manager_roles base ON derived.base_role_id = base.id
)
UPDATE ats.custom_roles cr
SET permissions = COALESCE(cr.permissions, '[]'::jsonb) || '["job:grant_creation_delegate"]'::jsonb
FROM account_manager_roles amr
WHERE cr.id = amr.id
  AND NOT (COALESCE(cr.permissions, '[]'::jsonb) ? 'job:grant_creation_delegate');

COMMIT;
