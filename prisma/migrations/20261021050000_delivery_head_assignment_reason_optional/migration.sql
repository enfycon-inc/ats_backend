-- ATS: rollback-compatible
-- ATS: permission-grant DELIVERY_HEAD job:assignment_reason_optional
-- Let Delivery Heads make in-scope assignment changes without emergency justification.
BEGIN;
SET LOCAL lock_timeout = '5s';

UPDATE ats.system_roles
SET permissions = COALESCE(permissions, '[]'::jsonb) || '["job:assignment_reason_optional"]'::jsonb
WHERE system_key = 'DELIVERY_HEAD'
  AND NOT (COALESCE(permissions, '[]'::jsonb) ? 'job:assignment_reason_optional');

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
SET permissions = COALESCE(cr.permissions, '[]'::jsonb) || '["job:assignment_reason_optional"]'::jsonb
FROM delivery_head_roles dh
WHERE cr.id = dh.id
  AND NOT (COALESCE(cr.permissions, '[]'::jsonb) ? 'job:assignment_reason_optional');

COMMIT;
