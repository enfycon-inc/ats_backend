-- ATS: rollback-compatible
-- ATS: permission-grant DELIVERY_HEAD job:manage_creation_access
-- Backfill scoped job-creation access management for Delivery Heads in production.
BEGIN;
SET LOCAL lock_timeout = '5s';

UPDATE ats.system_roles
SET permissions = COALESCE(permissions, '[]'::jsonb) || '["job:manage_creation_access"]'::jsonb
WHERE system_key = 'DELIVERY_HEAD'
  AND NOT (COALESCE(permissions, '[]'::jsonb) ? 'job:manage_creation_access');

WITH RECURSIVE delivery_head_roles(id) AS (
  SELECT cr.id
  FROM ats.custom_roles cr
  JOIN ats.system_roles sr ON sr.id = cr.system_role_id
  WHERE sr.system_key = 'DELIVERY_HEAD'

  UNION

  SELECT derived.id
  FROM ats.custom_roles derived
  JOIN delivery_head_roles base ON derived.base_role_id = base.id
)
UPDATE ats.custom_roles cr
SET permissions = COALESCE(cr.permissions, '[]'::jsonb) || '["job:manage_creation_access"]'::jsonb
FROM delivery_head_roles dh
WHERE cr.id = dh.id
  AND NOT (COALESCE(cr.permissions, '[]'::jsonb) ? 'job:manage_creation_access');

COMMIT;
