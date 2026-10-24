-- ATS: rollback-compatible
-- Additive policy field. Older application versions ignore it; existing closed
-- jobs remain paused. No candidate/submission outcomes are changed.
BEGIN;
SET LOCAL lock_timeout = '5s';
ALTER TABLE ats.jobs ADD COLUMN keep_existing_submissions_open boolean NOT NULL DEFAULT false;
COMMIT;
