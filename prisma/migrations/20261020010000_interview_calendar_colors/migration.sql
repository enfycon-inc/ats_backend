BEGIN;
SET LOCAL lock_timeout = '5s';

ALTER TABLE ats.recruiter_submissions
  ADD COLUMN l1_color varchar(20),
  ADD COLUMN l2_color varchar(20),
  ADD COLUMN l3_color varchar(20),
  ADD CONSTRAINT recruiter_submissions_interview_color_check CHECK (
    (l1_color IS NULL OR l1_color IN ('blue', 'violet', 'rose', 'green', 'amber')) AND
    (l2_color IS NULL OR l2_color IN ('blue', 'violet', 'rose', 'green', 'amber')) AND
    (l3_color IS NULL OR l3_color IN ('blue', 'violet', 'rose', 'green', 'amber'))
  );

COMMIT;
