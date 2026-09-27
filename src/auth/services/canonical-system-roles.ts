// Atomic and repeatable. Assignment IDs and custom permission bundles are preserved.
export const CANONICAL_SYSTEM_ROLES_SQL = `
DO $migration$
DECLARE legacy_id uuid; canonical_id uuid;
BEGIN
  SELECT id INTO legacy_id FROM ats.system_roles WHERE system_key = 'ADMIN';
  IF legacy_id IS NULL THEN RETURN; END IF;
  -- Platform access is an explicit capability, not a role-name bypass.
  UPDATE ats.custom_roles cr SET permissions = COALESCE(cr.permissions, '[]'::jsonb) || '["platform:manage"]'::jsonb
  FROM ats.system_roles sr WHERE cr.system_role_id = sr.id AND sr.system_key = 'SUPER_ADMIN'
    AND cr.is_system = true AND COALESCE(cr.permissions, '[]'::jsonb) ? 'tenant:manage'
    AND NOT (COALESCE(cr.permissions, '[]'::jsonb) ? 'platform:manage');

  SELECT id INTO canonical_id FROM ats.system_roles WHERE system_key = 'TENANT_ADMIN';
  IF canonical_id IS NULL THEN
    UPDATE ats.system_roles SET system_key = 'TENANT_ADMIN', name = 'Tenant Admin', updated_at = NOW()
    WHERE id = legacy_id;
    canonical_id := legacy_id;
  ELSE
    UPDATE ats.custom_roles SET system_role_id = canonical_id WHERE system_role_id = legacy_id;
    UPDATE ats.user_invitations SET system_role_id = canonical_id WHERE system_role_id = legacy_id;
    DELETE FROM ats.system_roles WHERE id = legacy_id;
  END IF;
  -- Preserve role IDs referenced by users, arrays, base roles, and invitations.
  UPDATE ats.custom_roles cr SET name = CASE
    WHEN EXISTS (SELECT 1 FROM ats.custom_roles other WHERE other.tenant_id = cr.tenant_id
                 AND other.id <> cr.id AND UPPER(other.name) = 'TENANT ADMIN' AND other.is_system = true)
      THEN 'Tenant Admin (migrated ' || cr.id::text || ')'
    ELSE 'Tenant Admin' END
  WHERE cr.system_role_id = canonical_id AND cr.is_system = true AND UPPER(cr.name) = 'ADMIN';
END $migration$;
`;
