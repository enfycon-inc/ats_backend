-- ATS: rollback-compatible
-- Add optional expiry and job-count limits to delegated job creation grants.
BEGIN;
SET LOCAL lock_timeout = '5s';

ALTER TABLE ats.job_creation_grants
  ADD COLUMN expires_at timestamptz(6),
  ADD COLUMN max_jobs integer,
  ADD COLUMN jobs_used integer NOT NULL DEFAULT 0,
  ADD CONSTRAINT job_creation_grants_positive_max_jobs CHECK (max_jobs IS NULL OR max_jobs > 0),
  ADD CONSTRAINT job_creation_grants_nonnegative_jobs_used CHECK (jobs_used >= 0);

COMMIT;
