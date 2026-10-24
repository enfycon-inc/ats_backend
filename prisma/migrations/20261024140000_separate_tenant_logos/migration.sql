BEGIN;
ALTER TABLE ats.tenants ADD COLUMN login_logo_url TEXT;
UPDATE ats.tenants SET login_logo_url = logo_url;
COMMIT;
