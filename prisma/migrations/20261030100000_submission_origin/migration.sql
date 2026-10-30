-- ATS: rollback-compatible
-- ATS: reviewed-submission-origin
-- Website submissions now have a first-class origin; keep the legacy marker
-- value during the release window so the currently-serving image can roll back.
BEGIN;
SET LOCAL lock_timeout = '5s';

ALTER TABLE ats.recruiter_submissions
  ADD COLUMN submission_origin varchar(20) NOT NULL DEFAULT 'RECRUITER',
  ALTER COLUMN recruiter_id DROP NOT NULL;

UPDATE ats.recruiter_submissions
SET submission_origin = 'WEBSITE'
WHERE recruiter_id = 'WEBSITE_APPLICANT';

ALTER TABLE ats.recruiter_submissions
  ADD CONSTRAINT recruiter_submissions_submission_origin_check
  CHECK (submission_origin IN ('RECRUITER', 'WEBSITE')) NOT VALID;

ALTER TABLE ats.recruiter_submissions
  VALIDATE CONSTRAINT recruiter_submissions_submission_origin_check;

CREATE OR REPLACE FUNCTION ats.set_legacy_website_submission_origin()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  -- Previous backend images still write this marker during blue/green deploys.
  -- Classify those writes without changing the old image's read compatibility.
  IF NEW.recruiter_id = 'WEBSITE_APPLICANT' THEN
    NEW.submission_origin := 'WEBSITE';
  ELSIF NEW.submission_origin IS NULL THEN
    NEW.submission_origin := 'RECRUITER';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER recruiter_submissions_origin_compat
BEFORE INSERT OR UPDATE OF recruiter_id, submission_origin
ON ats.recruiter_submissions
FOR EACH ROW
EXECUTE FUNCTION ats.set_legacy_website_submission_origin();

COMMIT;
