-- New jobs start at one submission; existing limits are preserved.
ALTER TABLE ats.jobs ALTER COLUMN submission_required SET DEFAULT 1;
