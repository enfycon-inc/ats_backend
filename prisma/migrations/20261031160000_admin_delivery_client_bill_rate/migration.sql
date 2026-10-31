-- Grant client bill-rate visibility to the requested default archetypes and
-- their system tenant copies without replacing other permission selections.
UPDATE ats.system_roles
SET permissions = COALESCE(permissions, '[]'::jsonb) || '["job:bill_rate:view"]'::jsonb
WHERE system_key IN ('DELIVERY_HEAD', 'TENANT_ADMIN', 'BRANCH_ADMIN', 'UNIT_ADMIN')
  AND NOT (COALESCE(permissions, '[]'::jsonb) ? 'job:bill_rate:view');

UPDATE ats.custom_roles cr
SET permissions = COALESCE(cr.permissions, '[]'::jsonb) || '["job:bill_rate:view"]'::jsonb
FROM ats.system_roles sr
WHERE cr.system_role_id = sr.id
  AND sr.system_key IN ('DELIVERY_HEAD', 'TENANT_ADMIN', 'BRANCH_ADMIN', 'UNIT_ADMIN')
  AND cr.is_system = true
  AND NOT (COALESCE(cr.permissions, '[]'::jsonb) ? 'job:bill_rate:view');
