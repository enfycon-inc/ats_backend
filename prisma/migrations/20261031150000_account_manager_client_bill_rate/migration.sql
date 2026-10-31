-- Make client bill rates available in the Account Manager archetype and its
-- default tenant copies. Preserve all other permissions and custom-role choices.
UPDATE ats.system_roles
SET permissions = COALESCE(permissions, '[]'::jsonb) || '["job:bill_rate:view"]'::jsonb
WHERE system_key = 'ACCOUNT_MANAGER'
  AND NOT (COALESCE(permissions, '[]'::jsonb) ? 'job:bill_rate:view');

UPDATE ats.custom_roles cr
SET permissions = COALESCE(cr.permissions, '[]'::jsonb) || '["job:bill_rate:view"]'::jsonb
FROM ats.system_roles sr
WHERE cr.system_role_id = sr.id
  AND sr.system_key = 'ACCOUNT_MANAGER'
  AND cr.is_system = true
  AND NOT (COALESCE(cr.permissions, '[]'::jsonb) ? 'job:bill_rate:view');
