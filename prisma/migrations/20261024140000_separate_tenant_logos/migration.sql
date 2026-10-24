-- ATS: rollback-compatible
-- Add an optional login logo; active and rollback images continue using logo_url.
-- Preserve existing branding by copying references only into the new column.
BEGIN;
SET LOCAL lock_timeout = '5s';
ALTER TABLE ats.tenants ADD COLUMN login_logo_url TEXT;
UPDATE ats.tenants SET login_logo_url = logo_url WHERE login_logo_url IS NULL;
COMMIT;
