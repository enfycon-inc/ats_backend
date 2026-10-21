-- ATS: rollback-compatible
-- Additive presentation preference with a safe default; previous application images ignore this column.
BEGIN;
SET LOCAL lock_timeout = '5s';
ALTER TABLE ats.tenant_auth_settings
  ADD COLUMN login_design_variant varchar(32) NOT NULL DEFAULT 'balanced-split';
COMMIT;