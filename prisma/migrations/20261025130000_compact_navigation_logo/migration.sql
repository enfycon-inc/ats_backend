-- ATS: rollback-compatible
BEGIN;
SET LOCAL lock_timeout = '5s';
ALTER TABLE ats.tenants ADD COLUMN IF NOT EXISTS compact_logo_url text;
COMMIT;
