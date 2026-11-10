-- ATS: rollback-compatible
-- Reviewed index replacement only: no rows, role IDs, assignments, or columns change.
-- Previous app images retain conservative branch-name checks and can read all roles.
-- Blue/green containers set ATS_SKIP_BOOTSTRAP=true, including rollback containers,
-- so the previous image cannot recreate the removed branch-wide unique index.
-- Roll back the application with the new indexes retained; reverting the indexes
-- requires an explicit check for names repeated across units before restoration.
-- Restoring branch-wide uniqueness requires resolving names repeated across units first.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL search_path = ats, public;
CREATE UNIQUE INDEX IF NOT EXISTS idx_custom_roles_unit_name
  ON custom_roles (tenant_id, branch_id, business_unit_id, UPPER(BTRIM(name)))
  WHERE is_system = false AND business_unit_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_custom_roles_legacy_branch_name
  ON custom_roles (tenant_id, branch_id, UPPER(BTRIM(name)))
  WHERE is_system = false AND business_unit_id IS NULL AND branch_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_custom_roles_legacy_tenant_name
  ON custom_roles (tenant_id, UPPER(BTRIM(name)))
  WHERE is_system = false AND business_unit_id IS NULL AND branch_id IS NULL;
DROP INDEX IF EXISTS idx_custom_roles_branch_name;
COMMIT;
