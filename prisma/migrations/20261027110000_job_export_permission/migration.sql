-- Grant the export capability to Delivery Head and higher permission bundles.
UPDATE ats.system_roles SET permissions = COALESCE(permissions, '[]'::jsonb) || '["job:export"]'::jsonb
WHERE system_key IN ('DELIVERY_HEAD', 'UNIT_ADMIN', 'BRANCH_ADMIN', 'TENANT_ADMIN', 'SUPER_ADMIN')
  AND NOT (COALESCE(permissions, '[]'::jsonb) ? 'job:export');

UPDATE ats.custom_roles cr SET permissions = COALESCE(cr.permissions, '[]'::jsonb) || '["job:export"]'::jsonb
FROM ats.system_roles sr WHERE cr.system_role_id = sr.id
  AND sr.system_key IN ('DELIVERY_HEAD', 'UNIT_ADMIN', 'BRANCH_ADMIN', 'TENANT_ADMIN', 'SUPER_ADMIN')
  AND NOT (COALESCE(cr.permissions, '[]'::jsonb) ? 'job:export');
