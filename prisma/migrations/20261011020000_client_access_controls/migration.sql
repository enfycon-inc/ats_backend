-- Additive client access policy. Retain columns when rolling back application code.
BEGIN;
SET LOCAL lock_timeout = '5s';
ALTER TABLE ats.tenants
 ADD COLUMN bdm_clients_tenant_wide boolean NOT NULL DEFAULT true,
 ADD COLUMN other_owner_pocs_visible boolean NOT NULL DEFAULT true,
 ADD COLUMN mask_other_owner_poc_details boolean NOT NULL DEFAULT true;
CREATE INDEX client_contacts_tenant_id_client_id_created_by_idx ON ats.client_contacts(tenant_id, client_id, created_by);
UPDATE ats.system_roles SET permissions = COALESCE(permissions, '[]'::jsonb) || '["client:bdm_access"]'::jsonb
 WHERE system_key = 'ACCOUNT_MANAGER' AND NOT COALESCE(permissions, '[]'::jsonb) @> '["client:bdm_access"]'::jsonb;
UPDATE ats.custom_roles cr SET permissions = COALESCE(cr.permissions, '[]'::jsonb) || '["client:bdm_access"]'::jsonb
 FROM ats.system_roles sr WHERE cr.system_role_id = sr.id AND sr.system_key = 'ACCOUNT_MANAGER'
 AND NOT COALESCE(cr.permissions, '[]'::jsonb) @> '["client:bdm_access"]'::jsonb;
COMMIT;
