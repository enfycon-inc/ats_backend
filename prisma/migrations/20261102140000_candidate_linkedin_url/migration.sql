
-- ATS: rollback-compatible
-- Add nullable candidate LinkedIn profile URL.
BEGIN;
SET LOCAL lock_timeout = '5s';

ALTER TABLE ats.candidates ADD COLUMN linkedin_url VARCHAR(500);
COMMIT;
