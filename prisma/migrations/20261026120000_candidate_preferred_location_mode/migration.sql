-- ATS: rollback-compatible
-- Additive nullable metadata; older application versions ignore these columns.
-- Rollback: revert application images and retain both columns.
BEGIN;
SET LOCAL lock_timeout = '5s';

ALTER TABLE ats.candidates
ADD COLUMN preferred_location_mode VARCHAR(30);

ALTER TABLE ats.recruiter_submissions
ADD COLUMN candidate_preferred_location_mode VARCHAR(30);

COMMIT;
